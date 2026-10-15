import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { hisseToplami, hisseToplamiBirMi, hisseyeDagit, kesirGecerliMi, type Hisse } from '@/core/hisse'

const h = (kisiId: string, pay: number, payda: number): Hisse => ({ kisiId, pay, payda })

describe('kesir ve toplam', () => {
  it('geçersiz kesirleri reddeder', () => {
    expect(kesirGecerliMi({ pay: 1, payda: 3 })).toBe(true)
    expect(kesirGecerliMi({ pay: 0, payda: 3 })).toBe(false)
    expect(kesirGecerliMi({ pay: 4, payda: 3 })).toBe(false)
    expect(kesirGecerliMi({ pay: 1.5, payda: 3 })).toBe(false)
    expect(kesirGecerliMi({ pay: 1, payda: 0 })).toBe(false)
  })
  it('rasyonel toplamı tam hesaplar', () => {
    expect(hisseToplami([{ pay: 1, payda: 2 }, { pay: 1, payda: 3 }, { pay: 1, payda: 6 }])).toEqual({ pay: 1n, payda: 1n })
    expect(hisseToplamiBirMi([{ pay: 7, payda: 24 }, { pay: 17, payda: 24 }])).toBe(true)
    expect(hisseToplamiBirMi([{ pay: 1, payda: 3 }, { pay: 1, payda: 3 }, { pay: 1, payda: 3 }])).toBe(true)
    expect(hisseToplamiBirMi([{ pay: 1, payda: 3 }, { pay: 1, payda: 3 }])).toBe(false)
    expect(hisseToplamiBirMi([])).toBe(false)
  })
})

describe('hisseyeDagit (Review Focus #5)', () => {
  it('spec örneği: 10.000,00 TL → 5.000,00 / 3.333,33 / 1.666,67', () => {
    const s = hisseyeDagit(1_000_000n, [h('1', 1, 2), h('2', 1, 3), h('3', 1, 6)])
    expect(s.ok && s.deger).toEqual([
      { kisiId: '1', kurus: 500_000n },
      { kisiId: '2', kurus: 333_333n },
      { kisiId: '3', kurus: 166_667n },
    ])
  })
  it('eşit kalanda küçük kisiId kazanır (girdi sırasından bağımsız)', () => {
    const s = hisseyeDagit(100n, [h('5', 1, 3), h('2', 1, 3), h('9', 1, 3)])
    expect(s.ok && s.deger).toEqual([
      { kisiId: '5', kurus: 33n },
      { kisiId: '2', kurus: 34n },
      { kisiId: '9', kurus: 33n },
    ])
  })
  it('1 kuruş büyük kalana gider (7/24 + 17/24)', () => {
    const s = hisseyeDagit(1n, [h('1', 7, 24), h('2', 17, 24)])
    expect(s.ok && s.deger.map((x) => x.kurus)).toEqual([0n, 1n])
  })
  it('miras paydası 120 ile toplam korunur', () => {
    const hisseler = [h('1', 60, 120), h('2', 20, 120), h('3', 20, 120), h('4', 13, 120), h('5', 7, 120)]
    const s = hisseyeDagit(123_457n, hisseler)
    expect(s.ok).toBe(true)
    if (s.ok) expect(s.deger.reduce((a, x) => a + x.kurus, 0n)).toBe(123_457n)
  })
  it('sıfır tutarı sıfırlara böler', () => {
    const s = hisseyeDagit(0n, [h('1', 1, 2), h('2', 1, 2)])
    expect(s.ok && s.deger.map((x) => x.kurus)).toEqual([0n, 0n])
  })
  it('negatif tutar ve hatalı hisse toplamı hata döner', () => {
    const a = hisseyeDagit(-1n, [h('1', 1, 1)])
    expect(!a.ok && a.hata.kod).toBe('GECERSIZ_GIRDI')
    const b = hisseyeDagit(100n, [h('1', 1, 2)])
    expect(!b.ok && b.hata.kod).toBe('HISSE_TOPLAMI_HATALI')
  })
  it('sayısal olmayan veya boş kisiId hata döner (istisna fırlatmaz)', () => {
    const a = hisseyeDagit(100n, [h('a', 1, 2), h('b', 1, 2)])
    expect(!a.ok && a.hata.kod).toBe('GECERSIZ_GIRDI')
    const b = hisseyeDagit(100n, [h('', 1, 2), h('0', 1, 2)])
    expect(!b.ok && b.hata.kod).toBe('GECERSIZ_GIRDI')
  })
  it('tekrarlanan kisiId hata döner', () => {
    const s = hisseyeDagit(100n, [h('1', 1, 2), h('1', 1, 2)])
    expect(!s.ok && s.hata.kod).toBe('GECERSIZ_GIRDI')
  })
  it('sayısal değeri aynı olan kisiId (01 ve 1) tekrar sayılır', () => {
    const s = hisseyeDagit(100n, [h('01', 1, 2), h('1', 1, 2)])
    expect(!s.ok && s.hata.kod).toBe('GECERSIZ_GIRDI')
  })
  it('özellik: toplam korunur ve her pay ideal değerden 1 kuruştan az sapar', () => {
    const agirliklar = fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 8 })
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), agirliklar, (toplam, w) => {
      const payda = w.reduce((a, b) => a + b, 0)
      const hisseler = w.map((pay, i) => h(String(i + 1), pay, payda))
      const s = hisseyeDagit(toplam, hisseler)
      expect(s.ok).toBe(true)
      if (!s.ok) return
      expect(s.deger.reduce((a, x) => a + x.kurus, 0n)).toBe(toplam)
      s.deger.forEach((x, i) => {
        const ideal = toplam * BigInt(w[i]!)
        const fark = x.kurus * BigInt(payda) - ideal
        expect(fark > -BigInt(payda) && fark < BigInt(payda)).toBe(true)
      })
    }))
  })
})
