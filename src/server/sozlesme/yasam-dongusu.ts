import { hisseToplamiBirMi } from '@/core/hisse'
import { uzamaBitisi } from '@/core/takvim'
import { ayEkle, ayFarki, bugunIstanbul, formatTarih, gunEkle, karsilastir, type Tarih } from '@/core/tarih'
import { tbk347KapsamindaMi, type TasinmazTuru } from '@/core/tipler'
import type { Prisma } from '@/generated/prisma'
import { SISTEM_BAGLAMI, type IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { taksitPlaniniGuncelle } from '../taksit/servis'
import type { MalikGirdisi } from './sema'
import { ibanUygunMu, malikReferanslariniDogrula } from './servis'

/** Taksit planını yeniden üreten işlemler çok sayıda satır yazar; Prisma'nın 5 sn'lik varsayılanı yetmez (aktifleştirmedeki gibi). */
const PLAN_ISLEMI = { timeout: 60_000 }

/**
 * Sözleşme satır kilidi (`taksitPlaniniGuncelle` ile aynı kilit). Her yaşam döngüsü işleminin İLK ifadesidir: alt satır
 * eklemeden (sozlesme_malik) ya da sürüm artırmadan önce alınmazsa FOR KEY SHARE → FOR UPDATE yükseltmesi iki işlem
 * arasında kilitlenme (40P01) üretir. Kilit alındıktan sonraki okuma, kilidi bekleyen işlemin sonucunu da görür.
 */
async function sozlesmeyiKilitle(tx: Tx, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
}

async function surumIleGetir(tx: Tx, id: number, version: number) {
  await sozlesmeyiKilitle(tx, id)
  const s = await tx.sozlesme.findUnique({ where: { id } })
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  if (s.version !== version) throw new CakismaHatasi()
  return s
}

async function surumArtir(tx: Tx, id: number, version: number, data: Prisma.SozlesmeUpdateManyMutationInput = {}): Promise<void> {
  const r = await tx.sozlesme.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } })
  if (r.count === 0) throw new CakismaHatasi()
}

function aktifMi(durum: string): boolean {
  return durum === 'AKTIF' || durum === 'UZADI'
}

/** Denetim satırı için malik özeti: yalnızca kimlikler ve paylar; kişi adı, kimlik numarası ve IBAN değeri yazılmaz. */
function malikSatirlari(malikler: readonly MalikGirdisi[]): MalikGirdisi[] {
  return malikler
    .map((m) => ({ kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId }))
    .sort((a, b) => a.kisiId - b.kisiId)
}

