import { Prisma, type OdemePaketi, type PaketDurumu } from '@/generated/prisma'
import { paketHesabi, type PaketHesabi } from '@/core/paket/hesap'
import { SIFIR, type Para } from '@/core/para'
import { formatTarih, karsilastir, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, jsonYaz, paraDb, paraYaz, tarihDb } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { gecerliSorgu, sorguKullanimi } from '../kesinti/servis'
import { kisiGorunenAd } from '../kisi/servis'
import { parametreOran } from '../parametre/servis'
import { taksitPlaniniGuncelle } from '../taksit/servis'
import { paketHesapGirdisiYukle, type HesapParmakIzi, type PaketOnKontrolKaydi } from './hesapla'

const ZAMAN_ASIMI = { timeout: 60_000 }

const yenidenHesapla = (neden: string) => new IsKuraliHatasi('YENIDEN_HESAPLA', `${neden}; paketi yeniden hesaplayın.`)
const KAYNAK_DEGISTI = 'Sözleşme, malik, oran ya da kesinti kaynakları değişti'

interface KilitliPaket { p: OdemePaketi; sozlesmeIdleri: number[]; taksitIdleri: number[] }

/**
 * Paketin aktif taksitlerinin sözleşmelerini `id DESC` sırasıyla (F1'in toplu artış ve yenileme sırası), ardından paket satırını kilitler
 * ve paketi kilit altında okur. Sözleşme kilidi işlemin ilk kilididir; taksit, haciz, damga payı ve sorgu kilitleri bundan sonra gelir.
 */
