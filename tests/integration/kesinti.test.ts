import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { para } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { prisma } from '@/server/db'
import { CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import {
  borcSorguEkle, borcSorguSil, gecerliSorgu, hacizEkle, hacizKapat, kisiKesintileri, sorguKullanimi, type BorcSorguGirdisi,
} from '@/server/kesinti/servis'
import { tarihDb } from '@/server/donustur'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { paketZemini, satirliPaket } from './paket-veri'

let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const BUGUN = t('2026-10-16')
const sorgu = (ek: Partial<BorcSorguGirdisi> = {}): BorcSorguGirdisi => ({
  kisiId: h.kisiA, sorguTarihi: t('2026-10-01'), borcVar: false, borcTutari: null, vergiDairesi: 'Selçuk V.D.', belgeNo: 'B-1', belgeId: null, ...ek,
})
const hata = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)

async function belge(sahipId: number, belgeTuru: 'BORC_YAZISI' | 'DIGER', sahipTur = 'kisi') {
  return prisma.belge.create({ data: { sahipTur, sahipId, belgeTuru, dosyaAdi: 'yazi.pdf', sha256: 'a'.repeat(64), boyut: 10, mime: 'application/pdf', yukleyenId: 1 } })
}

describe('22/A borç sorgusu', () => {
  it('geçerlilik bitişi: 2026-10-01 + 15 = 2026-10-16 (cuma)', async () => {
    const id = await borcSorguEkle(sorgu(), TEST_BAGLAMI, BUGUN)
    const s = await prisma.borcSorgu.findUniqueOrThrow({ where: { id } })
    expect([tarihDb(s.sorguTarihi), tarihDb(s.gecerlilikBitis), s.borcVar, s.borcTutari.toFixed(2)]).toEqual(['2026-10-01', '2026-10-16', false, '0.00'])
  })

  it('geçerlilik bitişi tatile denk gelirse sonraki iş günü: 2026-10-14 → 2026-10-29 tatil → 2026-10-30', async () => {
    const id = await borcSorguEkle(sorgu({ sorguTarihi: t('2026-10-14') }), TEST_BAGLAMI, BUGUN)
    expect(tarihDb((await prisma.borcSorgu.findUniqueOrThrow({ where: { id } })).gecerlilikBitis)).toBe('2026-10-30')
  })

  it('borç yok → tutar 0; borç var ve tutar boş → IsKuraliHatasi (alan borcTutari); ileri tarihli sorgu reddedilir', async () => {
    const id = await borcSorguEkle(sorgu({ borcTutari: para('500.00') }), TEST_BAGLAMI, BUGUN)
    expect((await prisma.borcSorgu.findUniqueOrThrow({ where: { id } })).borcTutari.toFixed(2)).toBe('0.00')
    const e1 = await hata(borcSorguEkle(sorgu({ borcVar: true, borcTutari: null }), TEST_BAGLAMI, BUGUN))
    expect(e1).toBeInstanceOf(IsKuraliHatasi)
    expect((e1 as IsKuraliHatasi).alan).toBe('borcTutari')
    const e2 = await hata(borcSorguEkle(sorgu({ sorguTarihi: t('2026-10-17') }), TEST_BAGLAMI, BUGUN))
    expect((e2 as IsKuraliHatasi).alan).toBe('sorguTarihi')
    const borclu = await borcSorguEkle(sorgu({ borcVar: true, borcTutari: para('6000.00') }), TEST_BAGLAMI, BUGUN)
    expect((await prisma.borcSorgu.findUniqueOrThrow({ where: { id: borclu } })).borcTutari.toFixed(2)).toBe('6000.00')
  })

  it('gecerliSorgu: aynı gün iki sorgu → son eklenen; süresi dolmuş sorgu dönmez; sorgu tarihinden önceki gün dönmez', async () => {
    await borcSorguEkle(sorgu(), TEST_BAGLAMI, BUGUN)
    const ikinci = await borcSorguEkle(sorgu({ borcVar: true, borcTutari: para('100.00') }), TEST_BAGLAMI, BUGUN)
    expect((await gecerliSorgu(prisma, h.kisiA, t('2026-10-10')))?.id).toBe(ikinci)
    expect(await gecerliSorgu(prisma, h.kisiA, t('2026-10-17'))).toBeNull()
    expect(await gecerliSorgu(prisma, h.kisiA, t('2026-09-30'))).toBeNull()
    expect(await gecerliSorgu(prisma, h.kisiB, t('2026-10-10'))).toBeNull()
  })

  it('belge başka kişiye aitse ya da türü BORC_YAZISI değilse reddedilir', async () => {
    const baskasi = await belge(h.kisiB, 'BORC_YAZISI')
    const yanlisTur = await belge(h.kisiA, 'DIGER')
    const sozlesmeninki = await belge(h.kisiA, 'BORC_YAZISI', 'sozlesme')
    for (const b of [baskasi, yanlisTur, sozlesmeninki]) {
      const e = await hata(borcSorguEkle(sorgu({ belgeId: b.id }), TEST_BAGLAMI, BUGUN))
      expect((e as IsKuraliHatasi).alan).toBe('belgeId')
    }
    const dogru = await belge(h.kisiA, 'BORC_YAZISI')
    const id = await borcSorguEkle(sorgu({ belgeId: dogru.id }), TEST_BAGLAMI, BUGUN)
    expect((await prisma.borcSorgu.findUniqueOrThrow({ where: { id } })).belgeId).toBe(dogru.id)
  })

  it('sorguKullanimi yalnız KESINLESTI/ODEME_EMRINDE/ODENDI paketleri sayar; haricPaketId hariç tutulur', async () => {
    const z = await paketZemini(h.kisiA)
    const s = await borcSorguEkle(sorgu({ borcVar: true, borcTutari: para('9000.00') }), TEST_BAGLAMI, BUGUN)
    const kesin = await satirliPaket(z, { durum: 'KESINLESTI', kesinti: { tur: 'KESINTI_22A', tutar: '1000.00', borcSorguId: s } })
    const z2 = await paketZemini(h.kisiA)
    await satirliPaket(z2, { durum: 'ODENDI', kesinti: { tur: 'KESINTI_22A', tutar: '500.00', borcSorguId: s } })
    const z3 = await paketZemini(h.kisiA)
    await satirliPaket(z3, { durum: 'HESAPLANDI', kesinti: { tur: 'KESINTI_22A', tutar: '700.00', borcSorguId: s } })
    const z4 = await paketZemini(h.kisiA)
    await satirliPaket(z4, { durum: 'IPTAL', kesinti: { tur: 'KESINTI_22A', tutar: '300.00', borcSorguId: s } })
    expect((await sorguKullanimi(prisma, [s])).get(s)?.toFixed(2)).toBe('1500.00')
    expect((await sorguKullanimi(prisma, [s], kesin.paketId)).get(s)?.toFixed(2)).toBe('500.00')
  })

  it('borcSorguSil: kesinti satırına bağlı sorgu silinmez; HESAPLANDI paketin alicilar22a sında geçen borç yok sorgusu silinmez; bağsız sorgu silinir', async () => {
    const borclu = await borcSorguEkle(sorgu({ borcVar: true, borcTutari: para('9000.00') }), TEST_BAGLAMI, BUGUN)
    const z = await paketZemini(h.kisiA)
    await satirliPaket(z, { durum: 'IPTAL', kesinti: { tur: 'KESINTI_22A', tutar: '1000.00', borcSorguId: borclu } })
    expect((await hata(borcSorguSil(borclu, TEST_BAGLAMI)) as Error).message).toBe('Bu sorgu bir ödeme paketinde kullanıldı; silinemez.')

    const borcYok = await borcSorguEkle(sorgu(), TEST_BAGLAMI, BUGUN)
    const z2 = await paketZemini(h.kisiA)
    await satirliPaket(z2, { durum: 'HESAPLANDI', onKontrol: { hatalar: [], uyarilar: [], alicilar22a: [{ kisiId: String(h.kisiA), sorguGerekli: true, borcSorguId: String(borcYok) }] } })
    expect(await hata(borcSorguSil(borcYok, TEST_BAGLAMI))).toBeInstanceOf(IsKuraliHatasi)

    const izde = await borcSorguEkle(sorgu(), TEST_BAGLAMI, BUGUN)
    const z3 = await paketZemini(h.kisiA)
    await satirliPaket(z3, { durum: 'KESINLESTI', hesapParmakIzi: { sorgular: [String(izde)] } })
    expect(await hata(borcSorguSil(izde, TEST_BAGLAMI))).toBeInstanceOf(IsKuraliHatasi)

    const bagsiz = await borcSorguEkle(sorgu(), TEST_BAGLAMI, BUGUN)
    await borcSorguSil(bagsiz, TEST_BAGLAMI)
    expect(await prisma.borcSorgu.findUnique({ where: { id: bagsiz } })).toBeNull()
    const k = await kisiKesintileri(h.kisiA, BUGUN)
    expect(k.sorgular.filter((x) => x.kullanildi).map((x) => x.id).sort()).toEqual([borclu, borcYok, izde].sort())
  })
})