export async function malikleriDegistir(
  sozlesmeId: number, version: number, g: { tarih: Tarih; malikler: MalikGirdisi[] }, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul(),
): Promise<void> {
  if (!hisseToplamiBirMi(g.malikler)) throw new IsKuraliHatasi('HISSE', 'Yeni malik hisselerinin toplamı tam olarak 1 olmalı.', 'malikler')
  if (new Set(g.malikler.map((m) => m.kisiId)).size !== g.malikler.length) {
    throw new IsKuraliHatasi('MALIK', 'Aynı kişi birden fazla kez malik olarak eklenemez.', 'malikler')
  }
  await prisma.$transaction(async (tx) => {
    const s = await surumIleGetir(tx, sozlesmeId, version)
    if (!aktifMi(s.durum)) throw new IsKuraliHatasi('DURUM', 'Malik değişikliği yalnızca yürürlükteki sözleşmede yapılır.')
    if (karsilastir(g.tarih, tarihDb(s.baslangic)) <= 0) throw new IsKuraliHatasi('TARIH', 'Değişiklik tarihi sözleşme başlangıcından sonra olmalı.', 'tarih')
    const bitis = tarihDbOpt(s.bitis)
    if (bitis !== null && karsilastir(g.tarih, bitis) > 0) throw new IsKuraliHatasi('TARIH', 'Değişiklik tarihi sözleşme bitişinden sonra olamaz.', 'tarih')
    const acik = await tx.sozlesmeMalik.findMany({ where: { sozlesmeId, gecerlilikBitis: null } })
    if (acik.some((m) => karsilastir(tarihDb(m.gecerlilikBaslangic), g.tarih) >= 0)) {
      throw new IsKuraliHatasi('TARIH', 'Bu tarihte veya sonrasında başlayan malik kaydı var.', 'tarih')
    }
    await malikReferanslariniDogrula(tx, g.malikler)
    for (const m of g.malikler) {
      const iban = m.ibanId === null ? null : await tx.iban.findUnique({ where: { id: m.ibanId } })
      if (!ibanUygunMu(m, iban)) {
        throw new IsKuraliHatasi('IBAN', 'Her malik için ödemenin yapılacağı kişiye ait aktif bir IBAN seçin.', 'malikler')
      }
    }
    await tx.sozlesmeMalik.updateMany({ where: { sozlesmeId, gecerlilikBitis: null }, data: { gecerlilikBitis: dbTarih(gunEkle(g.tarih, -1)) } })
    for (const m of g.malikler) {
      await tx.sozlesmeMalik.create({ data: { sozlesmeId, kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId, gecerlilikBaslangic: dbTarih(g.tarih) } })
    }
    await surumArtir(tx, sozlesmeId, version)
    const plan = await taksitPlaniniGuncelle(tx, sozlesmeId, bugun)
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'MALIK_DEGISTI',
      once: { malikler: malikSatirlari(acik) },
      sonra: { tarih: g.tarih, malikler: malikSatirlari(g.malikler), degisenAlanlar: ['malikler'], plan },
    })
  }, PLAN_ISLEMI)
}

export async function sozlesmeFeshet(id: number, version: number, g: { tarih: Tarih; neden: string }, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  const neden = g.neden.trim()
  if (neden.length < 3) throw new IsKuraliHatasi('NEDEN', 'Fesih nedenini yazın.', 'neden')
  await prisma.$transaction(async (tx) => {
    const s = await surumIleGetir(tx, id, version)
    if (!aktifMi(s.durum)) throw new IsKuraliHatasi('DURUM', 'Yalnızca yürürlükteki sözleşme feshedilebilir.')
    if (karsilastir(g.tarih, tarihDb(s.baslangic)) < 0) throw new IsKuraliHatasi('TARIH', 'Fesih tarihi başlangıçtan önce olamaz.', 'tarih')
    const bitis = tarihDbOpt(s.bitis)
    if (bitis !== null && karsilastir(g.tarih, bitis) > 0) throw new IsKuraliHatasi('TARIH', 'Fesih tarihi sözleşme bitişinden sonra olamaz.', 'tarih')
    await surumArtir(tx, id, version, { durum: 'FESHEDILDI', fesihTarihi: dbTarih(g.tarih), fesihNedeni: neden })
    const artis = await tx.artisHesabi.updateMany({
      where: { sozlesmeId: id, donemBaslangic: { gt: dbTarih(g.tarih) }, durum: { in: ['BEKLEMEDE', 'HESAPLANDI'] } },
      data: { durum: 'IPTAL' },
    })
    const plan = await taksitPlaniniGuncelle(tx, id, bugun)
    // Plan yalnızca PLANLANDI taksitlere dokunur; fesihten sonrasına ait ödeme sürecine girmiş ya da ödenmiş taksitler
    // olduğu gibi kalır. Sayısı F2'nin alacak/iade işlemleri için işaret olarak denetim satırına yazılır.
    const islenmis = await tx.taksit.count({
      where: { sozlesmeId: id, durum: { in: ['PAKETTE', 'ODEME_EMRINDE', 'ODENDI'] }, donemBaslangic: { gte: dbTarih(g.tarih) } },
    })
    // Fesih nedeni serbest metindir (kişi adı, telefon içerebilir): değeri denetim satırına yazılmaz, yalnız değiştiği belirtilir.
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: id, eylem: 'FESHET',
      once: { durum: s.durum },
      sonra: {
        durum: 'FESHEDILDI', fesihTarihi: g.tarih, degisenAlanlar: ['durum', 'fesihTarihi', 'fesihNedeni'],
        iptalEdilenArtis: artis.count, fesihSonrasiIslenmisTaksit: islenmis, plan,
      },
    })
  }, PLAN_ISLEMI)
}

