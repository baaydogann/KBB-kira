import { artisHesapla, type ArtisSonucu } from '@/core/hesap/artis'
import { HESAP_SURUMU, type TaksitGoruntusu } from '@/core/hesap/goruntu'
import { taksitTutari, type KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import { formatTL, para, type Para } from '@/core/para'
import { artisTarihleri, artisYururlugu, type ArtisYururlugu } from '@/core/takvim'
import { bugunIstanbul, enBuyukTarih, enKucukTarih, formatTarih, gunEkle, icindeMi, karsilastir, type Tarih } from '@/core/tarih'
import type { OdemePeriyodu, SozlesmeDurumu } from '@/core/tipler'
import type { Prisma } from '@/generated/prisma'
import { SISTEM_BAGLAMI, type IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, jsonYaz, oranYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { onayliOranlariYukle } from '../endeks/oranlar'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { parametreOpsiyonel, parametreTamsayi } from '../parametre/servis'
import { kiraDonemiGirdileri } from '../sozlesme/girdi'
import { fazlaOdemeHatirlat, taksitPlaniniGuncelle, vadesiGecmisMi, type PlanOzeti } from '../taksit/servis'

/** Kira dönemi + taksit planı yazan işlemler çok satır yazar; Prisma'nın 5 sn'lik varsayılanı yetmez (aktifleştirmedeki gibi). */
const ISLEM = { timeout: 60_000 }

/** Serbest metin alanlarının üst sınırı (sözleşme şemasındaki `opsMetin` ile aynı). */
const METIN_SINIRI = 500

/** Bedel değişikliği (tespit, anlaşma, düzeltme) yalnızca yürürlükteki (AKTIF/UZADI) sözleşmede yapılır. */
const yururlukteMi = (durum: string): boolean => durum === 'AKTIF' || durum === 'UZADI'

/** Artış hesabı, onayı ve H5 için yürürlük (`artisYururlugu`): ileri tarihli fesih ya da sona erme etkin bitişe kadar yürürlükte sayılır. */
export function artisIcinYururluk(s: { durum: SozlesmeDurumu; bitis: Date | null; fesihTarihi: Date | null }, bugun: Tarih): ArtisYururlugu | null {
  return artisYururlugu({ durum: s.durum, bitis: tarihDbOpt(s.bitis), fesihTarihi: tarihDbOpt(s.fesihTarihi) }, bugun)
}

/** `artisYururlugu`nun aday süzgeci (sorgu); kesin karar kilitten sonra `artisYururlugu` ile verilir. */
export function artisYururlukSorgusu(bugun: Tarih): Prisma.SozlesmeWhereInput {
  const gun = dbTarih(bugun)
  return { OR: [{ durum: { in: ['AKTIF', 'UZADI'] } }, { durum: 'FESHEDILDI', fesihTarihi: { gte: gun } }, { durum: 'SONA_ERDI', bitis: { gte: gun } }] }
}

/** Henüz onaylanmamış (hâlâ onaya konu olabilen) artış durumları. */
const ACIK_ARTIS_DURUMLARI: ('BEKLEMEDE' | 'HESAPLANDI')[] = ['BEKLEMEDE', 'HESAPLANDI']

/**
 * Sözleşme satır kilidi (`taksitPlaniniGuncelle` ile aynı kilit; F2 paket kodu da bunu almalı). Kira dönemi, taksit ya da artış
 * yazan her işlemin İLK ifadesidir: alt satır eklemeden (kira_donemi → FOR KEY SHARE) ya da sürüm artırmadan önce alınmazsa
 * plan güncellemesindeki FOR UPDATE yükseltmesi eşzamanlı bir işlemle karşılıklı bekler (40P01). Kilitten sonraki okumalar
 * kilidi bekleyen işlemin sonucunu da görür.
 */
async function sozlesmeyiKilitle(tx: Tx, sozlesmeId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${sozlesmeId} FOR UPDATE`
}

/** Artış kimliğinden sözleşmeyi bulup tek ifadede kilitler (kilit için önce artışı okumak ilk ifadeyi kilit olmaktan çıkarırdı). */
async function artisinSozlesmesiniKilitle(tx: Tx, artisId: number): Promise<number> {
  const satirlar = await tx.$queryRaw<{ id: number }[]>`
    SELECT s.id FROM sozlesme s JOIN artis_hesabi a ON a.sozlesme_id = s.id WHERE a.id = ${artisId} FOR UPDATE OF s`
  const satir = satirlar[0]
  if (!satir) throw new BulunamadiHatasi('Artış hesabı bulunamadı.')
  return satir.id
}

/**
 * I3 + N1: yenilemenin ilk günündeki artış bekleniyor mu? İkisi birden gerekir:
 * - son (tek) kira dönemi sözleşme başlangıcındaki, artışla henüz ayarlanmamış ILK dönemdir;
 * - ILK dönemin bedeli (ve tabanı) önceki sözleşmenin bir önceki gün geçerli bedeline eşittir: taslak önceki bedeli olduğu gibi taşımıştır.
 * Bedel farklıysa yenileme yeniden pazarlık edilmiştir: o tarih için kendiliğinden artış açılmaz, hatırlatılmaz ve sonraki artışları ya da
 * bedel değişikliklerini engellemez. Önceki sözleşmenin o güne ait dönemi yoksa eşitlik doğrulanamaz; artış açılmaz.
 * Öyleyse başlangıç bir artış tarihiyse (kira yılı sınırında başlayan yenileme) artış hesaplanır, hatırlatılır ve onaylanınca yeni dönem
 * açılmaz, ILK dönemin bedeli değişir (`donemBedeliniDegistir`). Hesap, onay, bedel değişikliği (I4), hatırlatma yükleyicisi (H5) ve
 * sözleşme ekranı aynı yüklemi kullanır.
 */
export async function ilkDonemArtisBekliyorMu(
  db: Tx,
  s: { oncekiSozlesmeId: number | null; baslangic: Date },
  sonKd: { kaynak: string; baslangic: Date; artisHesabiId: number | null; bedelTutari: { toString(): string }; bedelTabani: string } | undefined,
): Promise<boolean> {
  if (s.oncekiSozlesmeId === null || sonKd === undefined || sonKd.kaynak !== 'ILK' || sonKd.artisHesabiId !== null) return false
  if (tarihDb(sonKd.baslangic) !== tarihDb(s.baslangic)) return false
  const gun = dbTarih(gunEkle(tarihDb(sonKd.baslangic), -1))
  const onceki = await db.kiraDonemi.findFirst({
    where: { sozlesmeId: s.oncekiSozlesmeId, baslangic: { lte: gun }, OR: [{ bitis: null }, { bitis: { gte: gun } }] },
    select: { bedelTutari: true, bedelTabani: true },
  })
  return onceki !== null && onceki.bedelTabani === sonKd.bedelTabani && paraDb(onceki.bedelTutari).equals(paraDb(sonKd.bedelTutari))
}

interface HesapOrtami { bugun: Tarih; ufuk: Tarih; oranlar: Awaited<ReturnType<typeof onayliOranlariYukle>>; baglam: IslemBaglami }

type BekleyenSonuc = Extract<ArtisSonucu, { durum: 'BEKLEMEDE' }>

/** Bekleyen kaydın neden/eksik seri/referans/eski bedel bilgisi değişmediyse yeniden yazmaya (sürüm artışı, denetim) gerek yoktur. */
function bekleyenDegismedi(
  m: { referansYil: number; referansAy: number; eskiBedel: { toString(): string }; gerekce: unknown }, sonuc: BekleyenSonuc, eskiBedel: Para,
): boolean {
  const g = (m.gerekce ?? {}) as { neden?: string; eksikSeriler?: string[] }
  return m.referansYil === sonuc.referansAy.yil && m.referansAy === sonuc.referansAy.ay && paraDb(m.eskiBedel).equals(eskiBedel)
    && g.neden === sonuc.neden && JSON.stringify(g.eksikSeriler ?? []) === JSON.stringify(sonuc.eksikSeriler)
}

/**
 * Bir sözleşmenin sıradaki artışını hesaplar. Sözleşme satırı önce kilitlenir, sonra yeniden okunur: aday listesi kilitsiz
 * okunduğundan bayat olabilir (araya giren fesih/onay/bedel değişikliği), eşzamanlı iki hesap aynı artışı iki kez oluşturamaz.
 * `izleyici.donem`: hesaplanan artışın dönem başlangıcı (biliniyorsa); hata hatırlatmasının anahtarı için çağırana ulaşır.
 */
async function sozlesmeArtisiniHesapla(tx: Tx, sozlesmeId: number, o: HesapOrtami, izleyici: { donem: Tarih | null }): Promise<ArtisSonucu['durum'] | null> {
  await sozlesmeyiKilitle(tx, sozlesmeId)
  const s = await tx.sozlesme.findUnique({
    where: { id: sozlesmeId },
    include: { tasinmaz: true, kiraDonemleri: { orderBy: { baslangic: 'asc' } }, artislar: { where: { durum: { not: 'IPTAL' } } } },
  })
  const yururluk = s === null ? null : artisIcinYururluk(s, o.bugun)
  if (!s || yururluk === null || s.artisKurali === 'YOK') return null
  const kd = kiraDonemiGirdileri(s.kiraDonemleri)
  const sonKd = kd.at(-1)
  if (!sonKd) return null
  // Sona ermekte olan sözleşmede etkin bitiş (fesih tarihi) sınırdır: ondan sonra başlayan artış hesaplanmaz.
  const son = yururluk.bitisEtkin === null ? o.ufuk : enKucukTarih(yururluk.bitisEtkin, o.ufuk)
  // Son kira dönemiyle başlayan artış o dönemle uygulanmıştır; yalnızca ayarlanmamış yenileme ILK dönemi kendi başlangıcındaki artışı bekler.
  const ilkDonemArtisi = await ilkDonemArtisBekliyorMu(tx, s, s.kiraDonemleri.at(-1))
  const d = artisTarihleri({ ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), periyotAy: s.artisPeriyoduAy, sonTarih: son })
    .find((x) => karsilastir(x, sonKd.baslangic) > (ilkDonemArtisi ? -1 : 0))
  if (d === undefined) return null
  izleyici.donem = d
  const mevcut = s.artislar.find((a) => tarihDb(a.donemBaslangic) === d)
  if (mevcut && mevcut.durum !== 'BEKLEMEDE') return null
  // I3: ilk gün artışında önceki bedel, önceki sözleşmenin bir önceki gün geçerli bedelidir; yüklem ILK bedelin ona eşit olmasını gerektirir.
  const oncekiBedel = d === sonKd.baslangic ? sonKd.bedel : oncekiDonemBedeli(kd, d, s.sozlesmeNo)
  const konut = await parametreOpsiyonel('TBK344_KONUT_SINIR', d, tx)
  const r = artisHesapla({
    donemBaslangic: d, ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), oncekiBedel,
    kural: s.artisKurali, degisimTuru: s.artisDegisimTuru, sabitOran: s.sabitArtisOrani === null ? null : paraDb(s.sabitArtisOrani),
    elleOran: mevcut?.elleOran ? paraDb(mevcut.elleOran) : null, tasinmazTuru: s.tasinmaz.tur,
    konutSiniri: konut === null ? null : para(konut), oranlar: o.oranlar,
  })
  if (!r.ok) throw new IsKuraliHatasi(r.hata.kod, `${s.sozlesmeNo}: ${r.hata.mesaj}`)
  const sonuc = r.deger
  if (mevcut && sonuc.durum === 'BEKLEMEDE' && bekleyenDegismedi(mevcut, sonuc, oncekiBedel)) return 'BEKLEMEDE'
  const veri = sonuc.durum === 'HESAPLANDI'
    ? {
        referansYil: sonuc.referansAy.yil, referansAy: sonuc.referansAy.ay, tavan: sonuc.tavan === null ? null : oranYaz(sonuc.tavan),
        sozlesmeOrani: oranYaz(sonuc.sozlesmeOrani), uygulananOran: oranYaz(sonuc.uygulananOran), eskiBedel: paraYaz(oncekiBedel),
        yeniBedel: paraYaz(sonuc.yeniBedel), gerekce: jsonYaz({ satirlar: sonuc.satirlar }), durum: 'HESAPLANDI' as const,
      }
    : {
        referansYil: sonuc.referansAy.yil, referansAy: sonuc.referansAy.ay, tavan: null, sozlesmeOrani: null, uygulananOran: null,
        eskiBedel: paraYaz(oncekiBedel), yeniBedel: null,
        gerekce: jsonYaz({ neden: sonuc.neden, eksikSeriler: sonuc.eksikSeriler, satirlar: sonuc.satirlar }), durum: 'BEKLEMEDE' as const,
      }
  let artisId: number
  if (mevcut) {
    // Okuma ile yazma arasında onaylanan/değişen kayıt ezilmez.
    const yazilan = await tx.artisHesabi.updateMany({
      where: { id: mevcut.id, version: mevcut.version, durum: 'BEKLEMEDE' }, data: { ...veri, version: { increment: 1 } },
    })
    if (yazilan.count === 0) throw new CakismaHatasi()
    artisId = mevcut.id
  } else {
    artisId = (await tx.artisHesabi.create({ data: { sozlesmeId: s.id, donemBaslangic: dbTarih(d), ...veri }, select: { id: true } })).id
  }
  await denetimKaydi(tx, o.baglam, {
    varlik: 'sozlesme', varlikId: s.id, eylem: 'ARTIS_HESAPLA',
    sonra: sonuc.durum === 'HESAPLANDI'
      ? { artisHesabiId: artisId, donem: d, durum: sonuc.durum, uygulananOran: sonuc.uygulananOran.toString(), eskiBedel: paraYaz(oncekiBedel), yeniBedel: paraYaz(sonuc.yeniBedel) }
      : { artisHesabiId: artisId, donem: d, durum: sonuc.durum, neden: sonuc.neden, eksikSeriler: sonuc.eksikSeriler },
  })
  return sonuc.durum
}

/** Artış tarihinden önceki gün geçerli kira döneminin bedeli (spec §6.3: önceki dönemde fiilen geçerli bedel). */
function oncekiDonemBedeli(kd: readonly KiraDonemiGirdi[], d: Tarih, sozlesmeNo: string): Para {
  const onceki = kd.find((k) => icindeMi(gunEkle(d, -1), { baslangic: k.baslangic, bitis: k.bitis }))
  if (!onceki) throw new IsKuraliHatasi('DONEM', `${sozlesmeNo}: ${d} öncesindeki kira dönemi bulunamadı.`)
  return onceki.bedel
}

/**
 * Hesaplanamayan artış için karar gerektiren KRITIK hatırlatma (`uzamaHatasiniBildir` ile aynı kalıp). Anahtar sözleşmeyi ve
 * artışın dönem başlangıcını taşır; satır varsa yalnızca ileti güncellenir (kullanıcı kapatmış ya da ertelemiş olabilir).
 * İleti Türkçe iş kuralı iletisidir (kişisel veri içermez).
 */
async function artisHesapHatasiniBildir(tx: Tx, aday: { id: number; sozlesmeNo: string }, donem: Tarih | null, mesaj: string, bugun: Tarih): Promise<void> {
  const anahtar = `ARTIS_HESAP_HATA:sozlesme:${aday.id}:${donem ?? 'genel'}`
  await tx.hatirlatma.upsert({
    where: { anahtar },
    create: {
      anahtar, kural: 'ARTIS_HESAP_HATA', iliskiliTur: 'sozlesme', iliskiliId: String(aday.id), sozlesmeId: aday.id,
      baslik: `Kira artışı hesaplanamadı — ${aday.sozlesmeNo}`, aciklama: mesaj,
      hedefTarih: dbTarih(donem ?? bugun), gorunurTarih: dbTarih(bugun), oncelik: 'KRITIK', kararGerekli: true,
    },
    update: { aciklama: mesaj },
  })
}

export interface ArtisHesapSonucu {
  hesaplanan: number
  bekleyen: number
  /**
   * Yalnızca toplu çağrıda ve yalnızca hata varsa: hesaplanamayan sözleşmeler (ileti sözleşme numarasıyla başlar).
   * İş kuralı hataları ayrıca KRITIK `ARTIS_HESAP_HATA` hatırlatması olarak kalıcıdır; çakışmalar yalnızca burada görünür.
   */
  hatalar?: string[]
}

/**
 * Her sözleşmede yalnız sıradaki onaylanmamış artış hesaplanır: sonraki dönemin bedeli bu onaya bağlıdır.
 *
 * Toplu çağrıda (`sozlesmeId` yok) sözleşme başına SAVEPOINT vardır: bir sözleşmedeki CakismaHatasi ya da IsKuraliHatasi yalnızca
 * o sözleşmenin yazılarını geri alır, `hatalar`a yazılır ve sonraki sözleşmeyle devam edilir (atlanan sözleşme ertesi çalışmada yine aday olur).
 * Tek sözleşme çağrısında da aynı savepoint ve (iş kuralı hatasında) aynı hata hatırlatması vardır, ardından hata çağırana yükselir: çağıran
 * hatayı işlem içinde yakalarsa işlem hatırlatmayla birlikte tamamlanır, yakalamazsa işlem geri alınır. Adaylar kimliğe göre azalan sırayla kilitlenir: yenileme etkinleştirmesi önce
 * yeni (büyük kimlik), sonra eski sözleşmeyi kilitler (yeni → eski); aynı sırayı izlemeyen toplu iş onunla karşılıklı beklerdi.
 */
export async function artislariHesapla(tx: Tx, bugun: Tarih, sozlesmeId?: number, baglam: IslemBaglami = SISTEM_BAGLAMI): Promise<ArtisHesapSonucu> {
  const sayac = { hesaplanan: 0, bekleyen: 0 }
  const hatalar: string[] = []
  const ortam: HesapOrtami = {
    bugun, baglam, ufuk: gunEkle(bugun, await parametreTamsayi('ARTIS_HESAP_UFUK_GUN', bugun, tx)), oranlar: await onayliOranlariYukle(tx),
  }
  const adaylar = await tx.sozlesme.findMany({
    where: { ...artisYururlukSorgusu(bugun), artisKurali: { not: 'YOK' }, ...(sozlesmeId === undefined ? {} : { id: sozlesmeId }) },
    select: { id: true, sozlesmeNo: true },
    orderBy: { id: 'desc' },
  })
  const say = (durum: ArtisSonucu['durum'] | null): void => {
    if (durum === 'HESAPLANDI') sayac.hesaplanan += 1
    else if (durum === 'BEKLEMEDE') sayac.bekleyen += 1
  }
  for (const aday of adaylar) {
    const izleyici: { donem: Tarih | null } = { donem: null }
    await tx.$executeRaw`SAVEPOINT artis_hesabi`
    try {
      say(await sozlesmeArtisiniHesapla(tx, aday.id, ortam, izleyici))
      await tx.$executeRaw`RELEASE SAVEPOINT artis_hesabi`
    } catch (e) {
      if (!(e instanceof CakismaHatasi || e instanceof IsKuraliHatasi)) throw e
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT artis_hesabi`
      await tx.$executeRaw`RELEASE SAVEPOINT artis_hesabi`
      // Çakışma geçicidir (ertesi çalışmada yeniden denenir, sessiz); iş kuralı hatası kullanıcı müdahalesi ister ve kalıcı olarak görünür kalmalıdır.
      if (e instanceof IsKuraliHatasi) await artisHesapHatasiniBildir(tx, aday, izleyici.donem, e.message, bugun)
      // Tek sözleşme çağrısında hata çağırana yükselir (kullanıcı eylemleri işlemi geri alıp iletiyi gösterir; geri alınan işlemle hatırlatma da gider).
      // Gece işi hatayı işlem içinde yakalayıp işlemi tamamlar: hatırlatma kalıcı olur.
      if (sozlesmeId !== undefined) throw e
      hatalar.push(e instanceof IsKuraliHatasi && e.message.startsWith(aday.sozlesmeNo) ? e.message : `${aday.sozlesmeNo}: ${e.message}`)
    }
  }
  return hatalar.length > 0 ? { ...sayac, hatalar } : sayac
}