describe('haciz', () => {
  const haciz = { alacakli: 'Konya 3. İcra Dairesi', dosyaNo: '2026/123', tebligTarihi: t('2026-09-01'), toplamTutar: para('3000.00') }

  it('hacizEkle: kalan = toplam; hacizKapat sürüm çakışmasında CakismaHatasi; kapalı haciz ikinci kez kapatılamaz', async () => {
    const id = await hacizEkle({ kisiId: h.kisiA, ...haciz }, TEST_BAGLAMI, BUGUN)
    const x = await prisma.haciz.findUniqueOrThrow({ where: { id } })
    expect([x.kalanTutar.toFixed(2), x.durum]).toEqual(['3000.00', 'AKTIF'])
    expect(await hata(hacizKapat(id, 5, 'kaldırıldı', TEST_BAGLAMI))).toBeInstanceOf(CakismaHatasi)
    await hacizKapat(id, 0, 'İcra dairesi kaldırdı', TEST_BAGLAMI)
    const y = await prisma.haciz.findUniqueOrThrow({ where: { id } })
    expect([y.durum, y.kapanisNedeni, y.version]).toEqual(['KAPANDI', 'İcra dairesi kaldırdı', 1])
    const e = await hata(hacizKapat(id, 1, 'tekrar', TEST_BAGLAMI))
    expect(e).toBeInstanceOf(IsKuraliHatasi)
    expect(await hata(hacizKapat(id, 1, '   ', TEST_BAGLAMI))).toBeInstanceOf(IsKuraliHatasi)
  })

  it('tebliğ tarihi bugünden sonra olamaz', async () => {
    const e = await hata(hacizEkle({ kisiId: h.kisiA, ...haciz, tebligTarihi: t('2026-10-17') }, TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).alan).toBe('tebligTarihi')
  })

  it('kisiKesintileri: sorgular geçerlilik rozetine göre, hacizler kalanıyla', async () => {
    await borcSorguEkle(sorgu({ sorguTarihi: t('2026-09-01') }), TEST_BAGLAMI, BUGUN)
    await borcSorguEkle(sorgu({ sorguTarihi: t('2026-10-10') }), TEST_BAGLAMI, BUGUN)
    await hacizEkle({ kisiId: h.kisiA, ...haciz }, TEST_BAGLAMI, BUGUN)
    const k = await kisiKesintileri(h.kisiA, BUGUN)
    expect(k.sorgular.map((s) => [s.sorguTarihi, s.gecerli])).toEqual([['2026-10-10', true], ['2026-09-01', false]])
    expect(k.hacizler.map((x) => [x.dosyaNo, x.kalanTutar, x.durum])).toEqual([['2026/123', '3000.00', 'AKTIF']])
  })
})