/** Yenileme numarası: aynı kökün en büyük `-Yn` soneki + 1 (silinen taslaklar ya da elle verilen numaralar boşluk bırakabilir). */
async function sonrakiYenilemeNo(tx: Tx, kok: string): Promise<string> {
  const mevcut = await tx.sozlesme.findMany({ where: { sozlesmeNo: { startsWith: `${kok}-Y` } }, select: { sozlesmeNo: true } })
  const sonekler = mevcut.map((x) => x.sozlesmeNo.slice(kok.length + 2)).filter((ek) => /^\d{1,9}$/.test(ek)).map(Number)
  return `${kok}-Y${Math.max(0, ...sonekler) + 1}`
}

export async function sozlesmeYenile(id: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      await sozlesmeyiKilitle(tx, id)
      const e = await tx.sozlesme.findUnique({
        where: { id },
        include: { sonrakiSozlesme: true, malikler: { where: { gecerlilikBitis: null } }, kiraDonemleri: { orderBy: { baslangic: 'desc' }, take: 1 } },
      })
      if (!e) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
      if (e.sonrakiSozlesme) throw new IsKuraliHatasi('YENILEME', 'Bu sözleşmenin yenileme kaydı zaten var.')
      if (e.durum === 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Taslak sözleşme yenilenemez.')
      if (e.durum === 'FESHEDILDI') throw new IsKuraliHatasi('YENILEME', 'Feshedilmiş sözleşme yenilenemez; yeni sözleşme girin.')
      const eskiBitis = tarihDbOpt(e.bitis)
      const yeniBaslangic = gunEkle(eskiBitis ?? bugun, 1)
      // Süre: otomatik uzama yılları düşülür; yenileme sözleşmenin ilk süresi kadar olur, geçen toplam süre kadar değil.
      const sureAy = eskiBitis === null ? null : ayFarki(tarihDb(e.baslangic), gunEkle(eskiBitis, 1)) - 12 * e.uzamaSayisi
      const yeniBitis = sureAy === null || sureAy < 1 ? null : gunEkle(ayEkle(yeniBaslangic, sureAy), -1)
      const sonKd = e.kiraDonemleri[0]
      const kok = e.sozlesmeNo.replace(/-Y\d+$/, '')
      const y = await tx.sozlesme.create({
        data: {
          sozlesmeNo: await sonrakiYenilemeNo(tx, kok), tasinmazId: e.tasinmazId, birimId: e.birimId, ekonomikKod: e.ekonomikKod,
          baslangic: dbTarih(yeniBaslangic), bitis: yeniBitis === null ? null : dbTarih(yeniBitis), ilkKiraBaslangici: e.ilkKiraBaslangici,
          oncekiSozlesmeId: e.id, bedelTutari: sonKd?.bedelTutari ?? e.bedelTutari, bedelTabani: sonKd?.bedelTabani ?? e.bedelTabani,
          bedelTuru: e.bedelTuru, odemePeriyoduAy: e.odemePeriyoduAy, odemeZamani: e.odemeZamani, vadeKurali: e.vadeKurali,
          vadeParametresi: e.vadeParametresi, artisKurali: e.artisKurali, artisDegisimTuru: e.artisDegisimTuru,
          sabitArtisOrani: e.sabitArtisOrani, artisPeriyoduAy: e.artisPeriyoduAy, kistYontemi: e.kistYontemi,
          damgaTahsil: e.damgaTahsil, ihaleDayanagi: e.ihaleDayanagi,
        },
      })
      for (const m of e.malikler) {
        await tx.sozlesmeMalik.create({ data: { sozlesmeId: y.id, kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId, gecerlilikBaslangic: dbTarih(yeniBaslangic) } })
      }
      await denetimKaydi(tx, baglam, {
        varlik: 'sozlesme', varlikId: y.id, eylem: 'YENILEME_TASLAGI',
        sonra: { oncekiSozlesmeId: e.id, sozlesmeNo: y.sozlesmeNo, baslangic: yeniBaslangic, bitis: yeniBitis, malikler: malikSatirlari(e.malikler) },
      })
      return y.id
    })
  } catch (e) {
    // Satır kilidi aynı sözleşmenin çift yenilenmesini önler; kalan benzersizlik ihlali, numarayı okuyup yazma arasında
    // aynı numarayı kaydeden başka bir işlemdir.
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('SOZLESME_NO', 'Yenileme için üretilen sözleşme numarası başka bir sözleşmede kullanılıyor.')
    throw e
  }
}

