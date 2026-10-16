import ExcelJS from 'exceljs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { para, type Para } from '@/core/para'
import { tarih as t, type Tarih } from '@/core/tarih'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketKesinlestir, paketOdemeEmriGir, paketOdendi } from '@/server/paket/durum'
import { paketHesapla } from '@/server/paket/hesapla'
import { raporIndir } from '@/server/rapor/indir'
import { damgaBeyanListesi, kesinti22aListesi, muhtasarListesi } from '@/server/rapor/vergi'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur } from './paket-yardimci'

const EYLUL = { yil: 2026, ay: 9 }
let h: Hazirlik

const sorgu = (kisiId: number, gun: Tarih, borc: string | null, vergiDairesi: string) =>
  borcSorguEkle({ kisiId, sorguTarihi: gun, borcVar: borc !== null, borcTutari: borc === null ? null : para(borc), vergiDairesi, belgeNo: `B-${vergiDairesi}`, belgeId: null }, TEST_BAGLAMI, gun)

/** Eylül'de ödenmiş paket (A: Meram V.D. 6.000 borç; B: Karatay V.D. 7.000 borç) ve Ekim'de yalnızca kesinleşmiş paket. */
beforeAll(async () => {
  await temizle()
  h = await hazirlik()
  await aktifSozlesme(h)
  await aktifSozlesme(h, { tasinmazId: h.arsaId, malikler: [{ kisiId: h.kisiB, pay: 1, payda: 1, ibanId: h.ibanB, vekilKisiId: null }] })
  const eylul = t('2026-09-01')
  await sorgu(h.kisiA, eylul, '6000.00', 'Meram V.D.')
  await sorgu(h.kisiB, eylul, '7000.00', 'Karatay V.D.')
  const p = await paketKur(h, { ad: 'Eylül', vadeBaslangic: eylul, vadeBitis: t('2026-09-30') })
  await paketHesapla(p, 0, TEST_BAGLAMI, eylul)
  await paketKesinlestir(p, 1, TEST_BAGLAMI, eylul)
  await paketOdemeEmriGir(p, 2, { no: 'ÖE-9', tarih: eylul }, TEST_BAGLAMI, eylul)
  await paketOdendi(p, 3, t('2026-09-02'), TEST_BAGLAMI, t('2026-09-02'))
  const ekim = t('2026-10-01')
  await sorgu(h.kisiA, ekim, null, 'Meram V.D.')
  await sorgu(h.kisiB, ekim, null, 'Karatay V.D.')
  const e = await paketKur(h, { ad: 'Ekim', vadeBaslangic: ekim, vadeBitis: t('2026-10-31') })
  await paketHesapla(e, 0, TEST_BAGLAMI, ekim)
  await paketKesinlestir(e, 1, TEST_BAGLAMI, ekim)
}, 120_000)
afterAll(() => prisma.$disconnect())

const metin = (x: unknown) => (x !== null && typeof x === 'object' && 'toFixed' in x ? (x as Para).toFixed(2) : x)

describe('vergi listeleri', () => {
  it('muhtasar 2026-09: yalnız ödeme tarihi Eylül olan ODENDI paketin satırı; brüt 10.000,00, stopaj 2.000,00, kod 041', async () => {
    const r = await muhtasarListesi(EYLUL)
    expect(r.sutunlar.map((s) => s.baslik)).toEqual(['Tür kodu', 'TCKN/VKN', 'Soyadı/Unvanı', 'Adı', 'Gayrisafi tutar', 'Kesilen vergi'])
    const a = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    expect(r.satirlar).toHaveLength(2)
    expect(r.satirlar.map((s) => s.map(metin)).find((s) => s[1] === a.tckn)).toEqual(['041', a.tckn, a.soyad, a.ad, '10000.00', '2000.00'])
    expect(r.uyarilar).toEqual([])
    expect((await muhtasarListesi({ yil: 2026, ay: 10 })).satirlar).toEqual([])
  })

  it('damga 2026-09: 226,80, olay ILK', async () => {
    const r = await damgaBeyanListesi(EYLUL)
    expect(r.sutunlar.map((s) => s.baslik)).toEqual(['Sözleşme no', 'Malik', 'TCKN/VKN', 'Damga olayı', 'Olay tarihi', 'Kesilen damga'])
    expect(r.satirlar.map((s) => [s[3], s[4], metin(s[5])])).toEqual([['ILK', '2025-12-20', '226.80'], ['ILK', '2025-12-20', '226.80']])
  })

  it('22/A 2026-09: vergi dairesine göre sıralı; Özet sayfasında toplam', async () => {
    const r = await kesinti22aListesi(EYLUL)
    expect(r.sutunlar.map((s) => s.baslik)).toEqual(['Vergi dairesi', 'Belge no', 'Sorgu tarihi', 'Borçlu', 'TCKN/VKN', 'Kesinti', 'Paket', 'Ödeme tarihi'])
    expect(r.satirlar.map((s) => [s[0], metin(s[5]), s[7]])).toEqual([['Karatay V.D.', '7000.00', '2026-09-02'], ['Meram V.D.', '6000.00', '2026-09-02']])
    const dosya = (await raporIndir('kesinti-22a', new URLSearchParams('ay=2026-09'), TEST_BAGLAMI, t('2026-10-05')))!
    expect([dosya.dosyaAdi, dosya.tur]).toEqual(['kesinti-22a-2026-09.xlsx', 'xlsx'])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(dosya.icerik as unknown as ArrayBuffer)
    const ozet = wb.getWorksheet('Özet')!
    expect([2, 3].map((i) => (ozet.getRow(i).values as unknown[]).slice(1))).toEqual([['Karatay V.D.', 7000], ['Meram V.D.', 6000]])
  })

  it('CSV: BOM ile başlar, ; ayraçlı, para "2000,00"', async () => {
    const dosya = (await raporIndir('muhtasar', new URLSearchParams('ay=2026-09&bicim=csv'), TEST_BAGLAMI, t('2026-10-05')))!
    expect([dosya.dosyaAdi, dosya.tur]).toEqual(['muhtasar-2026-09.csv', 'csv'])
    const csv = dosya.icerik as string
    expect(csv.startsWith('﻿Tür kodu;TCKN/VKN;')).toBe(true)
    expect(csv).toContain(';10000,00;2000,00\r\n')
    const damga = (await raporIndir('damga', new URLSearchParams('ay=2026-09&bicim=csv'), TEST_BAGLAMI, t('2026-10-05')))!
    expect(damga.icerik as string).toContain(';ILK;20.12.2025;226,80\r\n')
  })

  it('raporIndir: bilinmeyen rapor null; ay "2026-13" IsKuraliHatasi; DISA_AKTAR yazılır', async () => {
    expect(await raporIndir('yok', new URLSearchParams('ay=2026-09'), TEST_BAGLAMI, t('2026-10-05'))).toBeNull()
    for (const q of ['ay=2026-13', 'ay=2026-9', '', 'ay=2026-09&bicim=pdf']) {
      expect((await raporIndir('muhtasar', new URLSearchParams(q), TEST_BAGLAMI, t('2026-10-05')).catch((e: unknown) => e))).toBeInstanceOf(IsKuraliHatasi)
    }
    await raporIndir('muhtasar', new URLSearchParams('ay=2026-09'), TEST_BAGLAMI, t('2026-10-05'))
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'rapor', varlikId: 'muhtasar', eylem: 'DISA_AKTAR' }, orderBy: { id: 'desc' } })
    expect(d.sonra).toEqual({ belge: 'muhtasar:2026-09', kayitSayisi: 2 })
  })
})
