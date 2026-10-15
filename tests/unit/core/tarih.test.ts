import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  ayAdi, ayAnahtari, ayEkle, ayFarki, ayKaydir, ayinGunSayisi, ayinIlkGunu, bugunIstanbul,
  dateToTarih, enBuyukTarih, enKucukTarih, formatTarih, gunEkle, gunFarki, icindeMi, isGunuEkle, isGunuMu,
  karsilastir, kesisim, sonrakiIsGunu, tarih, tarihAyristir, tarihinAyi, tarihMi, tarihToDate, type Tarih,
} from '@/core/tarih'

const t = tarih

describe('tarih doğrulama', () => {
  it('geçerli ve geçersiz tarihleri ayırır', () => {
    expect(tarihMi('2024-02-29')).toBe(true)
    expect(tarihMi('2026-02-29')).toBe(false)
    expect(tarihMi('2026-13-01')).toBe(false)
    expect(tarihMi('2026-1-01')).toBe(false)
    expect(() => tarih('2026-04-31')).toThrow()
  })
  it('ayinGunSayisi artık yılı bilir', () => {
    expect(ayinGunSayisi(2024, 2)).toBe(29)
    expect(ayinGunSayisi(2026, 2)).toBe(28)
    expect(ayinGunSayisi(2026, 12)).toBe(31)
  })
})

describe('ayEkle (Review Focus #2)', () => {
  it('ay sonuna kırpar, zincirleme değil orijinal günden hesaplanır', () => {
    expect(ayEkle(t('2026-01-31'), 1)).toBe('2026-02-28')
    expect(ayEkle(t('2024-01-31'), 1)).toBe('2024-02-29')
    expect(ayEkle(t('2026-01-31'), 2)).toBe('2026-03-31')
    expect(ayEkle(t('2026-03-31'), -1)).toBe('2026-02-28')
    expect(ayEkle(t('2026-11-15'), 3)).toBe('2027-02-15')
    expect(ayEkle(t('2024-02-29'), 12)).toBe('2025-02-28')
    expect(ayEkle(t('2024-02-29'), 48)).toBe('2028-02-29')
  })
  it('ayFarki ayEkle ile tutarlıdır', () => {
    expect(ayFarki(t('2026-01-31'), t('2026-02-28'))).toBe(1)
    expect(ayFarki(t('2026-01-31'), t('2026-02-27'))).toBe(0)
    expect(ayFarki(t('2026-03-15'), t('2026-02-20'))).toBe(-1)
    expect(ayFarki(t('2025-03-01'), t('2026-03-01'))).toBe(12)
  })
  it('özellik: ayEkle(a, ayFarki(a,b)) ≤ b < ayEkle(a, ayFarki(a,b)+1)', () => {
    const tarihUret = fc.date({ min: new Date('2000-01-01'), max: new Date('2060-12-31'), noInvalidDate: true }).map(dateToTarih)
    fc.assert(fc.property(tarihUret, tarihUret, (a, b) => {
      const k = ayFarki(a, b)
      expect(karsilastir(ayEkle(a, k), b)).toBeLessThanOrEqual(0)
      expect(karsilastir(ayEkle(a, k + 1), b)).toBe(1)
    }))
  })
})

describe('gün aritmetiği', () => {
  it('gunEkle ve gunFarki', () => {
    expect(gunEkle(t('2026-12-31'), 1)).toBe('2027-01-01')
    expect(gunEkle(t('2024-03-01'), -1)).toBe('2024-02-29')
    expect(gunFarki(t('2026-01-01'), t('2026-12-31'))).toBe(364)
  })
  it('özellik: gunFarki(t, gunEkle(t, n)) = n', () => {
    const tarihUret = fc.date({ min: new Date('2000-01-01'), max: new Date('2060-12-31'), noInvalidDate: true }).map(dateToTarih)
    fc.assert(fc.property(tarihUret, fc.integer({ min: -2000, max: 2000 }), (x, n) => {
      expect(gunFarki(x, gunEkle(x, n))).toBe(n)
    }))
  })
})

