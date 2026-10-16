import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { tarih as t } from '@/core/tarih'
import { prisma } from '@/server/db'
import { tarihDb } from '@/server/donustur'
import { CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { paketFaturasiKaydet, paketTaksitiBol, paketeTaksitEkle, pakettenTaksitCikar } from '@/server/paket/servis'
import { paketDetayi, paketOnerileri } from '@/server/paket/sorgu'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { ornekBirim, ornekKisi } from './ornekler'
import { aktifSozlesme, paketKur, paketSurumu, sozlesmeTaksitleri } from './paket-yardimci'

const BUGUN = t('2026-01-25')
let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const hata = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)
const aktifTaksitler = async (paketId: number) =>
  (await prisma.paketTaksit.findMany({ where: { paketId, aktif: true }, orderBy: { taksitId: 'asc' } })).map((x) => x.taksitId)

async function subatTaksiti(sozlesmeId: number) {
  return (await sozlesmeTaksitleri(sozlesmeId)).find((x) => tarihDb(x.donemBaslangic) === '2026-02-01')!
}

/** Paket HESAPLANDI'ya alınır ve taksitine bir dağılım satırı yazılır (hesaplama servisi Task 9'da gelir). */
async function hesaplanmisGibi(paketId: number, sozlesmeId: number, taksitId: number) {
  await prisma.odemePaketi.update({ where: { id: paketId }, data: { durum: 'HESAPLANDI', hesapTarihi: new Date('2026-01-25'), onKontrol: { hatalar: [], uyarilar: [] } } })
  const m = await prisma.sozlesmeMalik.findFirstOrThrow({ where: { sozlesmeId } })
  await prisma.taksitDagilim.create({
    data: {
      paketId, taksitId, sozlesmeMalikId: m.id, kisiId: m.kisiId, odemeKisiId: m.kisiId, sira: 0, parcaBaslangic: new Date('2026-02-01'), parcaBitis: new Date('2026-02-28'),
      pay: 1, payda: 1, brut: '10000.00', kdv: '0.00', stopaj: '2000.00', kdvOrani: '0', stopajOrani: '20', net: '8000.00', hesapGoruntusu: {},
    },
  })
}

