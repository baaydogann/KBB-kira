import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it('yıl 1900–2999 aralığının dışında kalan tarihleri reddeder', () => {
    expect(tarihMi('0026-01-01')).toBe(false)
    expect(tarihMi('1899-12-31')).toBe(false)
    expect(tarihMi('3000-01-01')).toBe(false)
    expect(tarihMi('1900-01-01')).toBe(true)
    expect(tarihAyristir('0026-01-01').ok).toBe(false)
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

describe('mutasyon kapısı: biçim kenarları', () => {
  it('tarihMi tam eşleşme ister; önek/sonek ve aralık dışı bileşenleri reddeder', () => {
    for (const s of ['a2026-01-01', '2026-01-01 ', '2026-01-011', '2026-13-01', '2026-00-10', '2026-01-00', '2026-02-29', '3000-01-01', '1899-12-31']) {
      expect(tarihMi(s)).toBe(false)
    }
    for (const s of ['2999-12-31', '1900-01-01', '2024-02-29']) expect(tarihMi(s)).toBe(true)
  })

  it('tarihAyristir: gg.aa.yyyy ve gg/aa/yyyy, tek ve çift haneli, çevresindeki boşluk kırpılır', () => {
    for (const [girdi, beklenen] of [
      [' 15.02.2026 ', '2026-02-15'], ['5.3.2026', '2026-03-05'], ['15/12/2026', '2026-12-15'], ['\t2026-10-15\n', '2026-10-15'],
    ] as const) {
      const s = tarihAyristir(girdi)
      expect(s.ok && s.deger).toBe(beklenen)
    }
  })

  it('tarihAyristir: önek ve sonek taşıyan girdiyi TARIH_GECERSIZ ile reddeder', () => {
    for (const girdi of ['x01.02.2026', '01.02.2026x', '001.02.2026', '01.002.2026', '', '31.02.2026']) {
      const s = tarihAyristir(girdi)
      expect(s.ok).toBe(false)
      if (!s.ok) {
        expect(s.hata.kod).toBe('TARIH_GECERSIZ')
        expect(s.hata.mesaj).toBe('Tarihi gg.aa.yyyy biçiminde girin.')
      }
    }
  })
})

describe('mutasyon kapısı: aralık işlemleri', () => {
  const ar = (b: string, s: string | null) => ({ baslangic: t(b), bitis: s === null ? null : t(s) })

  it('kesisim: dört açık/kapalı uç kombinasyonu ve tek günlük kesişim', () => {
    expect(kesisim(ar('2026-01-01', null), ar('2026-03-01', '2026-03-31'))).toEqual({ baslangic: '2026-03-01', bitis: '2026-03-31' })
    expect(kesisim(ar('2026-01-01', '2026-06-30'), ar('2026-03-01', null))).toEqual({ baslangic: '2026-03-01', bitis: '2026-06-30' })
    expect(kesisim(ar('2026-01-01', null), ar('2026-03-01', null))).toEqual({ baslangic: '2026-03-01', bitis: null })
    expect(kesisim(ar('2026-01-01', '2026-01-10'), ar('2026-01-10', null))).toEqual({ baslangic: '2026-01-10', bitis: '2026-01-10' })
    expect(kesisim(ar('2026-01-01', '2026-01-09'), ar('2026-01-10', null))).toBeNull()
  })

  it('icindeMi: uçlar dahil, açık uçlu aralık sonsuza uzanır', () => {
    const kapali = ar('2026-01-10', '2026-01-20')
    expect(icindeMi(t('2026-01-10'), kapali)).toBe(true)
    expect(icindeMi(t('2026-01-20'), kapali)).toBe(true)
    expect(icindeMi(t('2026-01-15'), kapali)).toBe(true)
    expect(icindeMi(t('2026-01-09'), kapali)).toBe(false)
    expect(icindeMi(t('2026-01-21'), kapali)).toBe(false)
    const acik = ar('2026-01-10', null)
    expect(icindeMi(t('2999-12-31'), acik)).toBe(true)
    expect(icindeMi(t('2026-01-09'), acik)).toBe(false)
  })
})

describe('mutasyon kapısı: bugunIstanbul sunucu saat diliminden bağımsızdır', () => {
  const eskiTz = process.env.TZ
  afterEach(() => {
    if (eskiTz === undefined) delete process.env.TZ
    else process.env.TZ = eskiTz
    vi.resetModules()
  })

  // Birim testleri vitest.config.ts ile TZ=UTC'de koşar; burada süreç dilimi UTC-10'a alınır ki İstanbul'a sabitleme
  // hem UTC'ye hem başka bir dilime karşı sınansın (modül sabit biçimleyiciyi içe aktarma anında kurar).
  it('süreç saat dilimi İstanbul dışında (UTC-10) iken bile İstanbul gününü verir', async () => {
    process.env.TZ = 'Pacific/Honolulu'
    vi.resetModules()
    const taze = await import('@/core/tarih')
    expect(taze.bugunIstanbul(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16')
    expect(taze.bugunIstanbul(new Date('2026-10-15T09:30:00Z'))).toBe('2026-10-15')
  })
})