describe('karşılaştırma ve aralıklar', () => {
  it('karsilastir, enKucukTarih, enBuyukTarih', () => {
    expect(karsilastir(t('2026-01-01'), t('2026-01-02'))).toBe(-1)
    expect(karsilastir(t('2026-01-02'), t('2026-01-02'))).toBe(0)
    expect(enKucukTarih(t('2026-05-01'), t('2026-04-01'))).toBe('2026-04-01')
    expect(enBuyukTarih(t('2026-05-01'), t('2026-04-01'))).toBe('2026-05-01')
  })
  it('kesisim açık uçlu aralıkları destekler', () => {
    expect(kesisim({ baslangic: t('2026-01-01'), bitis: t('2026-03-31') }, { baslangic: t('2026-03-01'), bitis: null }))
      .toEqual({ baslangic: '2026-03-01', bitis: '2026-03-31' })
    expect(kesisim({ baslangic: t('2026-01-01'), bitis: t('2026-01-31') }, { baslangic: t('2026-02-01'), bitis: null })).toBeNull()
    expect(kesisim({ baslangic: t('2026-01-01'), bitis: null }, { baslangic: t('2025-06-01'), bitis: null }))
      .toEqual({ baslangic: '2026-01-01', bitis: null })
    expect(icindeMi(t('2026-02-15'), { baslangic: t('2026-02-01'), bitis: null })).toBe(true)
    expect(icindeMi(t('2026-01-15'), { baslangic: t('2026-02-01'), bitis: null })).toBe(false)
  })
})

describe('ay yardımcıları', () => {
  it('ayKaydir yıl sınırlarını geçer', () => {
    expect(ayKaydir({ yil: 2026, ay: 1 }, -1)).toEqual({ yil: 2025, ay: 12 })
    expect(ayKaydir({ yil: 2026, ay: 12 }, 1)).toEqual({ yil: 2027, ay: 1 })
    expect(ayKaydir({ yil: 2026, ay: 9 }, -23)).toEqual({ yil: 2024, ay: 10 })
    expect(ayAnahtari({ yil: 2026, ay: 9 })).toBe('2026-09')
    expect(tarihinAyi(t('2026-10-15'))).toEqual({ yil: 2026, ay: 10 })
    expect(ayinIlkGunu({ yil: 2026, ay: 3 })).toBe('2026-03-01')
    expect(ayAdi({ yil: 2026, ay: 9 })).toBe('Eylül 2026')
  })
})

describe('biçim ve ayrıştırma', () => {
  it('gg.aa.yyyy', () => {
    expect(formatTarih(t('2026-03-05'))).toBe('05.03.2026')
    const a = tarihAyristir('5.3.2026')
    expect(a.ok && a.deger).toBe('2026-03-05')
    expect(tarihAyristir('2026-03-05').ok).toBe(true)
    expect(tarihAyristir('31.02.2026').ok).toBe(false)
    expect(tarihAyristir('').ok).toBe(false)
  })
  it('Date ↔ Tarih UTC üzerinden kayıpsızdır', () => {
    expect(dateToTarih(new Date(Date.UTC(2026, 9, 15)))).toBe('2026-10-15')
    expect(tarihToDate(t('2026-10-15')).toISOString()).toBe('2026-10-15T00:00:00.000Z')
  })
  it('bugunIstanbul UTC gece yarısına yakın saatlerde İstanbul gününü verir', () => {
    expect(bugunIstanbul(new Date('2026-10-15T21:30:00Z'))).toBe('2026-10-16')
    expect(bugunIstanbul(new Date('2026-10-15T20:59:00Z'))).toBe('2026-10-15')
  })
})

describe('iş günü', () => {
  const tatiller = new Set<string>(['2026-10-29'])
  it('hafta sonu ve tatili atlar', () => {
    expect(isGunuMu(t('2026-10-29'), tatiller)).toBe(false)
    expect(isGunuMu(t('2026-10-31'), tatiller)).toBe(false)
    expect(isGunuMu(t('2026-10-30'), tatiller)).toBe(true)
    expect(sonrakiIsGunu(t('2026-10-31'), tatiller)).toBe('2026-11-02')
    expect(sonrakiIsGunu(t('2026-10-30'), tatiller)).toBe('2026-10-30')
  })
  it('isGunuEkle ileri ve geri sayar', () => {
    expect(isGunuEkle(t('2026-10-28'), 1, tatiller)).toBe('2026-10-30')
    expect(isGunuEkle(t('2026-11-02'), -2, tatiller)).toBe('2026-10-28')
    expect(isGunuEkle(t('2026-10-28'), 0, tatiller)).toBe('2026-10-28')
  })
})

function _tipKontrol(x: Tarih): string { return x }
void _tipKontrol