async function paketiKilitle(tx: Tx, paketId: number): Promise<KilitliPaket> {
  const satirlar = await tx.$queryRaw<{ sozlesme_id: number }[]>`
    SELECT DISTINCT t.sozlesme_id FROM paket_taksit pt JOIN taksit t ON t.id = pt.taksit_id WHERE pt.paket_id = ${paketId} AND pt.aktif`
  const sozlesmeIdleri = satirlar.map((x) => x.sozlesme_id).sort((a, b) => b - a)
  if (sozlesmeIdleri.length > 0) await tx.$queryRaw`SELECT id FROM sozlesme WHERE id IN (${Prisma.join(sozlesmeIdleri)}) ORDER BY id DESC FOR UPDATE`
  const kilit = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM odeme_paketi WHERE id = ${paketId} FOR UPDATE`
  if (kilit.length === 0) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  const p = await tx.odemePaketi.findUniqueOrThrow({ where: { id: paketId } })
  const taksitIdleri = (await tx.paketTaksit.findMany({ where: { paketId, aktif: true }, select: { taksitId: true }, orderBy: { taksitId: 'asc' } })).map((x) => x.taksitId)
  return { p, sozlesmeIdleri, taksitIdleri }
}

function durumDenetle(p: OdemePaketi, version: number, beklenen: PaketDurumu, mesaj: string): void {
  if (p.durum !== beklenen) throw new IsKuraliHatasi('DURUM', mesaj)
  if (p.version !== version) throw new CakismaHatasi()
}

/** Paket satırını koşullu (sürümle) günceller; sürüm her geçişte artar. */
async function paketiGuncelle(tx: Tx, paketId: number, version: number, data: Prisma.OdemePaketiUpdateManyMutationInput): Promise<void> {
  const r = await tx.odemePaketi.updateMany({ where: { id: paketId, version }, data: { ...data, version: { increment: 1 } } })
  if (r.count === 0) throw new CakismaHatasi()
}

/** Taksit durum geçişi; etkilenen satır sayısı paketin aktif taksit sayısına eşit olmalıdır. */
async function taksitleriGecir(tx: Tx, ids: number[], once: readonly ('PLANLANDI' | 'PAKETTE' | 'ODEME_EMRINDE' | 'ODENDI')[], data: Prisma.TaksitUpdateManyMutationInput): Promise<void> {
  if (ids.length === 0) return
  const r = await tx.taksit.updateMany({ where: { id: { in: ids }, durum: { in: [...once] } }, data: { ...data, version: { increment: 1 } } })
  if (r.count !== ids.length) throw new CakismaHatasi()
}

const nedenDenetle = (neden: string, etiket: string): string => {
  const n = neden.trim()
  if (n.length === 0 || n.length > 500) throw new IsKuraliHatasi('NEDEN', `${etiket} 1–500 karakter olmalı.`, 'neden')
  return n
}

const onKontrolKaydi = (p: OdemePaketi) => p.onKontrol as unknown as PaketOnKontrolKaydi
const parmakIzi = (p: OdemePaketi) => p.hesapParmakIzi as unknown as HesapParmakIzi

async function kisiAdi(tx: Tx, kisiId: string): Promise<string> {
  return kisiGorunenAd(await tx.kisi.findUniqueOrThrow({ where: { id: Number(kisiId) }, select: { tip: true, ad: true, soyad: true, unvan: true } }))
}

/** Paketin kesinti satırları kaynak türüne göre toplanır (kaynak kimliği → tutar). */
async function kaynakToplamlari(tx: Tx, paketId: number) {
  const satirlar = await tx.dagilimKesinti.findMany({ where: { paketId }, select: { tur: true, tutar: true, hacizId: true, damgaPayiId: true, borcSorguId: true } })
  const topla = (m: Map<number, Para>, id: number | null, tutar: Para) => { if (id !== null) m.set(id, (m.get(id) ?? SIFIR).plus(tutar)) }
  const haciz = new Map<number, Para>()
  const damga = new Map<number, Para>()
  const sorgu = new Map<number, Para>()
  for (const k of satirlar) {
    const tutar = paraDb(k.tutar)
    if (k.tur === 'HACIZ') topla(haciz, k.hacizId, tutar)
    else if (k.tur === 'DAMGA') topla(damga, k.damgaPayiId, tutar)
    else topla(sorgu, k.borcSorguId, tutar)
  }
  return { haciz, damga, sorgu }
}

const sirali = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b)

/** Kesinti kaynaklarını tür başına `id` sırasıyla kilitler (haciz → damga payı → sorgu); kesinleştirme ve iptal aynı sırayı kullanır. */
async function kaynaklariKilitle(tx: Tx, k: { haciz: Iterable<number>; damga: Iterable<number>; sorgu: Iterable<number> }): Promise<void> {
  const h = sirali(k.haciz)
  const d = sirali(k.damga)
  const s = sirali(k.sorgu)
  if (h.length > 0) await tx.$queryRaw`SELECT id FROM haciz WHERE id IN (${Prisma.join(h)}) ORDER BY id FOR UPDATE`
  if (d.length > 0) await tx.$queryRaw`SELECT id FROM damga_payi WHERE id IN (${Prisma.join(d)}) ORDER BY id FOR UPDATE`
  if (s.length > 0) await tx.$queryRaw`SELECT id FROM borc_sorgu WHERE id IN (${Prisma.join(s)}) ORDER BY id FOR UPDATE`
}

const ayniDizi = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
// Anahtarlar tamsayı biçimli olduğundan iki tarafta da artan sırada sayılır; JSON metni karşılaştırma için kanoniktir.
const ayniKayit = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(a) === JSON.stringify(b)

function ayniParmakIzi(a: HesapParmakIzi, b: HesapParmakIzi): boolean {
  return ayniKayit(a.sozlesmeler, b.sozlesmeler) && ayniKayit(a.kisiler, b.kisiler) && ayniKayit(a.taksitler, b.taksitler)
    && ayniDizi(a.hacizler, b.hacizler) && ayniDizi(a.damgaPaylari, b.damgaPaylari) && ayniDizi(a.sorgular, b.sorgular)
}

/** Saklanan dağılım satırlarını yeniden hesapla satır satır karşılaştırır: kimlikler, tutarlar ve kesinti kaynakları. */
async function ayniSatirlar(tx: Tx, paketId: number, h: PaketHesabi): Promise<boolean> {
  const saklanan = await tx.taksitDagilim.findMany({ where: { paketId }, orderBy: { sira: 'asc' }, include: { kesintiler: true } })
  const p = (x: Prisma.Decimal) => paraYaz(paraDb(x))
  const eski = saklanan.map((d) => [
    d.taksitId, d.sozlesmeMalikId, d.kisiId, d.odemeKisiId, d.ibanId ?? '-', d.parca, tarihDb(d.parcaBaslangic), tarihDb(d.parcaBitis),
    p(d.brut), p(d.kdv), p(d.stopaj), p(d.damgaKesintisi), p(d.hacizKesintisi), p(d.kesinti22a), p(d.net),
    d.kesintiler.map((k) => `${k.tur}:${p(k.tutar)}:${k.hacizId ?? k.damgaPayiId ?? k.borcSorguId}`).sort().join(','),
  ].join('|'))
  const yeni = h.satirlar.map((s) => [
    s.taksitId, s.sozlesmeMalikId, s.kisiId, s.odemeKisiId, s.ibanId ?? '-', s.parca, s.parcaBaslangic, s.parcaBitis,
    paraYaz(s.brut), paraYaz(s.kdv), paraYaz(s.stopaj), paraYaz(s.damga), paraYaz(s.haciz), paraYaz(s.kesinti22a), paraYaz(s.net),
    h.kesintiler.filter((k) => k.satirAnahtari === s.anahtar).map((k) => `${k.tur}:${paraYaz(k.tutar)}:${k.kaynakId}`).sort().join(','),
  ].join('|'))
  return ayniDizi(eski, yeni)
}

/**
 * Spec §10.1-4: paketi kesinleştirir. Hesap aynı gün yapılmış, ön kontrolü hatasız ve dayandığı veri değişmemiş olmalıdır; bu, kilitler
 * alındıktan sonra hesap yinelenip saklanan parmak izi ve satırlarla karşılaştırılarak denetlenir. Taksitler PAKETTE olur, haciz ve damga
 * payı kalanları düşer (22/A kullanımı kesinleşmiş paketlerin kesinti satırlarından okunur).
 */
export async function paketKesinlestir(paketId: number, version: number, baglam: IslemBaglami, bugun: Tarih): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { p, taksitIdleri } = await paketiKilitle(tx, paketId)
    durumDenetle(p, version, 'HESAPLANDI', 'Yalnızca hesaplanmış paket kesinleştirilebilir.')
    const hesapTarihi = tarihDb(p.hesapTarihi!)
    if (hesapTarihi !== bugun) throw yenidenHesapla(`Hesap ${formatTarih(hesapTarihi)} tarihinde yapıldı`)
    const kayit = onKontrolKaydi(p)
    if (kayit.hatalar.length > 0) throw new IsKuraliHatasi('ON_KONTROL', `Ön kontrolde hata var: ${kayit.hatalar.map((b) => b.mesaj).join(' ')}`)

    const beklenen = new Map((await tx.paketTaksit.findMany({ where: { paketId, aktif: true }, select: { taksitId: true, hesaplananTaksitSurumu: true } }))
      .map((x) => [x.taksitId, x.hesaplananTaksitSurumu]))
    const taksitler = taksitIdleri.length === 0 ? [] : await tx.$queryRaw<{ id: number; durum: string; version: number }[]>`
      SELECT id, durum::text AS durum, version FROM taksit WHERE id IN (${Prisma.join(taksitIdleri)}) ORDER BY id FOR UPDATE`
    if (taksitler.length !== taksitIdleri.length || taksitler.some((t) => t.durum !== 'PLANLANDI' || t.version !== beklenen.get(t.id))) {
      throw yenidenHesapla('Taksit tutarı ya da durumu değişti')
    }

    const iz = parmakIzi(p)
    await kaynaklariKilitle(tx, { haciz: iz.hacizler.map(Number), damga: iz.damgaPaylari.map(Number), sorgu: iz.sorgular.map(Number) })
    const yuklenen = await paketHesapGirdisiYukle(tx, paketId, bugun)
    const h = paketHesabi(yuklenen.girdi)
    if (!ayniParmakIzi(iz, yuklenen.parmakIzi) || h.onKontrol.hatalar.length > 0 || !(await ayniSatirlar(tx, paketId, h))) throw yenidenHesapla(KAYNAK_DEGISTI)

    // Savunma: kalanlar bu paketin kesintisini karşılamalı (yeniden hesap aynı sonucu verdiyse zaten karşılar).
    const k = await kaynakToplamlari(tx, paketId)
    const hacizler = await tx.haciz.findMany({ where: { id: { in: [...k.haciz.keys()] } } })
    const paylar = await tx.damgaPayi.findMany({ where: { id: { in: [...k.damga.keys()] } } })
    const sorgular = await tx.borcSorgu.findMany({ where: { id: { in: [...k.sorgu.keys()] } } })
    const kullanim = await sorguKullanimi(tx, [...k.sorgu.keys()], paketId)
    const yetersiz = hacizler.length !== k.haciz.size || paylar.length !== k.damga.size || sorgular.length !== k.sorgu.size
      || hacizler.some((x) => x.durum !== 'AKTIF' || k.haciz.get(x.id)!.greaterThan(paraDb(x.kalanTutar)))
      || paylar.some((x) => k.damga.get(x.id)!.greaterThan(paraDb(x.kalan)))
      || sorgular.some((x) => karsilastir(tarihDb(x.gecerlilikBitis), bugun) < 0
        || (kullanim.get(x.id) ?? SIFIR).plus(k.sorgu.get(x.id)!).greaterThan(paraDb(x.borcTutari)))
    if (yetersiz) throw yenidenHesapla(KAYNAK_DEGISTI)

    await taksitleriGecir(tx, taksitIdleri, ['PLANLANDI'], { durum: 'PAKETTE' })
    for (const x of hacizler) {
      const kalan = paraDb(x.kalanTutar).minus(k.haciz.get(x.id)!)
      // Otomatik kapanışta kapanış nedeni boş kalır; iptal edilirse haciz yeniden AKTIF olur.
      await tx.haciz.update({ where: { id: x.id }, data: { kalanTutar: paraYaz(kalan), durum: kalan.isZero() ? 'KAPANDI' : 'AKTIF', version: { increment: 1 } } })
    }
    for (const x of paylar) {
      await tx.damgaPayi.update({ where: { id: x.id }, data: { kalan: paraYaz(paraDb(x.kalan).minus(k.damga.get(x.id)!)), version: { increment: 1 } } })
    }
    await paketiGuncelle(tx, paketId, version, { durum: 'KESINLESTI', kesinlestirenId: baglam.kullaniciId, kesinlesmeZamani: new Date() })
    const tutarlar = (m: Map<number, Para>) => Object.fromEntries([...m].map(([id, t]) => [String(id), paraYaz(t)]))
    await denetimKaydi(tx, baglam, {
      varlik: 'odeme_paketi', varlikId: paketId, eylem: 'KESINLESTIR',
      sonra: { taksitIdleri, toplam: kayit.toplam, hacizler: tutarlar(k.haciz), damgaPaylari: tutarlar(k.damga), sorgular: tutarlar(k.sorgu) },
    })
  }, ZAMAN_ASIMI)
}

/**
 * Muhasebe ödeme emri: tarih hesap (kesinleşme) günü ile bugün arasında olmalıdır. 22/A belgesi ödeme emri tarihinde geçerli olmalıdır
 * (spec §6.5.2); hesaptaki sorgunun süresi dolduysa, alıcıdan kesinti yapılmamışsa ve yeni sorgu eşik üstü borç göstermiyorsa yenisi kabul
 * edilir. Kabul edilen sorgu kimlikleri ön kontrol kaydına yazılır (ödendi uyarısı ve ek liste bunu okur); parmak izi değişmez.
 */
export async function paketOdemeEmriGir(paketId: number, version: number, g: { no: string; tarih: Tarih }, baglam: IslemBaglami, bugun: Tarih): Promise<void> {
  const no = g.no.trim()
  if (no.length === 0 || no.length > 50) throw new IsKuraliHatasi('ODEME_EMRI_NO', 'Ödeme emri numarası 1–50 karakter olmalı.', 'no')
  await prisma.$transaction(async (tx) => {
    const { p, taksitIdleri } = await paketiKilitle(tx, paketId)
    durumDenetle(p, version, 'KESINLESTI', 'Ödeme emri yalnızca kesinleşmiş pakete girilir.')
    const hesapTarihi = tarihDb(p.hesapTarihi!)
    if (karsilastir(g.tarih, hesapTarihi) < 0 || karsilastir(g.tarih, bugun) > 0) {
      throw new IsKuraliHatasi('TARIH', `Ödeme emri tarihi ${formatTarih(hesapTarihi)} ile bugün arasında olmalı.`, 'tarih')
    }
    const kayit = onKontrolKaydi(p)
    const hesaptaki = new Set(parmakIzi(p).sorgular)
    const esik = await parametreOran('ESIK_22A_BORC', hesapTarihi, tx)
    const kesintiYapilan = new Set((await tx.dagilimKesinti.findMany({ where: { paketId, tur: 'KESINTI_22A' }, select: { dagilim: { select: { kisiId: true } } } }))
      .map((x) => String(x.dagilim.kisiId)))
    const alicilar: PaketOnKontrolKaydi['alicilar22a'] = []
    for (const a of kayit.alicilar22a) {
      if (!a.sorguGerekli) {
        alicilar.push(a)
        continue
      }
      const s = await gecerliSorgu(tx, Number(a.kisiId), g.tarih)
      if (s === null) {
        throw new IsKuraliHatasi('SORGU_22A', `${await kisiAdi(tx, a.kisiId)} için ${formatTarih(g.tarih)} tarihinde geçerli 22/A borç sorgusu yok; kişi sayfasından yeni sorgu girin.`, 'tarih')
      }
      if (!hesaptaki.has(String(s.id)) && (kesintiYapilan.has(a.kisiId) || (s.borcVar && paraDb(s.borcTutari).greaterThan(esik)))) {
        throw new IsKuraliHatasi('SORGU_22A', `${await kisiAdi(tx, a.kisiId)} için yeni 22/A sorgusu kesintiyi değiştiriyor; paketi iptal edip yeniden hesaplayın.`)
      }
      alicilar.push({ ...a, borcSorguId: String(s.id) })
    }
    await taksitleriGecir(tx, taksitIdleri, ['PAKETTE'], { durum: 'ODEME_EMRINDE' })
    await paketiGuncelle(tx, paketId, version, {
      durum: 'ODEME_EMRINDE', muhasebeOdemeEmriNo: no, muhasebeOdemeEmriTarihi: dbTarih(g.tarih), onKontrol: jsonYaz({ ...kayit, alicilar22a: alicilar }),
    })
    await denetimKaydi(tx, baglam, {
      varlik: 'odeme_paketi', varlikId: paketId, eylem: 'ODEME_EMRI',
      sonra: { no, tarih: g.tarih, sorgular: alicilar.filter((a) => a.sorguGerekli).map((a) => a.borcSorguId) },
    })
  }, ZAMAN_ASIMI)
}

/** Ödeme gerçekleşti: taksitler ODENDI olur. 22/A belgesi ödeme tarihinde geçerli değilse engellemeyen uyarı döner. */
export async function paketOdendi(paketId: number, version: number, odemeTarihi: Tarih, baglam: IslemBaglami, bugun: Tarih): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const { p, taksitIdleri } = await paketiKilitle(tx, paketId)
    durumDenetle(p, version, 'ODEME_EMRINDE', 'Yalnızca ödeme emrindeki paket ödendi olarak işaretlenir.')
    const emri = tarihDb(p.muhasebeOdemeEmriTarihi!)
    if (karsilastir(odemeTarihi, emri) < 0 || karsilastir(odemeTarihi, bugun) > 0) {
      throw new IsKuraliHatasi('TARIH', `Ödeme tarihi ${formatTarih(emri)} ile bugün arasında olmalı.`, 'odemeTarihi')
    }
    await taksitleriGecir(tx, taksitIdleri, ['ODEME_EMRINDE'], { durum: 'ODENDI', odemeTarihi: dbTarih(odemeTarihi) })
    await paketiGuncelle(tx, paketId, version, { durum: 'ODENDI', odemeTarihi: dbTarih(odemeTarihi) })
    const uyarilar: string[] = []
    for (const a of onKontrolKaydi(p).alicilar22a) {
      if (!a.sorguGerekli || a.borcSorguId === null) continue
      const s = await tx.borcSorgu.findUnique({ where: { id: Number(a.borcSorguId) }, select: { gecerlilikBitis: true } })
      if (s && karsilastir(tarihDb(s.gecerlilikBitis), odemeTarihi) < 0) {
        uyarilar.push(`${await kisiAdi(tx, a.kisiId)} için 22/A belgesi ödeme tarihinde geçerli değildi (${formatTarih(tarihDb(s.gecerlilikBitis))}); muhasebe birimine bildirin.`)
      }
    }
    await denetimKaydi(tx, baglam, { varlik: 'odeme_paketi', varlikId: paketId, eylem: 'ODENDI', sonra: { odemeTarihi, uyariSayisi: uyarilar.length } })
    return uyarilar
  }, ZAMAN_ASIMI)
}

/**
 * Paketi iptal eder. Ödenmiş paket iptal edilmez (düzeltme kira dönemi bedelinden yapılır). Kesinleşmiş paketin taksitleri PLANLANDI'ya
 * döner, haciz ve damga payı kalanları geri gelir, ardından sözleşmelerin planı güncellenir (ör. fesihten sonraki dönemin taksiti iptal
 * edilir). Dağılım satırları geçmiş için kalır. İptal nedeni pakette saklanır, denetime yazılmaz.
 */
export async function paketIptal(paketId: number, version: number, neden: string, baglam: IslemBaglami, bugun: Tarih): Promise<void> {
  const n = nedenDenetle(neden, 'İptal nedeni')
  await prisma.$transaction(async (tx) => {
    const { p, sozlesmeIdleri, taksitIdleri } = await paketiKilitle(tx, paketId)
    if (p.durum === 'ODENDI') {
      throw new IsKuraliHatasi('ODENDI', 'Ödenmiş paket iptal edilemez. Tutar hatalıysa kira dönemi bedelini düzeltin; fark taksiti ya da fazla ödeme hatırlatması kendiliğinden oluşur.')
    }
    if (p.durum === 'IPTAL') throw new IsKuraliHatasi('DURUM', 'Paket zaten iptal edilmiş.')
    if (p.version !== version) throw new CakismaHatasi()
    const kesinlesmis = p.durum === 'KESINLESTI' || p.durum === 'ODEME_EMRINDE'
    if (kesinlesmis) {
      await taksitleriGecir(tx, taksitIdleri, ['PAKETTE', 'ODEME_EMRINDE'], { durum: 'PLANLANDI' })
      const k = await kaynakToplamlari(tx, paketId)
      await kaynaklariKilitle(tx, { haciz: k.haciz.keys(), damga: k.damga.keys(), sorgu: [] })
      for (const x of await tx.haciz.findMany({ where: { id: { in: [...k.haciz.keys()] } } })) {
        await tx.haciz.update({
          where: { id: x.id },
          data: { kalanTutar: paraYaz(paraDb(x.kalanTutar).plus(k.haciz.get(x.id)!)), durum: x.kapanisNedeni === null ? 'AKTIF' : x.durum, version: { increment: 1 } },
        })
      }
      for (const x of await tx.damgaPayi.findMany({ where: { id: { in: [...k.damga.keys()] } } })) {
        await tx.damgaPayi.update({ where: { id: x.id }, data: { kalan: paraYaz(paraDb(x.kalan).plus(k.damga.get(x.id)!)), version: { increment: 1 } } })
      }
    }
    await tx.paketTaksit.updateMany({ where: { paketId, aktif: true }, data: { aktif: false } })
    await paketiGuncelle(tx, paketId, version, { durum: 'IPTAL', iptalNedeni: n })
    if (kesinlesmis) for (const id of sozlesmeIdleri) await taksitPlaniniGuncelle(tx, id, bugun)
    await denetimKaydi(tx, baglam, { varlik: 'odeme_paketi', varlikId: paketId, eylem: 'IPTAL', sonra: { onceDurum: p.durum, taksitIdleri, nedenGirildi: true } })
  }, ZAMAN_ASIMI)
}

/**
 * Yanlış "ödendi" kaydı ya da bankadan dönen ödeme: ODENDI → ODEME_EMRINDE, taksitler ODEME_EMRINDE, odemeTarihi silinir. Gerekçe pakette
 * saklanır (son geri alma; zaman çizelgesinde görünür), denetim satırına yalnızca girildiği yazılır.
 */
export async function paketOdemeGeriAl(paketId: number, version: number, neden: string, baglam: IslemBaglami): Promise<void> {
  const n = nedenDenetle(neden, 'Geri alma nedeni')
  await prisma.$transaction(async (tx) => {
    const { p, taksitIdleri } = await paketiKilitle(tx, paketId)
    durumDenetle(p, version, 'ODENDI', 'Yalnızca ödenmiş paketin ödemesi geri alınır.')
    await taksitleriGecir(tx, taksitIdleri, ['ODENDI'], { durum: 'ODEME_EMRINDE', odemeTarihi: null })
    await paketiGuncelle(tx, paketId, version, { durum: 'ODEME_EMRINDE', odemeTarihi: null, odemeGeriAlmaNedeni: n })
    await denetimKaydi(tx, baglam, { varlik: 'odeme_paketi', varlikId: paketId, eylem: 'ODEME_GERI_AL', sonra: { nedenGirildi: true } })
  }, ZAMAN_ASIMI)
}
