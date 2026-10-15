import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { para, D } from '@/core/para'
import { tarih as t, ayEkle, gunEkle, type Tarih } from '@/core/tarih'
import { taksitTutari, type KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import type { OdemePeriyodu } from '@/core/tipler'

const kd = (bas: string, bit: string | null, bedel: string, taban: 'AYLIK' | 'YILLIK' = 'AYLIK', id = '1'): KiraDonemiGirdi =>
  ({ id, baslangic: t(bas), bitis: bit === null ? null : t(bit), bedel: para(bedel), taban })

function hesapla(bas: string, bit: string, periyotAy: OdemePeriyodu, donemler: KiraDonemiGirdi[], kist: 'GERCEK_GUN' | 'OTUZ_GUN' = 'GERCEK_GUN', capa = '2026-01-01') {
  const s = taksitTutari({ donem: { baslangic: t(bas), bitis: t(bit) }, periyotAy, kiraAyiCapasi: t(capa), kiraDonemleri: donemler, kist })
  if (!s.ok) throw new Error(s.hata.mesaj)
  return s.deger.tutar.toFixed(2)
}

describe('K1 aylık taban', () => {
  it('tam ay ve üç aylık', () => {
    expect(hesapla('2026-01-01', '2026-01-31', 1, [kd('2026-01-01', null, '10000')])).toBe('10000.00')
    expect(hesapla('2026-01-01', '2026-03-31', 3, [kd('2026-01-01', null, '10000')])).toBe('30000.00')
  })
  it('kıst son dönem: gerçek gün ve 30 gün esası', () => {
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')])).toBe('4838.71')
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')], 'OTUZ_GUN')).toBe('5000.00')
  })
  it('dönem içinde artışla değişen bedel parça parça toplanır', () => {
    const donemler = [kd('2025-01-01', '2026-02-28', '10000', 'AYLIK', '1'), kd('2026-03-01', null, '13339', 'AYLIK', '2')]
    expect(hesapla('2026-01-01', '2026-03-31', 3, donemler, 'GERCEK_GUN', '2025-01-01')).toBe('33339.00')
  })
  it('kira bedeli olmayan gün varsa DONEM_DISI', () => {
    const s = taksitTutari({
      donem: { baslangic: t('2026-01-01'), bitis: t('2026-01-31') }, periyotAy: 1, kiraAyiCapasi: t('2026-01-01'),
      kiraDonemleri: [kd('2026-01-10', null, '10000')], kist: 'GERCEK_GUN',
    })
    expect(!s.ok && s.hata.kod).toBe('DONEM_DISI')
  })
})

describe('K1 yıllık taban', () => {
  it('aylık ödemede 11 × 8.333,33 + son taksit 8.333,37', () => {
    const donemler = [kd('2026-01-01', null, '100000', 'YILLIK')]
    const tutarlar: string[] = []
    for (let i = 0; i < 12; i++) {
      const bas = ayEkle(t('2026-01-01'), i)
      tutarlar.push(hesapla(bas, gunEkle(ayEkle(t('2026-01-01'), i + 1), -1), 1, donemler))
    }
    expect(tutarlar.slice(0, 11).every((x) => x === '8333.33')).toBe(true)
    expect(tutarlar[11]).toBe('8333.37')
  })
  it('üç aylıkta kuruş artığı son taksite', () => {
    const donemler = [kd('2026-01-01', null, '100000.01', 'YILLIK')]
    expect(hesapla('2026-01-01', '2026-03-31', 3, donemler)).toBe('25000.00')
    expect(hesapla('2026-10-01', '2026-12-31', 3, donemler)).toBe('25000.01')
    expect(hesapla('2027-01-01', '2027-03-31', 3, donemler)).toBe('25000.00')
  })
  it('kıst dönemde aylık eşdeğerle hesaplar', () => {
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '120000', 'YILLIK')])).toBe('4838.71')
  })
  it('kira dönemi ödeme dönemine hizalı değilse aylık eşdeğerle hesaplar', () => {
    expect(hesapla('2026-02-01', '2026-02-28', 1, [kd('2026-01-15', null, '120000', 'YILLIK')], 'GERCEK_GUN', '2026-01-01')).toBe('10000.00')
  })
  it('özellik: bir kira yılındaki taksitlerin toplamı yıllık bedele eşittir', () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1n, max: 10n ** 11n }),
      fc.constantFrom<OdemePeriyodu>(1, 3, 6, 12),
      fc.date({ min: new Date('2015-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }),
      (kurus, periyot, tarihD) => {
        const bas = t(tarihD.toISOString().slice(0, 10)) as Tarih
        const yillik = new D(kurus.toString()).dividedBy(100)
        const donemler = [{ id: '1', baslangic: bas, bitis: null, bedel: yillik, taban: 'YILLIK' as const }]
        let toplam = new D(0)
        for (let i = 0; i < 12 / periyot; i++) {
          const s = taksitTutari({
            donem: { baslangic: ayEkle(bas, i * periyot), bitis: gunEkle(ayEkle(bas, (i + 1) * periyot), -1) },
            periyotAy: periyot, kiraAyiCapasi: bas, kiraDonemleri: donemler, kist: 'GERCEK_GUN',
          })
          expect(s.ok).toBe(true)
          if (s.ok) {
            expect(s.deger.tutar.isNegative()).toBe(false)
            toplam = toplam.plus(s.deger.tutar)
          }
        }
        expect(toplam.toFixed(2)).toBe(yillik.toFixed(2))
      },
    ))
  })
})

describe('hesap izi', () => {
  it('her sonuç satır listesi içerir ve son satır K1 toplamıdır', () => {
    const s = taksitTutari({
      donem: { baslangic: t('2026-03-01'), bitis: t('2026-03-15') }, periyotAy: 1, kiraAyiCapasi: t('2026-01-01'),
      kiraDonemleri: [kd('2026-01-01', null, '10000')], kist: 'GERCEK_GUN',
    })
    expect(s.ok).toBe(true)
    if (s.ok) {
      expect(s.deger.satirlar.length).toBeGreaterThanOrEqual(2)
      expect(s.deger.satirlar.at(-1)!.sonuc).toBe('4838.71')
      expect(s.deger.satirlar.every((x) => x.kural === 'K1')).toBe(true)
    }
  })
})