/**
 * Spec §7.3 arsa kararı (sona erdir / belirsiz süreliye çevir) denetimi: yalnızca bitişi geçmiş, yürürlükteki arsa kirası.
 * Konut ve çatılı işyeri kendiliğinden uzar (TBK 347); bu kararlar onlar için geçerli değildir. Bitiş tarihini döndürür.
 */
async function arsaKarariniDenetle(tx: Tx, s: { tasinmazId: number; durum: string; bitis: Date | null }, bugun: Tarih): Promise<Tarih> {
  const bitis = tarihDbOpt(s.bitis)
  if (!aktifMi(s.durum) || bitis === null) throw new IsKuraliHatasi('DURUM', 'Yalnızca belirli süreli, yürürlükteki sözleşme için karar verilebilir.')
  const tasinmaz = await tx.tasinmaz.findUniqueOrThrow({ where: { id: s.tasinmazId }, select: { tur: true } })
  if (tbk347KapsamindaMi(tasinmaz.tur)) {
    throw new IsKuraliHatasi('TUR', 'Konut ve çatılı işyeri sözleşmeleri kendiliğinden uzar (TBK 347); bu karar yalnızca arsa kiraları için verilir.')
  }
  if (karsilastir(bitis, bugun) >= 0) throw new IsKuraliHatasi('DURUM', 'Karar, sözleşme bitiş tarihi geçtikten sonra verilir.')
  return bitis
}

export async function sozlesmeSonlandir(id: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const s = await surumIleGetir(tx, id, version)
    const bitis = await arsaKarariniDenetle(tx, s, bugun)
    await surumArtir(tx, id, version, { durum: 'SONA_ERDI' })
    await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: id, eylem: 'SONA_ERDI', once: { durum: s.durum, bitis }, sonra: { durum: 'SONA_ERDI' } })
  })
}

export async function belirsizSureliyeCevir(id: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const s = await surumIleGetir(tx, id, version)
    const bitis = await arsaKarariniDenetle(tx, s, bugun)
    await surumArtir(tx, id, version, { bitis: null })
    const plan = await taksitPlaniniGuncelle(tx, id, bugun)
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: id, eylem: 'BELIRSIZ_SURELIYE_CEVRILDI',
      once: { bitis }, sonra: { bitis: null, degisenAlanlar: ['bitis'], plan },
    })
  }, PLAN_ISLEMI)
}

