import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { para } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { prisma } from '@/server/db'
import { tarihDb } from '@/server/donustur'
import { IsKuraliHatasi } from '@/server/hata'
import { damgaKalanlari, damgaKaydiEkle, damgaKaydiIptal, damgaMakbuzBagla, sozlesmeDamgaKayitlari } from '@/server/damga/servis'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { paketZemini, satirliPaket } from './paket-veri'

let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

async function aktif(ek: Record<string, unknown> = {}): Promise<number> {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
  return id
}
const kayitlar = (sozlesmeId: number) => prisma.damgaKaydi.findMany({ where: { sozlesmeId }, include: { paylar: { orderBy: { kisiId: 'asc' } } }, orderBy: { id: 'asc' } })
const hata = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)

async function belge(sahipId: number, belgeTuru: 'DAMGA_MAKBUZU' | 'DIGER') {
  return prisma.belge.create({ data: { sahipTur: 'sozlesme', sahipId, belgeTuru, dosyaAdi: 'makbuz.pdf', sha256: 'b'.repeat(64), boyut: 10, mime: 'application/pdf', yukleyenId: 1 } })
}

describe('ILK damga kaydı (aktifleştirme)', () => {
  it('aktifleştirme ILK kaydı: 2026 aylık 10.000 brüt → olay 2025-12-20, matrah 120.000,00, tutar 226,80, tek pay kalan 226,80', async () => {
    const id = await aktif()
    const [d] = await kayitlar(id)
    expect([d!.olay, tarihDb(d!.olayTarihi), d!.matrah.toFixed(2), d!.oranBinde.toFixed(2), d!.azami.toFixed(2), d!.tutar.toFixed(2), d!.tahsil])
      .toEqual(['ILK', '2025-12-20', '120000.00', '1.89', '24477478.90', '226.80', 'ISTIHKAKTAN'])
    expect(d!.paylar.map((p) => [p.kisiId, p.pay, p.payda, p.tutar.toFixed(2), p.kalan.toFixed(2)])).toEqual([[h.kisiA, 1, 1, '226.80', '226.80']])
    const g = d!.gerekce as { satirlar: { kural: string }[]; parametreler: Record<string, string> }
    expect(g.parametreler).toMatchObject({ DAMGA_KIRA_BINDE: '1.89', DAMGA_AZAMI: '24477478.90' })
    expect(g.satirlar.map((s) => s.kural)).toEqual(['K5', 'K5'])
    const denetim = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'sozlesme', varlikId: String(id), eylem: 'AKTIFLESTIR' } })
    expect(denetim.sonra).toMatchObject({ damgaKaydiId: d!.id })
  })

  it('iki malik 1/2 + 1/2 → paylar 113,40 / 113,40', async () => {
    const id = await aktif({
      malikler: [{ kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null }, { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null }],
    })
    const [d] = await kayitlar(id)
    expect(d!.paylar.map((p) => p.tutar.toFixed(2))).toEqual(['113.40', '113.40'])
  })

  it('göç sözleşmesinde (gecisTarihi dolu) ve odenmisSayilanSonTarih dolu sözleşmede ILK kaydı açılmaz', async () => {
    const goc = await aktif({ gecisTarihi: '2026-06-01', gecisBedeli: '11.000,00' })
    const odenmis = await aktif({ odenmisSayilanSonTarih: '2026-03-31' })
    expect(await kayitlar(goc)).toEqual([])
    expect(await kayitlar(odenmis)).toEqual([])
  })

  it('MALIK_BEYAN sözleşme → payların kalanı 0', async () => {
    const id = await aktif({ damgaTahsil: 'MALIK_BEYAN' })
    const [d] = await kayitlar(id)
    expect([d!.tahsil, d!.paylar[0]!.tutar.toFixed(2), d!.paylar[0]!.kalan.toFixed(2)]).toEqual(['MALIK_BEYAN', '226.80', '0.00'])
  })

  it('süresiz sözleşme → matrah 12 aylık kira (120.000,00)', async () => {
    const id = await aktif({ bitis: null })
    expect((await kayitlar(id))[0]!.matrah.toFixed(2)).toBe('120000.00')
  })

  it('imza 2027-01-05 ve DAMGA_AZAMI 2027 yok → sözleşme AKTIF olur, kayıt yok, DAMGA_HATA hatırlatması KRITIK', async () => {
    const id = await aktif({ imzaTarihi: '2027-01-05', baslangic: '2027-01-01', bitis: '2027-12-31' })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum).toBe('AKTIF')
    expect(await kayitlar(id)).toEqual([])
    const hatirlatma = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `DAMGA_HATA:sozlesme:${id}` } })
    expect([hatirlatma.kural, hatirlatma.oncelik, hatirlatma.kararGerekli, hatirlatma.iliskiliTur, hatirlatma.sozlesmeId])
      .toEqual(['DAMGA_HATA', 'KRITIK', true, 'sozlesme', id])
    expect(hatirlatma.aciklama.startsWith('Damga vergisi hesaplanamadı: DAMGA_AZAMI parametresi 2027-01-05')).toBe(true)
  })
})