interface FarkOzeti { fark: number; fazlaOdeme: number; iptalFark: number }

/**
 * Tahakkuk etmiş taksitler için fark taksiti; fark negatifse kalıcı fazla ödeme hatırlatması. Tahakkuk etmiş: ödeme sürecine girmiş
 * (PAKETTE/ODEME_EMRINDE/ODENDI) ya da vadesi geçmiş PLANLANDI taksit (`vadesiGecmisMi`; F1 ödeme kaydetmez, sistem dışında ödenmiş
 * olabilir). Vadesi gelmemiş PLANLANDI taksitlere dokunulmaz: `taksitPlaniniGuncelle` onları yeniden fiyatlar. Çağıran sözleşme satırını
 * kilitlemiş olmalıdır.
 *
 * FARK taksiti ana taksite ve onu doğuran kira dönemine bağlanır (`taksit_fark_baglantili`); artış hesabı yalnızca artıştan gelen
 * kira dönemi için doludur, tespit/anlaşma/düzeltmede boştur. Tespit dönem başından geriye işlediği için (TBK 344/3) bunlar da fark doğurur.
 *
 * Bir taksitin tahakkuk eden tutarı: ana tutar + tahakkuk etmiş önceki FARK'lar (aynı ölçüt). Vadesi gelmemiş PLANLANDI FARK'lar tahakkuk
 * etmemiştir: iptal edilir (korumalı yazma) ve eksik/fazla farkın tamamı tek yeni FARK ile (ya da fazla ödeme hatırlatmasıyla) karşılanır.
 *
 * `hatirlatmaEki`: fazla ödeme hatırlatmasının anahtar eki. Yeni dönemde dönemin kimliğidir; var olan dönemin bedeli değiştirildiğinde
 * (`donemBedeliniDegistir`) kimliğe yeni kaynak eklenir, aynı dönemdeki önceki olayın (belki tamamlanmış) hatırlatması ezilmesin.
 */