export async function taslakSil(id: number, version: number, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const s = await surumIleGetir(tx, id, version)
    if (s.durum !== 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Yalnızca taslak sözleşme silinebilir.')
    const malikler = await tx.sozlesmeMalik.findMany({ where: { sozlesmeId: id } })
    const r = await tx.sozlesme.deleteMany({ where: { id, version, durum: 'TASLAK' } })
    if (r.count === 0) throw new CakismaHatasi()
    // Satırın tamamı değil kimlik ve tarih özeti: notlar serbest metindir, taşınmaz/kişi alanları kişisel veri içerebilir.
    await denetimKaydi(tx, baglam, {
      varlik: 'sozlesme', varlikId: id, eylem: 'TASLAK_SILINDI',
      once: {
        sozlesmeNo: s.sozlesmeNo, tasinmazId: s.tasinmazId, birimId: s.birimId, oncekiSozlesmeId: s.oncekiSozlesmeId,
        baslangic: tarihDb(s.baslangic), bitis: tarihDbOpt(s.bitis), malikler: malikSatirlari(malikler),
      },
    })
  })
}

interface UzamaAdayi { id: number; sozlesmeNo: string; bitis: Date | null; tasinmaz: { tur: TasinmazTuru; kisaAd: string } }

/**
 * TBK 347: bitişi geçmiş konut/çatılı işyeri sözleşmeleri birer yıl uzar; arsa uzamaz (TBK 327).
 *
 * Aday listesi kilitsiz okunur, bu yüzden bayat olabilir: her sözleşme kilitlenip yeniden okunur ve koşullar yeniden denetlenir
 * (araya giren fesih/sona erme/uzama sözleşmeyi listeden düşürür). Sözleşme başına SAVEPOINT: bir sözleşmedeki
 * CakismaHatasi ya da IsKuraliHatasi yalnızca o sözleşmenin yazılarını geri alır, KRITIK bir UZAMA_HATA hatırlatması yazılır
 * ve toplu işlem sonraki sözleşmeyle devam eder; atlanan sözleşme ertesi çalışmada yine adaydır. Dönüş: uzatılan sözleşme sayısı.
 *
 * `sozlesmeId` verilirse yalnızca o sözleşme aday olur (gece işi her sözleşmeyi kendi kısa işleminde çalıştırır); verilmezse davranış aynıdır.
 */
