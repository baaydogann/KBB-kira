import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { vknGecerliMi } from '@/core/dogrulama'
import { tarih as t } from '@/core/tarih'
import { artisOnayla, artislariHesapla } from '@/server/artis/servis'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { hatirlatmalariUretVeKaydet } from '@/server/hatirlatma/servis'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketKesinlestir, paketOdemeEmriGir, paketOdendi } from '@/server/paket/durum'
import { paketHesapla } from '@/server/paket/hesapla'
import { raporIndir } from '@/server/rapor/indir'
import { gecikmisOdemeler, odenekRaporu, sozlesmeDurumRaporu } from '@/server/rapor/yonetim'
import { taksitSistemDisiOdendi } from '@/server/taksit/servis'
import { ornekBirim, ornekIban, ornekKisi } from './ornekler'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur, sozlesmeTaksitleri } from './paket-yardimci'

const BUGUN = t('2026-01-25')
let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const sorgu = () => borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: BUGUN, borcVar: false, borcTutari: null, vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, BUGUN)
const ozet = (xs: Awaited<ReturnType<typeof odenekRaporu>>) => xs.map((x) => [x.ekonomikKod, x.birim, x.yuk.toFixed(2), x.odenen.toFixed(2), x.kalan.toFixed(2), x.tahmini])

/** Şubat taksiti paketle ödenir (hesap, kesinleşme, ödeme emri ve ödeme 2026-01-25). */
async function subatOdendi(): Promise<number> {
  await sorgu()
  const p = await paketKur(h)
  await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
  await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
  await paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: BUGUN }, TEST_BAGLAMI, BUGUN)
  await paketOdendi(p, 3, BUGUN, TEST_BAGLAMI, BUGUN)
  return p
}

describe('ödenek raporu', () => {
  it('ödenek 2026: ödenmiş Şubat taksiti dağılımdan (10.000), planlı aylar tahminî; GMSİ brüt = tutar, yük 120.000,00, ödenen 10.000,00', async () => {
    await aktifSozlesme(h)
    await subatOdendi()
    const birim = await prisma.birim.findUniqueOrThrow({ where: { id: h.birimId } })
    expect(ozet(await odenekRaporu(2026, BUGUN))).toEqual([['03.5.5.05', birim.ad, '120000.00', '10000.00', '110000.00', false]])
    expect(await odenekRaporu(2025, BUGUN)).toEqual([])
  })

  it('ödenek: SIRKET malikli sözleşmede gider brüt + KDV (12.000/ay); NET sözleşmede brütleştirilmiş (8.000 net → 10.000)', async () => {
    const vkn = Array.from({ length: 10 }, (_, i) => `123456789${i}`).find(vknGecerliMi)!
    const sirket = await ornekKisi({ tip: 'TUZEL', tckn: null, vkn, ad: null, soyad: null, unvan: 'Ay Ltd.', vergiStatusu: 'SIRKET' })
    const iban = await ornekIban(sirket.id)
    await aktifSozlesme(h, { malikler: [{ kisiId: sirket.id, pay: 1, payda: 1, ibanId: iban.id, vekilKisiId: null }] })
    expect((await odenekRaporu(2026, BUGUN)).map((x) => x.yuk.toFixed(2))).toEqual(['144000.00'])
    await temizle()
    h = await hazirlik()
    await aktifSozlesme(h, { bedelTuru: 'NET', bedelTutari: '8.000,00' })
    expect((await odenekRaporu(2026, BUGUN)).map((x) => x.yuk.toFixed(2))).toEqual(['120000.00'])
  })

  it('ödenek: ekonomik kod × birim gruplaması', async () => {
    await aktifSozlesme(h)
    await aktifSozlesme(h, { tasinmazId: h.arsaId })
    const ikinci = await ornekBirim({ ad: 'Ahmet Birimi' })
    await aktifSozlesme(h, { birimId: ikinci.id })
    const birim = await prisma.birim.findUniqueOrThrow({ where: { id: h.birimId } })
    expect((await odenekRaporu(2026, BUGUN)).map((x) => [x.ekonomikKod, x.birim, x.yuk.toFixed(2)])).toEqual([
      ['03.5.5.05', 'Ahmet Birimi', '120000.00'], ['03.5.5.05', birim.ad, '120000.00'], ['03.5.5.07', birim.ad, '120000.00'],
    ])
  })
})