async function farklariIsle(
  tx: Tx, sozlesmeId: number, d: Tarih, kiraDonemiId: number, artisHesabiId: number | null, bugun: Tarih, hatirlatmaEki = String(kiraDonemiId),
): Promise<FarkOzeti> {
  const ozet: FarkOzeti = { fark: 0, fazlaOdeme: 0, iptalFark: 0 }
  const gun = dbTarih(bugun)
  const s = await tx.sozlesme.findUniqueOrThrow({
    where: { id: sozlesmeId },
    include: {
      kiraDonemleri: { orderBy: { baslangic: 'asc' } },
      taksitler: {
        where: {
          tur: { in: ['NORMAL', 'KIST'] }, donemBitis: { gte: dbTarih(d) },
          OR: [{ durum: { in: ['PAKETTE', 'ODEME_EMRINDE', 'ODENDI'] } }, { durum: 'PLANLANDI', vadeTarihi: { lt: gun } }],
        },
        include: { farkTaksitleri: { where: { durum: { not: 'IPTAL' } } } },
        orderBy: { donemBaslangic: 'asc' },
      },
    },
  })
  const kd = kiraDonemiGirdileri(s.kiraDonemleri)
  const vadeGun = await parametreTamsayi('FARK_VADE_GUN', bugun, tx)
  const tahakkukEtmemis = (f: { durum: string; vadeTarihi: Date }) => f.durum === 'PLANLANDI' && !vadesiGecmisMi(f.vadeTarihi, bugun)
  for (const x of s.taksitler) {
    const donem = { baslangic: tarihDb(x.donemBaslangic), bitis: tarihDb(x.donemBitis) }
    const yeni = taksitTutari({ donem, periyotAy: s.odemePeriyoduAy as OdemePeriyodu, kiraAyiCapasi: tarihDb(s.baslangic), kiraDonemleri: kd, kist: s.kistYontemi })
    if (!yeni.ok) throw new IsKuraliHatasi(yeni.hata.kod, `${s.sozlesmeNo}: ${yeni.hata.mesaj}`)
    for (const f of x.farkTaksitleri.filter(tahakkukEtmemis)) {
      const r = await tx.taksit.updateMany({ where: { id: f.id, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
      if (r.count === 0) throw new CakismaHatasi()
      ozet.iptalFark += 1
    }
    const eski = x.farkTaksitleri.filter((y) => !tahakkukEtmemis(y)).reduce((toplam, f) => toplam.plus(paraDb(f.tutar)), paraDb(x.tutar))
    const fark = yeni.deger.tutar.minus(eski)
    if (fark.isZero()) continue
    if (fark.isNegative()) {
      await fazlaOdemeHatirlat(tx, {
        taksitId: x.id, ek: hatirlatmaEki, sozlesmeId, baslik: `Fazla ödeme — ${s.sozlesmeNo}`,
        aciklama: `${formatTarih(donem.baslangic)} – ${formatTarih(donem.bitis)} taksitinde ${formatTL(fark.abs())} fazla ödendi; mahsup veya iade takibi gerekli.`,
      }, bugun)
      ozet.fazlaOdeme += 1
      continue
    }
    const goruntu: TaksitGoruntusu = {
      surum: HESAP_SURUMU, hesapZamani: new Date().toISOString(), donem: { baslangic: enBuyukTarih(donem.baslangic, d), bitis: donem.bitis },
      kiraDonemleri: kd.map((k) => ({ id: k.id, baslangic: k.baslangic, bitis: k.bitis, bedel: k.bedel.toFixed(2), taban: k.taban })),
      kist: s.kistYontemi, artisBekleniyor: false,
      satirlar: [...yeni.deger.satirlar, { kural: 'FARK', aciklama: 'Ödenmiş taksit ile yeni bedel arasındaki fark', formul: `${yeni.deger.tutar.toFixed(2)} − ${eski.toFixed(2)}`, sonuc: fark.toFixed(2) }],
    }
    await tx.taksit.create({
      data: {
        sozlesmeId, tur: 'FARK', donemBaslangic: dbTarih(enBuyukTarih(donem.baslangic, d)), donemBitis: x.donemBitis,
        vadeTarihi: dbTarih(gunEkle(bugun, vadeGun)), tutar: paraYaz(fark), hesapGoruntusu: jsonYaz(goruntu),
        anaTaksitId: x.id, kiraDonemiId, artisHesabiId,
      },
    })
    ozet.fark += 1
  }
  return ozet
}

interface DonemAcmaOzeti { plan: PlanOzeti; fark: number; fazlaOdeme: number; iptalFark: number }

/** Çağıran sözleşme satırını kilitlemiş olmalıdır (kilit işlemin ilk ifadesi). */
async function yeniKiraDonemiAc(
  tx: Tx, sozlesmeId: number, d: Tarih, bedel: Para, kaynak: 'ARTIS' | 'TESPIT' | 'ANLASMA' | 'ELLE',
  artisHesabiId: number | null, aciklama: string | null, baglam: IslemBaglami, bugun: Tarih,
): Promise<DonemAcmaOzeti> {
  const s = await tx.sozlesme.findUnique({ where: { id: sozlesmeId }, select: { durum: true, bitis: true, fesihTarihi: true } })
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  // Artış onayı ileri tarihli fesih/sona ermede de yapılır (bedel değişikliği yürürlüğü kendisi daha dar denetler); sınır etkin bitiştir.
  const yururluk = artisIcinYururluk(s, bugun)
  if (yururluk === null) throw new IsKuraliHatasi('DURUM', 'Yalnızca yürürlükteki sözleşmenin bedeli değiştirilir.')
  const bitis = yururluk.bitisEtkin
  if (bitis !== null && karsilastir(d, bitis) > 0) throw new IsKuraliHatasi('BASLANGIC', 'Başlangıç tarihi sözleşme bitişinden sonra olamaz.', 'baslangic')
  const donemler = await tx.kiraDonemi.findMany({ where: { sozlesmeId }, orderBy: { baslangic: 'asc' } })
  if (donemler.some((k) => karsilastir(tarihDb(k.baslangic), d) >= 0)) {
    throw new IsKuraliHatasi('SIRA', 'Bu tarihte veya sonrasında başlayan bir kira dönemi var; bedel değişikliği son dönemden sonra olmalı.', 'baslangic')
  }
  const onceki = donemler.find((k) => icindeMi(gunEkle(d, -1), { baslangic: tarihDb(k.baslangic), bitis: tarihDbOpt(k.bitis) }))
  if (!onceki) throw new IsKuraliHatasi('DONEM', 'Bu tarihten önceki kira dönemi bulunamadı.', 'baslangic')
  // kira_donemi_cakismaz ertelenemez: eski dönem kapanmadan yenisi eklenemez.
  await tx.kiraDonemi.update({ where: { id: onceki.id }, data: { bitis: dbTarih(gunEkle(d, -1)) } })
  const yeniDonem = await tx.kiraDonemi.create({
    data: { sozlesmeId, baslangic: dbTarih(d), bitis: onceki.bitis, bedelTutari: paraYaz(bedel), bedelTabani: onceki.bedelTabani, kaynak, artisHesabiId, aciklama, olusturanId: baglam.kullaniciId },
    select: { id: true },
  })
  const farklar = await farklariIsle(tx, sozlesmeId, d, yeniDonem.id, artisHesabiId, bugun)
  const plan = await taksitPlaniniGuncelle(tx, sozlesmeId, bugun)
  return { plan, ...farklar }
}

type KiraDonemiSatiri = { id: number; baslangic: Date; bedelTutari: { toString(): string }; kaynak: 'ILK' | 'ARTIS' | 'TESPIT' | 'ANLASMA' | 'ELLE'; artisHesabiId: number | null }

/** Değiştirilen dönemin önceki hâli (denetim satırı için). */
function donemOzeti(kd: KiraDonemiSatiri) {
  return { kiraDonemiId: kd.id, oncekiBedel: paraDb(kd.bedelTutari).toFixed(2), oncekiKaynak: kd.kaynak, oncekiArtisHesabiId: kd.artisHesabiId }
}

/**
 * Var olan bir kira döneminin bedelini değiştirir; yeni dönem açmaz. Yenilemenin ayarlanmamış ILK dönemine artış onayı (I3) ve onaylı
 * artış döneminin başlangıcından işleyen tespit kararı (I8) için. Korumalı yazma: dönem okunduğu gibi değilse (bedel, kaynak ya da
 * artış bağı değişmiş) CakismaHatasi. Ardından fark ve plan o dönemin başlangıcından yeniden işlenir; vadesi geçmiş taksitler
 * dokunulmaz, fark FARK ya da fazla ödeme hatırlatması olur (bkz. `farklariIsle`). Çağıran sözleşme satırını kilitlemiş olmalıdır.
 */
async function donemBedeliniDegistir(
  tx: Tx, sozlesmeId: number, kd: KiraDonemiSatiri,
  yeni: { bedel: Para; kaynak: 'ARTIS' | 'TESPIT'; artisHesabiId: number | null; aciklama?: string }, bugun: Tarih,
): Promise<DonemAcmaOzeti> {
  const r = await tx.kiraDonemi.updateMany({
    where: { id: kd.id, kaynak: kd.kaynak, bedelTutari: paraYaz(paraDb(kd.bedelTutari)), artisHesabiId: kd.artisHesabiId },
    data: {
      bedelTutari: paraYaz(yeni.bedel), kaynak: yeni.kaynak, artisHesabiId: yeni.artisHesabiId,
      ...(yeni.aciklama === undefined ? {} : { aciklama: yeni.aciklama }),
    },
  })
  if (r.count === 0) throw new CakismaHatasi()
  const farklar = await farklariIsle(tx, sozlesmeId, tarihDb(kd.baslangic), kd.id, yeni.artisHesabiId, bugun, `${kd.id}:${yeni.kaynak}`)
  const plan = await taksitPlaniniGuncelle(tx, sozlesmeId, bugun)
  return { plan, ...farklar }
}

export async function artisOnayla(id: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sozlesmeId = await artisinSozlesmesiniKilitle(tx, id)
    const a = await tx.artisHesabi.findUnique({ where: { id } })
    if (!a) throw new BulunamadiHatasi('Artış hesabı bulunamadı.')
    if (a.version !== version) throw new CakismaHatasi()
    if (a.durum !== 'HESAPLANDI' || a.yeniBedel === null) throw new IsKuraliHatasi('DURUM', 'Yalnızca hesaplanmış artış onaylanabilir.')
    const r = await tx.artisHesabi.updateMany({
      where: { id, version, durum: 'HESAPLANDI' },
      data: { durum: 'ONAYLANDI', onaylayanId: baglam.kullaniciId, onayZamani: new Date(), version: { increment: 1 } },
    })
    if (r.count === 0) throw new CakismaHatasi()
    const d = tarihDb(a.donemBaslangic)
    // I3: artış, yenilemenin ayarlanmamış ILK döneminin başlangıcındaysa o dönemin bedeli değişir; aksi halde yeni dönem açılır.
    const s = await tx.sozlesme.findUniqueOrThrow({ where: { id: sozlesmeId }, select: { oncekiSozlesmeId: true, baslangic: true, durum: true, bitis: true, fesihTarihi: true } })
    const sonKd = await tx.kiraDonemi.findFirst({ where: { sozlesmeId }, orderBy: { baslangic: 'desc' } })
    const ilkDonem = sonKd !== null && tarihDb(sonKd.baslangic) === d && await ilkDonemArtisBekliyorMu(tx, s, sonKd) ? sonKd : null
    if (ilkDonem !== null && artisIcinYururluk(s, bugun) === null) throw new IsKuraliHatasi('DURUM', 'Yalnızca yürürlükteki sözleşmenin bedeli değiştirilir.')
    const ozet = ilkDonem === null
      ? await yeniKiraDonemiAc(tx, sozlesmeId, d, paraDb(a.yeniBedel), 'ARTIS', a.id, null, baglam, bugun)
      : await donemBedeliniDegistir(tx, sozlesmeId, ilkDonem, { bedel: paraDb(a.yeniBedel), kaynak: 'ARTIS', artisHesabiId: a.id }, bugun)
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'ARTIS_ONAY',
      sonra: {
        artisHesabiId: id, donem: d, eskiBedel: a.eskiBedel.toFixed(2), yeniBedel: a.yeniBedel.toFixed(2),
        uygulananOran: a.uygulananOran?.toString(), plan: ozet.plan, farkTaksiti: ozet.fark, iptalFarkTaksiti: ozet.iptalFark, fazlaOdemeHatirlatmasi: ozet.fazlaOdeme,
        ...(ilkDonem === null ? {} : { degistirilenDonem: donemOzeti(ilkDonem) }),
      },
    })
  }, ISLEM)
}

