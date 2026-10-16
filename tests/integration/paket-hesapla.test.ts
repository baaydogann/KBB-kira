import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DAGILIM_SURUMU, type DagilimGoruntusu } from '@/core/hesap/goruntu'
import { para } from '@/core/para'
import { tarih as t, type Tarih } from '@/core/tarih'
import { artisOnayla, artislariHesapla } from '@/server/artis/servis'
import { prisma } from '@/server/db'
import { tarihDb } from '@/server/donustur'
import { borcSorguEkle, hacizEkle } from '@/server/kesinti/servis'
import { paketHesapla, type HesapParmakIzi, type PaketOnKontrolKaydi } from '@/server/paket/hesapla'
import { paketDetayi } from '@/server/paket/sorgu'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur, paketSurumu, sozlesmeTaksitleri } from './paket-yardimci'
import { paketZemini, satirliPaket } from './paket-veri'

const BUGUN = t('2026-01-25')
let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const sorgu = (borc: string | null, bugun: Tarih = BUGUN) =>
  borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: bugun, borcVar: borc !== null, borcTutari: borc === null ? null : para(borc), vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, bugun)
const dagilimlar = (paketId: number) => prisma.taksitDagilim.findMany({ where: { paketId }, include: { kesintiler: true }, orderBy: { sira: 'asc' } })
const ozet = (d: Awaited<ReturnType<typeof dagilimlar>>[number]) =>
  [d.brut, d.kdv, d.stopaj, d.damgaKesintisi, d.hacizKesintisi, d.kesinti22a, d.net].map((x) => x.toFixed(2))
const kodlar = (k: PaketOnKontrolKaydi, alan: 'hatalar' | 'uyarilar') => k[alan].map((b) => b.kod)

async function subatPaketi() {
  const s = await aktifSozlesme(h)
  const p = await paketKur(h)
  return { s, p }
}