describe('gecikmiş ve durum raporları', () => {
  it('gecikmiş: PAKETTE taksit paket kimliğiyle listelenir; ODENDI ve vadesi gelmemiş listelenmez', async () => {
    const s = await aktifSozlesme(h)
    const [ocak, subat] = await sozlesmeTaksitleri(s)
    await sorgu()
    const p = await paketKur(h)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const bugun = t('2026-02-10')
    expect((await gecikmisOdemeler(bugun)).map((x) => [x.taksitId, x.vade, x.gecikmeGun, x.durum, x.paketId, x.tutar.toFixed(2)])).toEqual([
      [ocak!.id, '2026-01-01', 40, 'PLANLANDI', null, '10000.00'], [subat!.id, '2026-02-01', 9, 'PAKETTE', p, '10000.00'],
    ])
    await taksitSistemDisiOdendi(ocak!.id, ocak!.version, { odemeTarihi: t('2026-01-05'), not: 'F1 öncesi ödendi' }, TEST_BAGLAMI, bugun)
    expect((await gecikmisOdemeler(bugun)).map((x) => x.taksitId)).toEqual([subat!.id])
  })

  it('sözleşme durumu: artış onayı sonrası güncel bedel yeni bedel; sonraki artış tarihi; açık hatırlatma sayısı', async () => {
    const bugun = t('2026-03-05')
    const s = await aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, t('2026-02-20'))
    await prisma.$transaction((tx) => artislariHesapla(tx, bugun, s))
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, donemBaslangic: new Date('2026-03-01') } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, bugun)
    await prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, bugun), { timeout: 60_000 })
    const acik = await prisma.hatirlatma.count({ where: { sozlesmeId: s, durum: { in: ['ACIK', 'ERTELENDI'] } } })
    const yeni = (await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).yeniBedel!.toFixed(2)
    const [d] = await sozlesmeDurumRaporu(bugun)
    expect([d!.sozlesmeId, d!.durum, d!.baslangic, d!.bitisEtkin, d!.kalanGun, d!.guncelBedel.toFixed(2), d!.bedelTabani, d!.sonrakiArtis, d!.acikHatirlatma]).toEqual([
      s, 'AKTIF', '2025-03-01', '2027-02-28', 360, yeni, 'AYLIK', '2027-03-01', acik,
    ])
    expect(acik).toBeGreaterThan(0)
  })

  it('raporIndir("odenek", yil=abc) IsKuraliHatasi; geçerli yılda xlsx ve DISA_AKTAR', async () => {
    await aktifSozlesme(h)
    for (const q of ['yil=abc', '', 'yil=20266']) {
      expect(await raporIndir('odenek', new URLSearchParams(q), TEST_BAGLAMI, BUGUN).catch((e: unknown) => e)).toBeInstanceOf(IsKuraliHatasi)
    }
    const d = (await raporIndir('odenek', new URLSearchParams('yil=2026'), TEST_BAGLAMI, BUGUN))!
    expect([d.dosyaAdi, d.tur]).toEqual(['odenek-2026.xlsx', 'xlsx'])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(d.icerik as unknown as ArrayBuffer)
    expect((wb.worksheets[0]!.getRow(2).values as unknown[]).slice(1, 3)).toEqual(['03.5.5.05', (await prisma.birim.findUniqueOrThrow({ where: { id: h.birimId } })).ad])
    expect((await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'rapor', varlikId: 'odenek', eylem: 'DISA_AKTAR' } })).sonra).toEqual({ belge: 'odenek:2026', kayitSayisi: 1 })
    for (const rapor of ['gecikmis', 'sozlesme-durum']) {
      const x = (await raporIndir(rapor, new URLSearchParams(), TEST_BAGLAMI, BUGUN))!
      expect(x.dosyaAdi).toBe(`${rapor}-2026-01-25.xlsx`)
      expect((await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'rapor', varlikId: rapor, eylem: 'DISA_AKTAR' } })).sonra).toMatchObject({ belge: `${rapor}:2026-01-25` })
    }
  })
})