export async function artisElleOranGir(id: number, version: number, g: { oran: Para; gerekce: string }, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  const gerekce = g.gerekce.trim()
  if (gerekce.length < 3) throw new IsKuraliHatasi('GEREKCE', 'Elle oran için gerekçe yazın.', 'gerekce')
  if (gerekce.length > METIN_SINIRI) throw new IsKuraliHatasi('GEREKCE', `Gerekçe en çok ${METIN_SINIRI} karakter olabilir.`, 'gerekce')
  if (g.oran.decimalPlaces() > 4) throw new IsKuraliHatasi('ORAN', 'Oran en çok 4 ondalık basamak içerebilir.', 'oran')
  if (g.oran.isNegative() || g.oran.greaterThan(1000)) throw new IsKuraliHatasi('ORAN', 'Oran %0 ile %1000 arasında olmalıdır; virgülü kontrol edin (ör. 25,00).', 'oran')
  await prisma.$transaction(async (tx) => {
    const sozlesmeId = await artisinSozlesmesiniKilitle(tx, id)
    const a = await tx.artisHesabi.findUnique({ where: { id }, include: { sozlesme: true } })
    if (!a) throw new BulunamadiHatasi('Artış hesabı bulunamadı.')
    if (a.version !== version) throw new CakismaHatasi()
    if (a.sozlesme.artisKurali !== 'ELLE' || a.durum !== 'BEKLEMEDE' || artisIcinYururluk(a.sozlesme, bugun) === null) {
      throw new IsKuraliHatasi('DURUM', 'Elle oran yalnızca yürürlükteki sözleşmede "her dönem elle" kuralındaki bekleyen artışa girilir.')
    }
    const r = await tx.artisHesabi.updateMany({
      where: { id, version, durum: 'BEKLEMEDE' }, data: { elleOran: oranYaz(g.oran), elleOranGerekcesi: gerekce, version: { increment: 1 } },
    })
    if (r.count === 0) throw new CakismaHatasi()
    // Gerekçe serbest metindir (kişisel veri içerebilir): denetim satırına metni değil, yazıldığı bilgisi girer; metin artış satırında durur.
    await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'ARTIS_ELLE_ORAN', sonra: { artisHesabiId: id, oran: g.oran.toString(), gerekceYazildi: true } })
    await artislariHesapla(tx, bugun, sozlesmeId, baglam)
  }, ISLEM)
}

