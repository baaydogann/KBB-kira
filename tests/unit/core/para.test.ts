import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  D, SIFIR, enBuyuk, enKucuk, formatOran, formatTL, kurusaCevir, kurustanPara,
  oranAyristir, para, paraAyristir, topla, yuvarla,
} from '@/core/para'

describe('yuvarla', () => {
  it('varsayılan yarım yukarı yuvarlar', () => {
    expect(yuvarla(para('2.345')).toFixed(2)).toBe('2.35')
    expect(yuvarla(para('2.344')).toFixed(2)).toBe('2.34')
    expect(yuvarla(para('-2.345')).toFixed(2)).toBe('-2.35')
  })
  it('ASAGI modu sıfıra doğru keser', () => {
    expect(yuvarla(para('11068.328906'), 'ASAGI').toFixed(2)).toBe('11068.32')
    expect(yuvarla(para('11068.328906')).toFixed(2)).toBe('11068.33')
  })
})

describe('kuruş dönüşümü', () => {
  it('iki ondalıklı tutarı kuruşa ve geri çevirir', () => {
    expect(kurusaCevir(para('10000.00'))).toBe(1000000n)
    expect(kurusaCevir(para('0.01'))).toBe(1n)
    expect(kurustanPara(166667n).toFixed(2)).toBe('1666.67')
  })
  it('kuruştan küçük kesirde hata fırlatır', () => {
    expect(() => kurusaCevir(para('1.005'))).toThrow(/kuruş/i)
  })
  it('her iki ondalıklı tutar için gidiş-dönüş kayıpsızdır', () => {
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (k) => {
      expect(kurusaCevir(kurustanPara(k))).toBe(k)
    }))
  })
})

describe('yardımcılar', () => {
  it('topla, enKucuk, enBuyuk', () => {
    expect(topla([para('0.1'), para('0.2')]).toString()).toBe('0.3')
    expect(topla([]).equals(SIFIR)).toBe(true)
    expect(enKucuk(para('3'), para('2')).toString()).toBe('2')
    expect(enBuyuk(para('3'), para('2')).toString()).toBe('3')
  })
  it('para() Prisma Decimal benzeri nesneleri toString ile kabul eder', () => {
    expect(para(new D('12.50')).toFixed(2)).toBe('12.50')
    expect(() => para('abc')).toThrow()
  })
})

describe('formatTL', () => {
  it('Türk biçiminde binlik ve kuruş ayracı kullanır', () => {
    expect(formatTL(para('0'))).toBe('0,00 ₺')
    expect(formatTL(para('1234567.891'))).toBe('1.234.567,89 ₺')
    expect(formatTL('-5')).toBe('-5,00 ₺')
    expect(formatTL(para('999.995'), false)).toBe('1.000,00')
  })
})

describe('formatOran', () => {
  it('en az iki, en çok dört ondalık gösterir', () => {
    expect(formatOran(para('31.49'))).toBe('%31,49')
    expect(formatOran(para('29.3150'))).toBe('%29,315')
    expect(formatOran(para('25'))).toBe('%25,00')
  })
  it('dört ondalığa yuvarlar, sonra biçimi seçer (5+ ondalıkta 2 ondalık minimumu korunur)', () => {
    expect(formatOran(para('31.99999'))).toBe('%32,00')
    expect(formatOran(para('29.00001'))).toBe('%29,00')
    expect(formatOran(para('0.00001'))).toBe('%0,00')
    expect(formatOran(para('12.34567'))).toBe('%12,3457')
  })
})

describe('paraAyristir (Review Focus #4)', () => {
  it.each([
    ['1.234,56', '1234.56'],
    ['1234,56', '1234.56'],
    ['1234', '1234.00'],
    ['1.234', '1234.00'],
    ['1.234.567', '1234567.00'],
    ['0,5', '0.50'],
    ['  12.500,00 ₺ ', '12500.00'],
    ['7.500 TL', '7500.00'],
  ])('%s → %s', (girdi, beklenen) => {
    const s = paraAyristir(girdi)
    expect(s.ok).toBe(true)
    if (s.ok) expect(s.deger.toFixed(2)).toBe(beklenen)
  })

  it.each(['1234.56', '1.234.56', '12,345', '1,234,56', '', 'abc', '1.23,45', '-', '0.500', '01.234'])(
    '%s reddedilir (nokta-ondalık veya bozuk biçim)',
    (girdi) => {
      const s = paraAyristir(girdi)
      expect(s.ok).toBe(false)
      if (!s.ok) expect(s.hata.kod).toBe('TUTAR_GECERSIZ')
    },
  )
})

describe('oranAyristir', () => {
  it('virgüllü oranı kabul eder, noktalıyı reddeder', () => {
    const a = oranAyristir('31,49')
    expect(a.ok && a.deger.toString()).toBe('31.49')
    expect(oranAyristir('%25').ok).toBe(true)
    expect(oranAyristir('31.49').ok).toBe(false)
    expect(oranAyristir('31,12345').ok).toBe(false)
  })
})

describe('D yapılandırması (mutasyon kapısı)', () => {
  it('40 anlamlı basamak ve üstel gösterim eşikleriyle çalışır', () => {
    expect(new D(1).dividedBy(3).toString()).toBe(`0.${'3'.repeat(40)}`)
    expect(new D('0.0000001').toString()).toBe('0.0000001')
    expect(new D('1e-39').toString()).toBe(`0.${'0'.repeat(38)}1`)
    expect(new D(1).toString()).toBe('1')
    expect(new D('1e25').toString()).toBe(`1${'0'.repeat(25)}`)
  })
})

describe('para() girdi denetimi', () => {
  it('baştaki ve sondaki boşlukları yok sayar', () => {
    expect(para('  12.50 ').toFixed(2)).toBe('12.50')
  })
  it('sonlu olmayan değerleri reddeder', () => {
    expect(() => para('Infinity')).toThrow(/Sonlu olmayan sayı: Infinity/)
    expect(() => para('NaN')).toThrow(/Sonlu olmayan sayı: NaN/)
  })
})

describe('ayrıştırıcıların sabitlenmiş kenarları', () => {
  it('paraAyristir: ₺/TL yalnızca sonda kabul edilir', () => {
    expect(paraAyristir('₺1.234,56').ok).toBe(false)
    expect(paraAyristir('TL1234').ok).toBe(false)
    expect(paraAyristir('1.234,56₺').ok).toBe(true)
    expect(paraAyristir('1234 tl').ok).toBe(true)
  })
  it('oranAyristir: % yalnızca başta kabul edilir ve hata kodu döner', () => {
    expect(oranAyristir('31,49%').ok).toBe(false)
    expect(oranAyristir('% 31,49').ok).toBe(true)
    const s = oranAyristir('abc')
    expect(s.ok).toBe(false)
    if (!s.ok) {
      expect(s.hata.kod).toBe('TUTAR_GECERSIZ')
      expect(s.hata.mesaj).toContain('Oranı')
    }
  })
})