describe('denetim', () => {
  it('denetim satırlarında ad, TCKN ve vergi dairesi metni yok', async () => {
    const s = await borcSorguEkle(sorgu({ borcVar: true, borcTutari: para('6000.00') }), TEST_BAGLAMI, BUGUN)
    const hz = await hacizEkle({ kisiId: h.kisiA, alacakli: 'Konya 3. İcra Dairesi', dosyaNo: '2026/1', tebligTarihi: t('2026-09-01'), toplamTutar: para('100.00') }, TEST_BAGLAMI, BUGUN)
    await hacizKapat(hz, 0, 'Malik Ahmet Yılmaz ödedi', TEST_BAGLAMI)
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const satirlar = await prisma.olayGunlugu.findMany({ where: { varlik: { in: ['borc_sorgu', 'haciz'] } } })
    expect(satirlar.map((x) => [x.varlik, x.eylem]).sort()).toEqual([['borc_sorgu', 'OLUSTUR'], ['haciz', 'KAPAT'], ['haciz', 'OLUSTUR']])
    const metin = JSON.stringify(satirlar.map((x) => [x.once, x.sonra]))
    for (const yasak of [kisi.tckn!, kisi.soyad!, 'Selçuk V.D.', 'Ahmet Yılmaz']) expect(metin).not.toContain(yasak)
    expect(metin).toContain('"borcTutari":"6000.00"')
    expect(satirlar.find((x) => x.varlik === 'borc_sorgu')!.varlikId).toBe(String(s))
  })
})