describe('ödeme paketi taslağı', () => {
  it('paketOlustur Şubat vadeli PLANLANDI taksitleri ekler; başka birimin ve aralık dışının taksitlerini eklemez', async () => {
    const s1 = await aktifSozlesme(h)
    const b2 = await ornekBirim()
    await aktifSozlesme(h, { birimId: b2.id })
    const p = await paketKur(h)
    const paket = await prisma.odemePaketi.findUniqueOrThrow({ where: { id: p } })
    expect([paket.durum, paket.version, paket.ad]).toEqual(['TASLAK', 0, 'Şubat 2026 kira ödemeleri'])
    expect(await aktifTaksitler(p)).toEqual([(await subatTaksiti(s1)).id])
  })

  it('aktif paketteki taksit ikinci pakete eklenemez (kod PAKETTE); ilk paket iptal benzetimi (aktif=false) sonrası eklenir', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const p1 = await paketKur(h)
    const p2 = await paketKur(h)
    expect(await aktifTaksitler(p2)).toEqual([])
    const e = await hata(paketeTaksitEkle(p2, 0, [subat.id], TEST_BAGLAMI))
    expect((e as IsKuraliHatasi).kod).toBe('PAKETTE')
    await prisma.paketTaksit.updateMany({ where: { paketId: p1 }, data: { aktif: false } })
    await paketeTaksitEkle(p2, 0, [subat.id], TEST_BAGLAMI)
    expect(await aktifTaksitler(p2)).toEqual([subat.id])
    expect(await paketSurumu(p2)).toBe(1)
  })

  it('başka birimin ya da PLANLANDI olmayan taksiti eklenemez', async () => {
    const b2 = await ornekBirim()
    const baska = await aktifSozlesme(h, { birimId: b2.id })
    const s = await aktifSozlesme(h)
    const p = await paketKur(h)
    expect((await hata(paketeTaksitEkle(p, 0, [(await subatTaksiti(baska)).id], TEST_BAGLAMI)) as IsKuraliHatasi).kod).toBe('BIRIM')
    const mart = (await sozlesmeTaksitleri(s)).find((x) => tarihDb(x.donemBaslangic) === '2026-03-01')!
    await prisma.taksit.update({ where: { id: mart.id }, data: { durum: 'ODENDI', sistemDisiOdeme: true } })
    expect((await hata(paketeTaksitEkle(p, 0, [mart.id], TEST_BAGLAMI)) as IsKuraliHatasi).kod).toBe('TAKSIT_DURUMU')
  })

  it('HESAPLANDI pakette taksit çıkarılınca TASLAK olur ve dağılım satırları silinir', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const p = await paketKur(h)
    await hesaplanmisGibi(p, s, subat.id)
    await pakettenTaksitCikar(p, 0, subat.id, TEST_BAGLAMI)
    const paket = await prisma.odemePaketi.findUniqueOrThrow({ where: { id: p } })
    expect([paket.durum, paket.hesapTarihi, paket.onKontrol, paket.version]).toEqual(['TASLAK', null, null, 1])
    expect(await prisma.taksitDagilim.count({ where: { paketId: p } })).toBe(0)
    expect(await aktifTaksitler(p)).toEqual([])
  })

  it('böl işareti yazılır; HESAPLANDI pakette TASLAK a döndürür', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const p = await paketKur(h)
    await hesaplanmisGibi(p, s, subat.id)
    await paketTaksitiBol(p, 0, subat.id, true, TEST_BAGLAMI)
    expect((await prisma.paketTaksit.findFirstOrThrow({ where: { paketId: p } })).bolunsun).toBe(true)
    expect((await prisma.odemePaketi.findUniqueOrThrow({ where: { id: p } })).durum).toBe('TASLAK')
  })

  it('sürüm uyuşmazlığı CakismaHatasi; KESINLESTI pakette düzenleme IsKuraliHatasi (DURUM)', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const p = await paketKur(h)
    expect(await hata(paketTaksitiBol(p, 7, subat.id, true, TEST_BAGLAMI))).toBeInstanceOf(CakismaHatasi)
    await prisma.odemePaketi.update({ where: { id: p }, data: { durum: 'KESINLESTI', hesapTarihi: new Date('2026-01-25'), kesinlesmeZamani: new Date() } })
    expect((await hata(paketTaksitiBol(p, 0, subat.id, true, TEST_BAGLAMI)) as IsKuraliHatasi).kod).toBe('DURUM')
  })

  it('fatura: malik olmayan kişi reddedilir; ikinci kayıt günceller; gelecek tarih reddedilir', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const p = await paketKur(h)
    expect(await hata(paketFaturasiKaydet(p, 0, { taksitId: subat.id, kisiId: h.kisiB, faturaNo: 'A-1', faturaTarihi: t('2026-01-20') }, TEST_BAGLAMI, BUGUN)))
      .toBeInstanceOf(IsKuraliHatasi)
    await paketFaturasiKaydet(p, 0, { taksitId: subat.id, kisiId: h.kisiA, faturaNo: 'A-1', faturaTarihi: t('2026-01-20') }, TEST_BAGLAMI, BUGUN)
    await paketFaturasiKaydet(p, 1, { taksitId: subat.id, kisiId: h.kisiA, faturaNo: 'A-2', faturaTarihi: t('2026-01-21') }, TEST_BAGLAMI, BUGUN)
    const f = await prisma.paketFatura.findMany({ where: { paketId: p } })
    expect(f.map((x) => [x.faturaNo, tarihDb(x.faturaTarihi)])).toEqual([['A-2', '2026-01-21']])
    const e = await hata(paketFaturasiKaydet(p, 2, { taksitId: subat.id, kisiId: h.kisiA, faturaNo: 'A-3', faturaTarihi: t('2026-01-26') }, TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).alan).toBe('faturaTarihi')
  })

  it('faturaGereken: böl işaretli taksitte vadeden sonra başlayan SIRKET malik listelenir; bölünmemişte vade günündeki malik', async () => {
    const s = await aktifSozlesme(h)
    const subat = await subatTaksiti(s)
    const sirket = await ornekKisi({ tip: 'TUZEL', tckn: null, vkn: '1234567890', ad: null, soyad: null, unvan: 'Örnek Kira A.Ş.', vergiStatusu: 'SIRKET' })
    const a = await prisma.sozlesmeMalik.findFirstOrThrow({ where: { sozlesmeId: s } })
    await prisma.$transaction([
      prisma.sozlesmeMalik.update({ where: { id: a.id }, data: { gecerlilikBitis: new Date('2026-02-10') } }),
      prisma.sozlesmeMalik.create({ data: { sozlesmeId: s, kisiId: sirket.id, pay: 1, payda: 1, gecerlilikBaslangic: new Date('2026-02-11') } }),
    ])
    const p = await paketKur(h)
    expect((await paketDetayi(p, BUGUN)).faturaGereken).toEqual([])
    await paketTaksitiBol(p, 0, subat.id, true, TEST_BAGLAMI)
    expect((await paketDetayi(p, BUGUN)).faturaGereken).toEqual([
      { taksitId: subat.id, kisiId: sirket.id, kisiAdi: 'Örnek Kira A.Ş.', faturaNo: null, faturaTarihi: null },
    ])
  })

  it('öneriler: Ocak vadeli taksit gecikmiş işaretli; başka aktif paketteki taksit listelenmez', async () => {
    const s = await aktifSozlesme(h)
    const p1 = await paketKur(h)
    const p2 = await paketKur(h, { vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
    const o = await paketOnerileri(p2, BUGUN)
    const taksitler = await sozlesmeTaksitleri(s)
    const ocak = taksitler.find((x) => tarihDb(x.donemBaslangic) === '2026-01-01')!
    expect(o.map((x) => [x.taksitId, x.gecikmis])).toEqual([[ocak.id, true]])
    expect(await aktifTaksitler(p1)).toEqual([(await subatTaksiti(s)).id])
  })

  it('denetim: OLUSTUR satırında taksit kimlikleri var, kişi adı yok', async () => {
    const s = await aktifSozlesme(h)
    const p = await paketKur(h)
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'OLUSTUR' } })
    expect(d.sonra).toMatchObject({ birimId: h.birimId, vadeBaslangic: '2026-02-01', vadeBitis: '2026-02-28', taksitIdleri: [(await subatTaksiti(s)).id] })
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    expect(JSON.stringify(d.sonra)).not.toContain(kisi.soyad!)
  })
})