describe('paket hesaplama', () => {
  it('sorgusuz: brüt 10.000, stopaj 2.000, damga 226,80, net 7.773,20; SORGU_22A_YOK hatası; durum HESAPLANDI', async () => {
    const { p } = await subatPaketi()
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    const [d] = await dagilimlar(p)
    expect(ozet(d!)).toEqual(['10000.00', '0.00', '2000.00', '226.80', '0.00', '0.00', '7773.20'])
    expect(kodlar(k, 'hatalar')).toEqual(['SORGU_22A_YOK'])
    expect(k.alicilar22a).toEqual([{ kisiId: String(h.kisiA), sorguGerekli: true, borcSorguId: null }])
    expect(k.toplam).toMatchObject({ brut: '10000.00', stopaj: '2000.00', damga: '226.80', net: '7773.20', gider: '10000.00' })
    const paket = await prisma.odemePaketi.findUniqueOrThrow({ where: { id: p } })
    expect([paket.durum, tarihDb(paket.hesapTarihi!), paket.version]).toEqual(['HESAPLANDI', '2026-01-25', 1])
  })

  it('borç yok sorgusuyla: hata yok; DAMGA kesinti satırı 226,80, damga payına bağlı', async () => {
    const { s, p } = await subatPaketi()
    const sorguId = await sorgu(null)
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    expect(k.hatalar).toEqual([])
    expect(k.alicilar22a).toEqual([{ kisiId: String(h.kisiA), sorguGerekli: true, borcSorguId: String(sorguId) }])
    const [d] = await dagilimlar(p)
    const pay = await prisma.damgaPayi.findFirstOrThrow({ where: { damgaKaydi: { sozlesmeId: s } } })
    expect(d!.kesintiler.map((x) => [x.tur, x.tutar.toFixed(2), x.damgaPayiId, x.paketId])).toEqual([['DAMGA', '226.80', pay.id, p]])
    expect(kodlar(k, 'uyarilar')).toContain('DAMGA_KESINTISI')
  })

  it('borçlu sorgu 6.000: KESINTI_22A 6.000; net 1.773,20', async () => {
    const { p } = await subatPaketi()
    const sorguId = await sorgu('6000.00')
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    const [d] = await dagilimlar(p)
    expect(ozet(d!)).toEqual(['10000.00', '0.00', '2000.00', '226.80', '0.00', '6000.00', '1773.20'])
    expect(d!.kesintiler.find((x) => x.tur === 'KESINTI_22A')!.borcSorguId).toBe(sorguId)
  })

  it('haciz 2.000 + borç 6.000: sıra damga → haciz → 22/A; haciz 2.000, 22/A eşiği 5.773,20 > 5.000 → 22/A 5.773,20, net 0', async () => {
    const { p } = await subatPaketi()
    await sorgu('6000.00')
    await hacizEkle({ kisiId: h.kisiA, alacakli: 'Konya 1. İcra', dosyaNo: '2026/9', tebligTarihi: t('2026-01-10'), toplamTutar: para('2000.00') }, TEST_BAGLAMI, BUGUN)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    expect(ozet((await dagilimlar(p))[0]!)).toEqual(['10000.00', '0.00', '2000.00', '226.80', '2000.00', '5773.20', '0.00'])
  })

  it('haciz 3.000 + borç 6.000: damga ve hacizden sonra 4.773,20 ≤ 5.000 → 22/A gerekmez, kesinti yok, net 4.773,20', async () => {
    const { p } = await subatPaketi()
    await sorgu('6000.00')
    await hacizEkle({ kisiId: h.kisiA, alacakli: 'Konya 1. İcra', dosyaNo: '2026/9', tebligTarihi: t('2026-01-10'), toplamTutar: para('3000.00') }, TEST_BAGLAMI, BUGUN)
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    expect(ozet((await dagilimlar(p))[0]!)).toEqual(['10000.00', '0.00', '2000.00', '226.80', '3000.00', '0.00', '4773.20'])
    expect(k.alicilar22a[0]!.sorguGerekli).toBe(false)
    expect(k.hatalar).toEqual([])
  })

  it('kesinleşmiş başka paketteki 5.000 kullanım düşülür: borç 8.000 → bu pakette 3.000', async () => {
    const { p } = await subatPaketi()
    const sorguId = await sorgu('8000.00')
    await satirliPaket(await paketZemini(h.kisiA), { durum: 'KESINLESTI', kesinti: { tur: 'KESINTI_22A', tutar: '5000.00', borcSorguId: sorguId } })
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    expect((await dagilimlar(p))[0]!.kesinti22a.toFixed(2)).toBe('3000.00')
  })

  it('yeniden hesap eski satırları siler, sürüm artar; aynı girdiyle tutarlar aynı (spec §6.8)', async () => {
    const { p } = await subatPaketi()
    await sorgu(null)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    const ilk = await dagilimlar(p)
    await paketHesapla(p, 1, TEST_BAGLAMI, BUGUN)
    const ikinci = await dagilimlar(p)
    expect(ikinci).toHaveLength(1)
    expect(ikinci[0]!.id).not.toBe(ilk[0]!.id)
    expect(ozet(ikinci[0]!)).toEqual(ozet(ilk[0]!))
    expect(await paketSurumu(p)).toBe(2)
    await expect(paketHesapla(p, 1, TEST_BAGLAMI, BUGUN)).rejects.toThrow(/başka biri/)
  })

  it('dağılım görüntüsü: DAGILIM_SURUMU, oran anahtarı STOPAJ_94_5A = 20, muhsgkKodu 041, kesinti listesi', async () => {
    const { p } = await subatPaketi()
    await sorgu(null)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    const g = (await dagilimlar(p))[0]!.hesapGoruntusu as unknown as DagilimGoruntusu
    expect(g.surum).toBe(DAGILIM_SURUMU)
    expect(g.hesapTarihi).toBe('2026-01-25')
    expect(g.taksit).toMatchObject({ donem: { baslangic: '2026-02-01', bitis: '2026-02-28' }, vade: '2026-02-01', tutar: '10000.00', bedelTuru: 'BRUT' })
    expect(g.oranlar).toEqual({ stopaj: { anahtar: 'STOPAJ_94_5A', deger: '20' }, kdv: { anahtar: null, deger: '0' } })
    expect(g.muhsgkKodu).toBe('041')
    expect(g.kesintiler.map((k) => [k.tur, k.tutar])).toEqual([['DAMGA', '226.80']])
    expect(g.satirlar.map((s) => s.aciklama)).toContain('Damga kesintisi (istihkaktan)')
  })

  it('artış bekleyen taksit: sözleşme 2025-03-01–2027-02-28, Mart 2026 paketi, bugün 2026-02-20, artış onaylanmamış → ARTIS_BEKLIYOR', async () => {
    const bugun = t('2026-02-20')
    await aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, bugun)
    const p = await paketKur(h, { vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, bugun)
    expect(kodlar(k, 'hatalar')).toContain('ARTIS_BEKLIYOR')
  })

  it('vade geçtikten sonra onaylanan artış: bugün 2026-03-05 artış onaylanır (ana taksit dondurulmuş, FARK açılır); ana + FARK aynı pakette → ARTIS_BEKLIYOR yok, toplam yeni bedel', async () => {
    const bugun = t('2026-03-05')
    const s = await aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, t('2026-02-20'))
    await prisma.$transaction((tx) => artislariHesapla(tx, bugun, s))
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, donemBaslangic: new Date('2026-03-01') } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, bugun)
    const yeniBedel = a.yeniBedel!.toFixed(2)
    const mart = (await prisma.taksit.findMany({ where: { sozlesmeId: s, donemBaslangic: { gte: new Date('2026-03-01'), lt: new Date('2026-04-01') }, durum: { not: 'IPTAL' } } }))
    expect(mart.map((x) => x.tur).sort()).toEqual(['FARK', 'NORMAL'])
    expect(mart.reduce((top, x) => top.plus(x.tutar.toString()), para('0')).toFixed(2)).toBe(yeniBedel)
    const p = await paketKur(h, { vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, bugun)
    expect(kodlar(k, 'hatalar')).not.toContain('ARTIS_BEKLIYOR')
    expect(k.toplam.brut).toBe(yeniBedel)
    expect((await sozlesmeTaksitleri(s)).length).toBeGreaterThan(0)
  })

  it('IDARE_VKN GIRILMEDI → IDARE_VKN_YOK uyarısı', async () => {
    const { p } = await subatPaketi()
    const k = await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    expect(kodlar(k, 'uyarilar')).toContain('IDARE_VKN_YOK')
  })

  it('parmak izi sözleşme, kişi ve taksit sürümlerini; haciz, damga payı ve sorgu kimliklerini içerir', async () => {
    const { s, p } = await subatPaketi()
    const sorguId = await sorgu(null)
    const hacizId = await hacizEkle({ kisiId: h.kisiA, alacakli: 'Konya 1. İcra', dosyaNo: '2026/9', tebligTarihi: t('2026-01-10'), toplamTutar: para('100.00') }, TEST_BAGLAMI, BUGUN)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    const iz = (await prisma.odemePaketi.findUniqueOrThrow({ where: { id: p } })).hesapParmakIzi as unknown as HesapParmakIzi
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    const pay = await prisma.damgaPayi.findFirstOrThrow({ where: { damgaKaydi: { sozlesmeId: s } } })
    const subat = (await sozlesmeTaksitleri(s)).find((x) => tarihDb(x.donemBaslangic) === '2026-02-01')!
    expect(iz).toEqual({
      sozlesmeler: { [s]: sozlesme.version }, kisiler: { [h.kisiA]: 0 }, taksitler: { [subat.id]: subat.version },
      hacizler: [String(hacizId)], damgaPaylari: [String(pay.id)], sorgular: [String(sorguId)],
    })
    expect((await prisma.paketTaksit.findFirstOrThrow({ where: { paketId: p } })).hesaplananTaksitSurumu).toBe(subat.version)
    const detay = await paketDetayi(p, BUGUN)
    expect(detay.dagilim.map((d) => [d.kisiAdi, d.net])).toHaveLength(1)
    expect(detay.toplam?.net).toBe('7673.20')
  })
})