export async function otomatikUzat(tx: Tx, bugun: Tarih, baglam: IslemBaglami = SISTEM_BAGLAMI, sozlesmeId?: number): Promise<number> {
  const adaylar: UzamaAdayi[] = await tx.sozlesme.findMany({
    where: { durum: { in: ['AKTIF', 'UZADI'] }, bitis: { lt: dbTarih(bugun) }, ...(sozlesmeId === undefined ? {} : { id: sozlesmeId }) },
    select: { id: true, sozlesmeNo: true, bitis: true, tasinmaz: { select: { tur: true, kisaAd: true } } },
    orderBy: { id: 'asc' },
  })
  let sayi = 0
  for (const aday of adaylar) {
    const adayBitis = tarihDbOpt(aday.bitis)
    if (adayBitis === null || !tbk347KapsamindaMi(aday.tasinmaz.tur)) continue
    await tx.$executeRaw`SAVEPOINT otomatik_uzama`
    try {
      if (await sozlesmeyiUzat(tx, aday, bugun, baglam)) sayi += 1
      await tx.$executeRaw`RELEASE SAVEPOINT otomatik_uzama`
    } catch (e) {
      if (!(e instanceof CakismaHatasi || e instanceof IsKuraliHatasi)) throw e
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT otomatik_uzama`
      await tx.$executeRaw`RELEASE SAVEPOINT otomatik_uzama`
      await uzamaHatasiniBildir(tx, aday, adayBitis, e.message, bugun)
    }
  }
  return sayi
}

/** Kilitli, yeniden okunmuş sözleşmeyi uzatır; araya giren değişiklikle aday olmaktan çıkmışsa false döner. */
async function sozlesmeyiUzat(tx: Tx, aday: UzamaAdayi, bugun: Tarih, baglam: IslemBaglami): Promise<boolean> {
  await sozlesmeyiKilitle(tx, aday.id)
  const s = await tx.sozlesme.findUnique({ where: { id: aday.id } })
  const eski = s?.bitis ? tarihDb(s.bitis) : null
  if (!s || !aktifMi(s.durum) || eski === null || karsilastir(eski, bugun) >= 0) return false
  // Kaçırılan yıllar tek seferde telafi edilir. Bitiş sözleşme başlangıcına çapalı ay ızgarasındaysa her yıl başlangıçtan
  // hesaplanır (uzamaBitisi zinciri, 29-31. gün çapalı sözleşmede şubat ayında bir gün kaydırır); ızgara dışındaysa
  // (elle verilmiş ya da önceden kaymış bitiş) zincirleme kalır, çapaya çekmek gün kaybettirirdi.
  const bas = tarihDb(s.baslangic)
  const ay = ayFarki(bas, gunEkle(eski, 1))
  const capali = gunEkle(ayEkle(bas, ay), -1) === eski
  let yeni = eski
  let yil = 0
  while (karsilastir(yeni, bugun) < 0) {
    yil += 1
    yeni = capali ? gunEkle(ayEkle(bas, ay + 12 * yil), -1) : uzamaBitisi(yeni)
  }
  await surumArtir(tx, aday.id, s.version, { durum: 'UZADI', bitis: dbTarih(yeni), uzamaSayisi: { increment: yil } })
  const plan = await taksitPlaniniGuncelle(tx, aday.id, bugun)
  await denetimKaydi(tx, baglam, {
    varlik: 'sozlesme', varlikId: aday.id, eylem: 'OTOMATIK_UZAMA',
    once: { durum: s.durum, bitis: eski, uzamaSayisi: s.uzamaSayisi },
    sonra: { durum: 'UZADI', bitis: yeni, uzamaSayisi: s.uzamaSayisi + yil, plan },
  })
  // Spec §7.3: kullanıcıya bilgi. Anahtar yeni bitişi taşır; satır varsa (kullanıcı kapatmış olabilir) dokunulmaz.
  const anahtar = `UZAMA:sozlesme:${aday.id}:${yeni}`
  await tx.hatirlatma.upsert({
    where: { anahtar },
    create: {
      anahtar, kural: 'UZAMA_BILGI', iliskiliTur: 'sozlesme', iliskiliId: String(aday.id), sozlesmeId: aday.id,
      baslik: `Sözleşme kendiliğinden uzadı — ${s.sozlesmeNo}`,
      aciklama: `${aday.tasinmaz.kisaAd}: TBK 347 uyarınca ${formatTarih(yeni)} tarihine kadar uzadı.`,
      hedefTarih: dbTarih(gunEkle(eski, 1)), gorunurTarih: dbTarih(bugun), oncelik: 'NORMAL', kararGerekli: false,
    },
    update: {},
  })
  return true
}

/** Uzatılamayan sözleşme için karar gerektiren KRITIK hatırlatma; ileti Türkçe iş kuralı iletisidir (kişisel veri içermez). */
async function uzamaHatasiniBildir(tx: Tx, aday: UzamaAdayi, eskiBitis: Tarih, mesaj: string, bugun: Tarih): Promise<void> {
  const anahtar = `UZAMA_HATA:sozlesme:${aday.id}:${eskiBitis}`
  await tx.hatirlatma.upsert({
    where: { anahtar },
    create: {
      anahtar, kural: 'UZAMA_HATA', iliskiliTur: 'sozlesme', iliskiliId: String(aday.id), sozlesmeId: aday.id,
      baslik: `Otomatik uzama yapılamadı — ${aday.sozlesmeNo}`, aciklama: mesaj,
      hedefTarih: dbTarih(gunEkle(eskiBitis, 1)), gorunurTarih: dbTarih(bugun), oncelik: 'KRITIK', kararGerekli: true,
    },
    update: { aciklama: mesaj },
  })
}