/**
 * Son kira döneminin başlangıcından sonra (yenilemenin ayarlanmamış ILK döneminde: başlangıcından itibaren), `sinir`dan önce başlayan ve
 * ONAYLANDI artış hesabı olmayan ilk artış tarihi; yoksa undefined.
 */
export async function onaylanmamisArtisTarihi(
  tx: Tx, s: { id: number; ilkKiraBaslangici: Date; artisPeriyoduAy: number; oncekiSozlesmeId: number | null; baslangic: Date },
  sonDonem: NonNullable<Parameters<typeof ilkDonemArtisBekliyorMu>[2]>, sinir: Tarih,
): Promise<Tarih | undefined> {
  const alt = tarihDb(sonDonem.baslangic)
  const ilkDonemArtisi = await ilkDonemArtisBekliyorMu(tx, s, sonDonem)
  const beklenen = artisTarihleri({ ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), periyotAy: s.artisPeriyoduAy, sonTarih: gunEkle(sinir, -1) })
    .filter((x) => karsilastir(x, alt) > (ilkDonemArtisi ? -1 : 0))
  if (beklenen.length === 0) return undefined
  const onayli = new Set((await tx.artisHesabi.findMany({
    where: { sozlesmeId: s.id, durum: 'ONAYLANDI', donemBaslangic: { in: beklenen.map(dbTarih) } }, select: { donemBaslangic: true },
  })).map((a) => tarihDb(a.donemBaslangic)))
  return beklenen.find((x) => !onayli.has(x))
}