describe('elle damga kaydı', () => {
  it('ikinci ILK reddedilir; iptal edilen ILK sonrası ILK eklenebilir', async () => {
    const id = await aktif()
    const [ilk] = await kayitlar(id)
    expect(await hata(damgaKaydiEkle({ sozlesmeId: id, olay: 'ILK', olayTarihi: t('2025-12-20'), matrah: null, tahsil: 'ISTIHKAKTAN' }, TEST_BAGLAMI)))
      .toBeInstanceOf(IsKuraliHatasi)
    await damgaKaydiIptal(ilk!.id, 0, 'Damga imzada ödenmişti', TEST_BAGLAMI)
    const yeni = await damgaKaydiEkle({ sozlesmeId: id, olay: 'ILK', olayTarihi: t('2025-12-20'), matrah: null, tahsil: 'MALIK_BEYAN' }, TEST_BAGLAMI)
    const d = await prisma.damgaKaydi.findUniqueOrThrow({ where: { id: yeni }, include: { paylar: true } })
    expect([d.matrah.toFixed(2), d.tutar.toFixed(2), d.tahsil, d.paylar[0]!.kalan.toFixed(2)]).toEqual(['120000.00', '226.80', 'MALIK_BEYAN', '0.00'])
  })

  it('YAZILI_ARTIS matrah 24.000,00 → tutar 45,36; matrahsız YAZILI_ARTIS reddedilir', async () => {
    const id = await aktif()
    const yeni = await damgaKaydiEkle({ sozlesmeId: id, olay: 'YAZILI_ARTIS', olayTarihi: t('2026-07-01'), matrah: para('24000.00'), tahsil: 'ISTIHKAKTAN' }, TEST_BAGLAMI)
    const d = await prisma.damgaKaydi.findUniqueOrThrow({ where: { id: yeni }, include: { paylar: true } })
    expect([d.olay, d.tutar.toFixed(2), d.paylar[0]!.kalan.toFixed(2)]).toEqual(['YAZILI_ARTIS', '45.36', '45.36'])
    const e = await hata(damgaKaydiEkle({ sozlesmeId: id, olay: 'YAZILI_ARTIS', olayTarihi: t('2026-07-01'), matrah: null, tahsil: 'ISTIHKAKTAN' }, TEST_BAGLAMI))
    expect((e as IsKuraliHatasi).alan).toBe('matrah')
  })

  it('taslak sözleşmeye damga kaydı eklenemez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    expect(await hata(damgaKaydiEkle({ sozlesmeId: id, olay: 'ILK', olayTarihi: t('2025-12-20'), matrah: null, tahsil: 'ISTIHKAKTAN' }, TEST_BAGLAMI)))
      .toBeInstanceOf(IsKuraliHatasi)
  })

  it('kalanı tutarından az olan kayıt iptal edilemez; yalnız HESAPLANDI paketteki kesintide görünen kayıt iptal edilebilir', async () => {
    const id = await aktif()
    const [d] = await kayitlar(id)
    await prisma.damgaPayi.update({ where: { id: d!.paylar[0]!.id }, data: { kalan: '100.00' } })
    const e = await hata(damgaKaydiIptal(d!.id, 0, 'yanlış', TEST_BAGLAMI))
    expect((e as Error).message).toBe('Bu damga kaydından kesinti yapıldı; önce ilgili paketi iptal edin.')
    await prisma.damgaPayi.update({ where: { id: d!.paylar[0]!.id }, data: { kalan: '226.80' } })
    const z = await paketZemini(h.kisiA)
    await satirliPaket(z, { durum: 'HESAPLANDI', kesinti: { tur: 'DAMGA', tutar: '226.80', damgaPayiId: d!.paylar[0]!.id } })
    await damgaKaydiIptal(d!.id, 0, 'Malik imzada ödemişti', TEST_BAGLAMI)
    expect((await prisma.damgaKaydi.findUniqueOrThrow({ where: { id: d!.id } })).iptal).toBe(true)
    expect(await hata(damgaKaydiIptal(d!.id, 1, 'tekrar', TEST_BAGLAMI))).toBeInstanceOf(IsKuraliHatasi)
  })

  it('makbuz: DAMGA_MAKBUZU olmayan ya da başka sözleşmenin belgesi reddedilir', async () => {
    const id = await aktif({ damgaTahsil: 'MALIK_BEYAN' })
    const baska = await aktif()
    const [d] = await kayitlar(id)
    for (const b of [await belge(id, 'DIGER'), await belge(baska, 'DAMGA_MAKBUZU')]) {
      expect(((await hata(damgaMakbuzBagla(d!.id, 0, b.id, TEST_BAGLAMI))) as IsKuraliHatasi).alan).toBe('belgeId')
    }
    const dogru = await belge(id, 'DAMGA_MAKBUZU')
    await damgaMakbuzBagla(d!.id, 0, dogru.id, TEST_BAGLAMI)
    const g = (await sozlesmeDamgaKayitlari(id))[0]!
    expect([g.makbuzBelgeId, g.version, g.paylar.map((p) => p.tutar)]).toEqual([dogru.id, 1, ['226.80']])
    expect(g.satirlar.length).toBeGreaterThan(0)
  })

  it('damgaKalanlari yalnız ISTIHKAKTAN, iptal edilmemiş ve kalanı > 0 payları döndürür', async () => {
    const a = await aktif()
    const beyan = await aktif({ damgaTahsil: 'MALIK_BEYAN' })
    const iptal = await aktif()
    const sifir = await aktif()
    const [di] = await kayitlar(iptal)
    await damgaKaydiIptal(di!.id, 0, 'test', TEST_BAGLAMI)
    const [ds] = await kayitlar(sifir)
    await prisma.damgaPayi.update({ where: { id: ds!.paylar[0]!.id }, data: { kalan: '0.00' } })
    const ciftler = [a, beyan, iptal, sifir].map((sozlesmeId) => ({ sozlesmeId, kisiId: h.kisiA }))
    const k = await damgaKalanlari(prisma, [...ciftler, { sozlesmeId: a, kisiId: h.kisiB }])
    const [da] = await kayitlar(a)
    expect(k).toEqual([{ damgaPayiId: String(da!.paylar[0]!.id), sozlesmeId: String(a), kisiId: String(h.kisiA), olayTarihi: '2025-12-20', kalan: para('226.80') }])
  })
})
