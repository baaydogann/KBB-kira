import { hisseToplamiBirMi } from '@/core/hisse'
import { sozlesmeOnizleme, type OnizlemeSatiri } from '@/core/hesap/onizleme'
import type { KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import type { Para } from '@/core/para'
import { ayEkle, ayFarki, bugunIstanbul, enBuyukTarih, enKucukTarih, formatTarih, gunEkle, icindeMi, karsilastir, type Tarih } from '@/core/tarih'
import type { VergiStatusu } from '@/core/tipler'
import type { Sozlesme } from '@/generated/prisma'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, dbTarihOpt, oranYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { varsayilanEkonomikKod, vergiOranlari } from '../parametre/servis'
import { fazlaOdemeHatirlat, taksitPlaniniGuncelle, vadesiGecmisMi } from '../taksit/servis'
import { damgaIlkKaydiOlustur } from '../damga/servis'
import type { MalikGirdisi, SozlesmeGirdisi } from './sema'

function sozlesmeVerisi(g: SozlesmeGirdisi, ekonomikKod: string) {
  return {
    sozlesmeNo: g.sozlesmeNo, tasinmazId: g.tasinmazId, birimId: g.birimId, ekonomikKod,
    imzaTarihi: dbTarihOpt(g.imzaTarihi), baslangic: dbTarih(g.baslangic), bitis: dbTarihOpt(g.bitis),
    ilkKiraBaslangici: dbTarih(g.ilkKiraBaslangici ?? g.baslangic),
    bedelTutari: paraYaz(g.bedelTutari!), bedelTabani: g.bedelTabani, bedelTuru: g.bedelTuru,
    odemePeriyoduAy: g.odemePeriyoduAy, odemeZamani: g.odemeZamani, vadeKurali: g.vadeKurali, vadeParametresi: g.vadeParametresi,
    artisKurali: g.artisKurali, artisDegisimTuru: g.artisDegisimTuru,
    sabitArtisOrani: g.sabitArtisOrani === null ? null : oranYaz(g.sabitArtisOrani),
    artisPeriyoduAy: g.artisPeriyoduAy, kistYontemi: g.kistYontemi, damgaTahsil: g.damgaTahsil, ihaleDayanagi: g.ihaleDayanagi,
    onayBelgesiNo: g.onayBelgesiNo, onayBelgesiTarihi: dbTarihOpt(g.onayBelgesiTarihi),
    piyasaArastirmaTarihi: dbTarihOpt(g.piyasaArastirmaTarihi), encumenKararNo: g.encumenKararNo,
    gecisTarihi: dbTarihOpt(g.gecisTarihi), gecisBedeli: g.gecisBedeli === null ? null : paraYaz(g.gecisBedeli),
    odenmisSayilanSonTarih: dbTarihOpt(g.odenmisSayilanSonTarih), notlar: g.notlar,
  }
}

const ALANLAR = [
  'sozlesmeNo', 'tasinmazId', 'birimId', 'ekonomikKod', 'imzaTarihi', 'baslangic', 'bitis', 'ilkKiraBaslangici',
  'bedelTutari', 'bedelTabani', 'bedelTuru', 'odemePeriyoduAy', 'odemeZamani', 'vadeKurali', 'vadeParametresi',
  'artisKurali', 'artisDegisimTuru', 'sabitArtisOrani', 'artisPeriyoduAy', 'kistYontemi', 'damgaTahsil', 'ihaleDayanagi',
  'onayBelgesiNo', 'onayBelgesiTarihi', 'piyasaArastirmaTarihi', 'encumenKararNo',
  'gecisTarihi', 'gecisBedeli', 'odenmisSayilanSonTarih', 'notlar',
] as const
type Alanlar = Readonly<Record<(typeof ALANLAR)[number], unknown>>

/** Serbest metin kişi adı, telefon, adres gibi kişisel veri içerebilir; denetim satırına değeri yazılmaz, yalnız değiştiği belirtilir. */
const SERBEST_METIN_ALANLARI: ReadonlySet<string> = new Set(['notlar'])
const ACIK_ALANLAR = ALANLAR.filter((a) => !SERBEST_METIN_ALANLARI.has(a))

/** Veritabanı satırı, kayıt verisiyle aynı biçime getirilir (tutar iki, oran dört ondalıklı metin). */
function satirAlanlari(s: Sozlesme): Alanlar {
  return {
    ...s,
    bedelTutari: paraYaz(paraDb(s.bedelTutari)),
    sabitArtisOrani: s.sabitArtisOrani === null ? null : oranYaz(paraDb(s.sabitArtisOrani)),
    gecisBedeli: s.gecisBedeli === null ? null : paraYaz(paraDb(s.gecisBedeli)),
  }
}

const gorunum = (v: unknown): unknown => (v instanceof Date ? tarihDb(v) : v)

/** Maliklerin yalnızca kimlikleri ve payları: kişi adı, kimlik numarası ve IBAN değeri yazılmaz. */
function malikOzeti(malikler: readonly MalikGirdisi[]): MalikGirdisi[] {
  return malikler
    .map((m) => ({ kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId }))
    .sort((a, b) => a.kisiId - b.kisiId)
}

function denetimOzeti(a: Alanlar, malikler: readonly MalikGirdisi[]) {
  return { ...Object.fromEntries(ACIK_ALANLAR.map((ad) => [ad, gorunum(a[ad])])), malikler: malikOzeti(malikler) }
}

function degisenAlanlar(once: Alanlar, sonra: Alanlar, eskiMalikler: readonly MalikGirdisi[], yeniMalikler: readonly MalikGirdisi[]): string[] {
  const alanlar: string[] = ALANLAR.filter((ad) => JSON.stringify(gorunum(once[ad])) !== JSON.stringify(gorunum(sonra[ad])))
  if (JSON.stringify(malikOzeti(eskiMalikler)) !== JSON.stringify(malikOzeti(yeniMalikler))) alanlar.push('malikler')
  return alanlar
}

/**
 * Birim, malik, vekil ve IBAN kimliklerinin varlığı: bilinmeyen kimlik ham yabancı anahtar hatası (P2003) ya da sessiz
 * bir varsayılan yerine alanına bağlı iş kuralı hatası verir. Maliklerin ve vekillerin kişi satırlarını kimliğe göre döndürür.
 * IBAN'ın kime ait olduğu burada değil, aktifleştirmede denetlenir (taslak eksik olabilir).
 */
async function referanslariDogrula(db: Tx, g: SozlesmeGirdisi) {
  if (!(await db.birim.findUnique({ where: { id: g.birimId }, select: { id: true } }))) {
    throw new IsKuraliHatasi('BIRIM', 'Birim bulunamadı.', 'birimId')
  }
  return malikReferanslariniDogrula(db, g.malikler)
}

/** Ödemenin yapılacağı kişi vekil varsa vekil, yoksa malikin kendisidir; IBAN o kişiye ait ve aktif olmalıdır. */
export function ibanUygunMu(
  malik: { kisiId: number; vekilKisiId: number | null },
  iban: { kisiId: number; aktif: boolean } | null | undefined,
): boolean {
  return iban !== null && iban !== undefined && iban.aktif && iban.kisiId === (malik.vekilKisiId ?? malik.kisiId)
}

/** Malik, vekil ve IBAN kimliklerinin varlığı (yaşam döngüsü akışları da malik değişikliğinde kullanır). */
export async function malikReferanslariniDogrula(db: Tx, malikler: readonly MalikGirdisi[]) {
  const kisiKimlikleri = [...new Set(malikler.flatMap((m) => (m.vekilKisiId === null ? [m.kisiId] : [m.kisiId, m.vekilKisiId])))]
  const kisiMap = new Map((await db.kisi.findMany({ where: { id: { in: kisiKimlikleri } } })).map((k) => [k.id, k]))
  if (malikler.some((m) => !kisiMap.has(m.kisiId))) throw new IsKuraliHatasi('KISI', 'Malik olarak seçilen kişi bulunamadı.', 'malikler')
  if (malikler.some((m) => m.vekilKisiId !== null && !kisiMap.has(m.vekilKisiId))) {
    throw new IsKuraliHatasi('VEKIL', 'Vekil olarak seçilen kişi bulunamadı.', 'malikler')
  }
  const ibanKimlikleri = [...new Set(malikler.flatMap((m) => (m.ibanId === null ? [] : [m.ibanId])))]
  if (ibanKimlikleri.length > 0 && (await db.iban.count({ where: { id: { in: ibanKimlikleri } } })) !== ibanKimlikleri.length) {
    throw new IsKuraliHatasi('IBAN', 'Seçilen IBAN bulunamadı.', 'malikler')
  }
  return kisiMap
}

export async function sozlesmeTaslakKaydet(g: SozlesmeGirdisi, baglam: IslemBaglami, id?: number, version?: number, bugun: Tarih = bugunIstanbul()): Promise<number> {
  // Sürümsüz güncelleme iyimser kilidi sessizce düşürürdü.
  if (id !== undefined && version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
  try {
    return await prisma.$transaction(async (tx) => {
      const tasinmaz = await tx.tasinmaz.findUnique({ where: { id: g.tasinmazId } })
      if (!tasinmaz) throw new IsKuraliHatasi('TASINMAZ', 'Taşınmaz bulunamadı.', 'tasinmazId')
      await referanslariDogrula(tx, g)
      // Ekonomik kod, geçmişteki sözleşme başlangıcının değil, ileride yapılacak ödemelerin bütçe uygulama niteliğidir:
      // yıllar önce başlamış bir sözleşme göçte bugünkü sınıflandırmayla, ileri tarihli sözleşme kendi başlangıcıyla kodlanır.
      const ekonomikKod = g.ekonomikKod ?? (await varsayilanEkonomikKod(tasinmaz.tur, tasinmaz.kullanimAmaci, enBuyukTarih(g.baslangic, bugun), tx))
      const veri = sozlesmeVerisi(g, ekonomikKod)
      let sozlesmeId: number
      if (id === undefined) {
        sozlesmeId = (await tx.sozlesme.create({ data: veri })).id
        await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'OLUSTUR', sonra: denetimOzeti(veri, g.malikler) })
      } else {
        const mevcut = await tx.sozlesme.findUnique({ where: { id }, include: { malikler: true } })
        if (!mevcut) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
        if (mevcut.durum !== 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Yalnızca taslak sözleşmeler bu ekrandan düzenlenebilir.')
        const r = await tx.sozlesme.updateMany({ where: { id, version }, data: { ...veri, version: { increment: 1 } } })
        if (r.count === 0) throw new CakismaHatasi()
        await tx.sozlesmeMalik.deleteMany({ where: { sozlesmeId: id } })
        const once = satirAlanlari(mevcut)
        await denetimKaydi(tx, baglam, {
          varlik: 'sozlesme', varlikId: id, eylem: 'GUNCELLE',
          once: denetimOzeti(once, mevcut.malikler),
          sonra: { ...denetimOzeti(veri, g.malikler), degisenAlanlar: degisenAlanlar(once, veri, mevcut.malikler, g.malikler) },
        })
        sozlesmeId = id
      }
      for (const m of g.malikler) {
        await tx.sozlesmeMalik.create({
          data: { sozlesmeId, kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId, gecerlilikBaslangic: dbTarih(g.baslangic) },
        })
      }
      return sozlesmeId
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('SOZLESME_NO', 'Bu sözleşme numarası zaten kullanılıyor.', 'sozlesmeNo')
    throw e
  }
}

function girdiKiraDonemleri(g: SozlesmeGirdisi): KiraDonemiGirdi[] {
  const bedel = g.bedelTutari!
  if (g.gecisTarihi === null || g.gecisBedeli === null) {
    return [{ id: 'ILK', baslangic: g.baslangic, bitis: null, bedel, taban: g.bedelTabani }]
  }
  return [
    { id: 'ILK', baslangic: g.baslangic, bitis: gunEkle(g.gecisTarihi, -1), bedel, taban: g.bedelTabani },
    { id: 'GECIS', baslangic: g.gecisTarihi, bitis: null, bedel: g.gecisBedeli, taban: g.bedelTabani },
  ]
}

export type OnizlemeCiktisi =
  | { ok: true; satirlar: { baslangic: Tarih; bitis: Tarih; vade: Tarih; tutar: string; malikler: { kisiId: string; ad: string; brut: string; kdv: string; stopaj: string; net: string }[] }[] }
  | { ok: false; mesaj: string }

/** Kaydetmeden önce: geçiş tarihinden (yoksa başlangıçtan) itibaren en çok 24 taksit, bugünkü vergi oranlarıyla. */
export async function sozlesmeOnizle(g: SozlesmeGirdisi, bugun: Tarih = bugunIstanbul()): Promise<OnizlemeCiktisi> {
  const kisiMap = await referanslariDogrula(prisma, g)
  const malikKisileri = g.malikler.map((m) => kisiMap.get(m.kisiId)!)
  const adlar = new Map(malikKisileri.map((k) => [String(k.id), kisiGorunenAd(k)]))
  const oranlar = new Map<VergiStatusu, { stopaj: Para; kdv: Para }>()
  for (const k of malikKisileri) {
    if (!oranlar.has(k.vergiStatusu)) {
      const o = await vergiOranlari(k.vergiStatusu, bugun)
      oranlar.set(k.vergiStatusu, { stopaj: o.stopaj, kdv: o.kdv })
    }
  }
  const ilkSatir = g.gecisTarihi ?? g.baslangic
  const sonuc = sozlesmeOnizleme({
    baslangic: g.baslangic, bitis: g.bitis, periyotAy: g.odemePeriyoduAy, zaman: g.odemeZamani,
    vadeKurali: g.vadeKurali, vadeParametresi: g.vadeParametresi, kist: g.kistYontemi, bedelTuru: g.bedelTuru,
    kiraDonemleri: girdiKiraDonemleri(g),
    malikler: g.malikler.map((m) => ({ kisiId: String(m.kisiId), pay: m.pay, payda: m.payda, statu: kisiMap.get(m.kisiId)!.vergiStatusu })),
    oranlar: (st) => oranlar.get(st)!,
    ufuk: ayEkle(enBuyukTarih(bugun, ilkSatir), 24),
    azamiSatir: 2400,
  })
  if (!sonuc.ok) return { ok: false, mesaj: sonuc.hata.mesaj }
  const ilgili: OnizlemeSatiri[] = sonuc.deger.filter((r) => karsilastir(r.bitis, ilkSatir) >= 0).slice(0, 24)
  return {
    ok: true,
    satirlar: ilgili.map((r) => ({
      baslangic: r.baslangic, bitis: r.bitis, vade: r.vade, tutar: r.tutar.toFixed(2),
      malikler: r.malikler.map((m) => ({
        kisiId: m.kisiId, ad: adlar.get(m.kisiId)!,
        brut: m.brut.toFixed(2), kdv: m.kdv.toFixed(2), stopaj: m.stopaj.toFixed(2), net: m.net.toFixed(2),
      })),
    })),
  }
}

/**
 * Yenileme devri: önceki sözleşmenin, dönemi yeni sözleşmenin başlangıcında ya da sonrasında başlayan PLANLANDI taksitleri (FARK dahil)
 * vadesi geçmiş olsa da iptal edilir; yeni sözleşmenin aynı dönem taksitleri onların yerini alır (C1 dondurmasının bilinçli istisnası:
 * aksi halde aynı ay için iki H1 ve çift ödeme riski olurdu). Korumalı yazma: okuma ile yazma arasında ödeme sürecine giren satır varsa
 * CakismaHatasi. Vadesi geçmiş devredilen her taksit için mahsup kontrolü (H5_FAZLA_ODEME) hatırlatması açılır: sistem dışında
 * ödenmiş olabilir. Ödeme sürecindeki (PAKETTE/ODEME_EMRINDE/ODENDI) satırlara dokunulmaz. İptal edilen kimlikleri döndürür.
 */
async function yenilemeyeDevret(
  tx: Tx, o: { id: number; sozlesmeNo: string }, yeni: { baslangic: Tarih; sozlesmeNo: string }, bugun: Tarih,
): Promise<number[]> {
  const satirlar = await tx.taksit.findMany({
    where: { sozlesmeId: o.id, durum: 'PLANLANDI', donemBaslangic: { gte: dbTarih(yeni.baslangic) } },
    orderBy: [{ donemBaslangic: 'asc' }, { id: 'asc' }],
  })
  if (satirlar.length === 0) return []
  const idler = satirlar.map((x) => x.id)
  const r = await tx.taksit.updateMany({ where: { id: { in: idler }, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
  if (r.count !== idler.length) throw new CakismaHatasi()
  for (const x of satirlar.filter((y) => vadesiGecmisMi(y.vadeTarihi, bugun))) {
    const donem = `${formatTarih(tarihDb(x.donemBaslangic))} – ${formatTarih(tarihDb(x.donemBitis))}`
    await fazlaOdemeHatirlat(tx, {
      taksitId: x.id, ek: 'DEVIR', sozlesmeId: o.id, baslik: `Fazla ödeme kontrolü — ${o.sozlesmeNo}`,
      aciklama: `Önceki sözleşmenin ${donem} taksiti (vade ${formatTarih(tarihDb(x.vadeTarihi))}) yeni sözleşmeye (${yeni.sozlesmeNo}) devredildi; `
        + 'ödendiyse yeni sözleşmenin aynı dönem taksitinden mahsup edin.',
    }, bugun, true)
  }
  return idler
}

/**
 * Yenileme zincirinde önceki sözleşmeyi yeni başlangıçtan bir gün önce kapatır. Kilit sırası yeni → eski: yeni sözleşme
 * etkinleştirme sorgusuyla zaten kilitlidir, eskisi burada sürüm koşullu tek güncellemeyle kilitlenir. Yeni sözleşmenin dönemlerine
 * düşen planlı taksitler önce devredilir (`yenilemeyeDevret`), sonra plan kalan dönemlere göre yeniden üretilir.
 */
async function oncekiSozlesmeyiKapat(
  tx: Tx, oncekiId: number, yeni: { baslangic: Tarih; ilkKiraBaslangici: Tarih; sozlesmeNo: string }, baglam: IslemBaglami, bugun: Tarih,
): Promise<void> {
  const o = await tx.sozlesme.findUnique({ where: { id: oncekiId } })
  if (!o) return
  if (tarihDb(o.ilkKiraBaslangici) !== yeni.ilkKiraBaslangici) {
    throw new IsKuraliHatasi('YENILEME', 'Yenileme sözleşmesinin ilk kira başlangıcı önceki sözleşmeyle aynı olmalı (TBK 344/347 süreleri).')
  }
  if (o.durum !== 'AKTIF' && o.durum !== 'UZADI') return
  const sinir = gunEkle(yeni.baslangic, -1)
  // sozlesme_tarih_sirasi (bitis >= baslangic) ihlali ham veritabanı hatası yerine anlaşılır bir iş kuralı hatası olsun.
  if (karsilastir(sinir, tarihDb(o.baslangic)) < 0) {
    throw new IsKuraliHatasi('YENILEME', 'Yenileme sözleşmesi, önceki sözleşmenin başlangıcından sonraki bir tarihte başlamalı.')
  }
  const eskiBitis = tarihDbOpt(o.bitis)
  const yeniBitis = eskiBitis === null ? sinir : enKucukTarih(eskiBitis, sinir)
  // Kesim otomatik uzama yıllarına denk geliyorsa, kesimden sonra başlayan uzama yılları hiç yaşanmamış sayılır.
  const geriAlinanUzama = eskiBitis !== null && karsilastir(sinir, eskiBitis) < 0
    ? Math.floor(ayFarki(gunEkle(sinir, 1), gunEkle(eskiBitis, 1)) / 12)
    : 0
  const uzamaSayisi = Math.max(0, o.uzamaSayisi - geriAlinanUzama)
  const r = await tx.sozlesme.updateMany({
    where: { id: o.id, version: o.version },
    data: { bitis: dbTarih(yeniBitis), durum: 'SONA_ERDI', uzamaSayisi, version: { increment: 1 } },
  })
  if (r.count === 0) throw new CakismaHatasi()
  const devredilenTaksitIdleri = await yenilemeyeDevret(tx, o, yeni, bugun)
  const plan = await taksitPlaniniGuncelle(tx, o.id, bugun)
  // uzamaSayisi yalnızca değiştiyse denetim satırına yazılır (kapanış otomatik uzama yıllarına denk gelmişse).
  const uzamaDegisti = uzamaSayisi !== o.uzamaSayisi
  await denetimKaydi(tx, baglam, {
    varlik: 'sozlesme', varlikId: o.id, eylem: 'YENILEME_ILE_SONA_ERDI',
    once: { bitis: eskiBitis, durum: o.durum, ...(uzamaDegisti ? { uzamaSayisi: o.uzamaSayisi } : {}) },
    sonra: { bitis: yeniBitis, durum: 'SONA_ERDI', ...(uzamaDegisti ? { uzamaSayisi } : {}), devredilenTaksitIdleri, plan },
  })
}

export async function sozlesmeAktiflestir(id: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Sözleşme satır kilidi işlemin İLK ifadesidir (yaşam döngüsü ve artış işlemleriyle aynı kural): kira dönemi eklemeden (FOR KEY SHARE)
    // ve durum güncellemesinden önce alınmazsa plan güncellemesindeki FOR UPDATE yükseltmesi eşzamanlı bir işlemle karşılıklı bekler (40P01).
    // Yenilemede sıra yeni → eski: önce bu (yeni) sözleşme, sonra `oncekiSozlesmeyiKapat` içinde eskisi kilitlenir.
    await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
    const s = await tx.sozlesme.findUnique({ where: { id }, include: { malikler: { include: { kisi: true, iban: true } } } })
    if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
    if (s.durum !== 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Yalnızca taslak sözleşmeler aktifleştirilebilir.')
    const bas = tarihDb(s.baslangic)
    const gecerli = s.malikler.filter((m) => icindeMi(bas, { baslangic: tarihDb(m.gecerlilikBaslangic), bitis: tarihDbOpt(m.gecerlilikBitis) }))
    if (!hisseToplamiBirMi(gecerli)) throw new IsKuraliHatasi('HISSE', 'Başlangıç tarihinde malik hisselerinin toplamı 1 değil.')
    for (const m of gecerli) {
      if (!ibanUygunMu(m, m.iban)) {
        throw new IsKuraliHatasi('IBAN', `${kisiGorunenAd(m.kisi)} için ödemenin yapılacağı kişiye ait aktif bir IBAN seçin.`)
      }
    }
    const r = await tx.sozlesme.updateMany({ where: { id, version, durum: 'TASLAK' }, data: { durum: 'AKTIF', version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    const gecis = tarihDbOpt(s.gecisTarihi)
    await tx.kiraDonemi.create({
      data: {
        sozlesmeId: id, baslangic: s.baslangic, bitis: gecis === null ? null : dbTarih(gunEkle(gecis, -1)),
        bedelTutari: s.bedelTutari, bedelTabani: s.bedelTabani, kaynak: 'ILK', olusturanId: baglam.kullaniciId,
      },
    })
    if (gecis !== null && s.gecisBedeli !== null) {
      await tx.kiraDonemi.create({
        data: {
          sozlesmeId: id, baslangic: dbTarih(gecis), bitis: null, bedelTutari: s.gecisBedeli, bedelTabani: s.bedelTabani,
          kaynak: 'ELLE', aciklama: 'Sisteme geçişte girilen güncel kira bedeli', olusturanId: baglam.kullaniciId,
        },
      })
    }
    if (s.oncekiSozlesmeId !== null) {
      await oncekiSozlesmeyiKapat(tx, s.oncekiSozlesmeId, { baslangic: bas, ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), sozlesmeNo: s.sozlesmeNo }, baglam, bugun)
    }
    const plan = await taksitPlaniniGuncelle(tx, id, bugun)
    const damgaKaydiId = await damgaIlkKaydiOlustur(tx, id, baglam, bugun)
    await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: id, eylem: 'AKTIFLESTIR', sonra: { durum: 'AKTIF', plan, damgaKaydiId } })
  }, { timeout: 60_000 })
}