export async function kiraBedeliDegistir(
  sozlesmeId: number, version: number, g: { baslangic: Tarih; bedel: Para; kaynak: 'TESPIT' | 'ANLASMA' | 'ELLE'; aciklama: string },
  baglam: IslemBaglami, bugun: Tarih = bugunIstanbul(),
): Promise<void> {
  const aciklama = g.aciklama.trim()
  if (aciklama.length < 3) throw new IsKuraliHatasi('ACIKLAMA', 'Dayanağı yazın (karar no, protokol tarihi vb.).', 'aciklama')
  if (aciklama.length > METIN_SINIRI) throw new IsKuraliHatasi('ACIKLAMA', `Dayanak en çok ${METIN_SINIRI} karakter olabilir.`, 'aciklama')
  // decimal.js: isPositive() +0 için de true döner; kira_donemi_bedel (> 0) ihlali ham veritabanı hatası olmasın.
  if (!g.bedel.greaterThan(0)) throw new IsKuraliHatasi('BEDEL', 'Bedel sıfırdan büyük olmalı.', 'bedel')
  await prisma.$transaction(async (tx) => {
    await sozlesmeyiKilitle(tx, sozlesmeId)
    const s = await tx.sozlesme.findUnique({ where: { id: sozlesmeId } })
    if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
    if (!yururlukteMi(s.durum)) throw new IsKuraliHatasi('DURUM', 'Yalnızca yürürlükteki sözleşmenin bedeli değiştirilir.')
    // Tarih aralığı, artış sırası denetimlerinden önce: bitişten sonraki tarih atlanan artış olarak değil, aralık dışı olarak bildirilir.
    const bitis = tarihDbOpt(s.bitis)
    if (bitis !== null && karsilastir(g.baslangic, bitis) > 0) throw new IsKuraliHatasi('BASLANGIC', 'Başlangıç tarihi sözleşme bitişinden sonra olamaz.', 'baslangic')
    const r = await tx.sozlesme.updateMany({ where: { id: sozlesmeId, version }, data: { version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    // Son kira döneminden sonra, değişiklik tarihinden önce onay bekleyen bir artış varsa yeni dönem onu onaylanamaz bırakırdı (sıra kuralı):
    // sessizce yetim bırakmak yerine önce onaylanması ya da değişikliğin onun tarihinden başlatılması istenir.
    const sonDonem = await tx.kiraDonemi.findFirst({ where: { sozlesmeId }, orderBy: { baslangic: 'desc' } })
    // I8: tespit kararı tam son artış döneminin başlangıcından işliyorsa yeni dönem açılmaz, o dönemin bedeli değişir (TBK 344/3: tespit
    // artışın yerine geçer). Anlaşma ve düzeltme ile tespit dışındaki her aynı tarihli değişiklik eskisi gibi sıra kuralına takılır.
    const degisecekDonem = g.kaynak === 'TESPIT' && sonDonem !== null && sonDonem.kaynak === 'ARTIS' && tarihDb(sonDonem.baslangic) === g.baslangic
      ? sonDonem
      : null
    const acikArtis = sonDonem === null ? null : await tx.artisHesabi.findFirst({
      where: { sozlesmeId, durum: { in: ACIK_ARTIS_DURUMLARI }, donemBaslangic: { gt: sonDonem.baslangic, lt: dbTarih(g.baslangic) } },
      orderBy: { donemBaslangic: 'asc' }, select: { donemBaslangic: true },
    })
    if (acikArtis) {
      throw new IsKuraliHatasi(
        'ACIK_ARTIS',
        `${formatTarih(tarihDb(acikArtis.donemBaslangic))} tarihli artış onay bekliyor. Önce onu onaylayın ya da değişikliği o artışın başlangıç tarihinden başlatın.`,
        'baslangic',
      )
    }
    // I4: hiç hesaplanmamış (satırı olmayan) artış da sessizce yutulmasın: son kira döneminden sonra, değişiklik tarihinden önce başlayan
    // her artış tarihi onaylanmış olmalıdır. Yenilemenin ayarlanmamış ILK dönemi kendi başlangıcındaki artışı bekler (o tarih de sayılır).
    const atlanan = sonDonem === null || s.artisKurali === 'YOK' ? undefined : await onaylanmamisArtisTarihi(tx, s, sonDonem, g.baslangic)
    if (atlanan !== undefined) {
      throw new IsKuraliHatasi(
        'ACIK_ARTIS',
        `${formatTarih(atlanan)} tarihli artış henüz hesaplanıp onaylanmadı. Önce artışı hesaplatıp onaylayın ya da değişikliği o artışın başlangıç tarihinden başlatın.`,
        'baslangic',
      )
    }
    // Değişiklik tarihinde ya da sonrasında başlayacak onaysız artışlar bu bedelle geçersiz kalır; kimlikleri denetime yazılır.
    const iptalArtisIdleri = (await tx.artisHesabi.findMany({
      where: { sozlesmeId, donemBaslangic: { gte: dbTarih(g.baslangic) }, durum: { in: ACIK_ARTIS_DURUMLARI } }, select: { id: true }, orderBy: { id: 'asc' },
    })).map((a) => a.id)
    if (iptalArtisIdleri.length > 0) {
      const iptal = await tx.artisHesabi.updateMany({
        where: { id: { in: iptalArtisIdleri }, durum: { in: ACIK_ARTIS_DURUMLARI } }, data: { durum: 'IPTAL', version: { increment: 1 } },
      })
      if (iptal.count !== iptalArtisIdleri.length) throw new CakismaHatasi()
    }
    const ozet = degisecekDonem === null
      ? await yeniKiraDonemiAc(tx, sozlesmeId, g.baslangic, g.bedel, g.kaynak, null, aciklama, baglam, bugun)
      : await donemBedeliniDegistir(tx, sozlesmeId, degisecekDonem, { bedel: g.bedel, kaynak: 'TESPIT', artisHesabiId: null, aciklama }, bugun)
    // Dayanak serbest metindir (kişisel veri içerebilir): denetim satırına metni değil, yazıldığı bilgisi girer; metin kira dönemi satırında durur.
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'KIRA_BEDELI_DEGISTI',
      sonra: {
        baslangic: g.baslangic, bedel: g.bedel.toFixed(2), kaynak: g.kaynak, aciklamaYazildi: true, iptalArtisIdleri,
        plan: ozet.plan, farkTaksiti: ozet.fark, iptalFarkTaksiti: ozet.iptalFark, fazlaOdemeHatirlatmasi: ozet.fazlaOdeme,
        ...(degisecekDonem === null ? {} : { degistirilenDonem: donemOzeti(degisecekDonem) }),
      },
    })
  }, ISLEM)
}
