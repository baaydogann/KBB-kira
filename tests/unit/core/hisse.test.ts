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

describe('mutasyon kapısı: sabitlenmiş kenarlar', () => {
  it('kisiId yalnızca rakamlardan oluşmalı: önek, sonek ve çok haneli kimlik', () => {
    expect(hisseyeDagit(100n, [h('a1', 1, 2), h('2', 1, 2)]).ok).toBe(false)
    expect(hisseyeDagit(100n, [h('1a', 1, 2), h('2', 1, 2)]).ok).toBe(false)
    const cok = hisseyeDagit(100n, [h('10', 1, 2), h('11', 1, 2)])
    expect(cok.ok && cok.deger.map((x) => x.kurus)).toEqual([50n, 50n])
  })
  it('kesirGecerliMi sayı olmayan girdiyi ve azami paydayı sınar', () => {
    expect(kesirGecerliMi({ pay: '1' as unknown as number, payda: 3 })).toBe(false)
    expect(kesirGecerliMi({ pay: 1, payda: 1_000_000 })).toBe(true)
    expect(kesirGecerliMi({ pay: 1, payda: 1_000_001 })).toBe(false)
  })
  it('hisseToplamiBirMi geçersiz kesir içeren listeyi toplamı 1 olsa da reddeder', () => {
    expect(hisseToplamiBirMi([{ pay: 3, payda: 2 }, { pay: -1, payda: 2 }])).toBe(false)
    expect(hisseToplamiBirMi([{ pay: 1, payda: 2 }, { pay: -1, payda: 2 }, { pay: 1, payda: 1 }])).toBe(false)
  })
  it('hisseToplami işaretten bağımsız indirger (ebob her zaman pozitif)', () => {
    expect(hisseToplami([{ pay: 1, payda: 2 }, { pay: 1, payda: 2 }])).toEqual({ pay: 1n, payda: 1n })
    expect(hisseToplami([{ pay: -2, payda: 4 }])).toEqual({ pay: -1n, payda: 2n })
    expect(hisseToplami([{ pay: 4, payda: -2 }])).toEqual({ pay: 2n, payda: -1n })
  })
  it('eşit kalanlarda sonuç girdi sırasından bağımsızdır (tüm permütasyonlar)', () => {
    const kimlikler = ['2', '5', '9', '12']
    const permutasyonlar = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutasyonlar([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])))
    for (const sira of permutasyonlar(kimlikler)) {
      const s = hisseyeDagit(101n, sira.map((k) => h(k, 1, 4)))
      expect(s.ok && Object.fromEntries(s.deger.map((x) => [x.kisiId, x.kurus]))).toEqual({ '2': 26n, '5': 25n, '9': 25n, '12': 25n })
    }
  })
  it('farklı kalanlarda en büyük kalan, kisiId sırasına rağmen önce gelir (tüm permütasyonlar)', () => {
    // 100 kuruş: 1/4 → 25 (kalan 0), 1/3 → 33 (kalan 1/3), 5/12 → 41 (kalan 8/12=2/3); artık 1 → en büyük kalan (5/12) alır.
    const hisseler = [h('1', 1, 4), h('2', 1, 3), h('3', 5, 12)]
    const permutasyonlar = <T,>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutasyonlar([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])))
    for (const sira of permutasyonlar(hisseler)) {
      const s = hisseyeDagit(100n, sira)
      expect(s.ok && Object.fromEntries(s.deger.map((x) => [x.kisiId, x.kurus]))).toEqual({ '1': 25n, '2': 33n, '3': 42n })
    }
  })
})

describe('mutasyon kapısı: en büyük kalan yönteminin tanımı (özellik)', () => {
  it('fazladan kuruş alanın kalanı, almayanın kalanından büyüktür; eşitse kisiId küçüktür (girdi sırası ne olursa olsun)', () => {
    const girdiler = fc.uniqueArray(
      fc.record({ id: fc.integer({ min: 1, max: 60 }), agirlik: fc.integer({ min: 1, max: 6 }) }),
      { selector: (x) => x.id, minLength: 2, maxLength: 8 },
    )
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10_000n }), girdiler, (toplam, liste) => {
      const payda = liste.reduce((a, x) => a + x.agirlik, 0)
      const hisseler = liste.map((x) => h(String(x.id), x.agirlik, payda))
      const s = hisseyeDagit(toplam, hisseler)
      expect(s.ok).toBe(true)
      if (!s.ok) return
      const bilgi = liste.map((x, i) => {
        const carpim = toplam * BigInt(x.agirlik)
        const taban = carpim / BigInt(payda)
        return { id: x.id, kalan: carpim % BigInt(payda), fazla: s.deger[i]!.kurus - taban }
      })
      for (const a of bilgi) {
        for (const b of bilgi) {
          if (a.fazla === 1n && b.fazla === 0n) {
            // Payda ortak olduğundan kalanlar doğrudan karşılaştırılabilir.
            expect(a.kalan > b.kalan || (a.kalan === b.kalan && a.id < b.id)).toBe(true)
          }
        }
      }
    }), { numRuns: 500 })
  })
})
