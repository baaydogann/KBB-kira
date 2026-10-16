import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { taksitDagilimi, type DagilimMaligi, type DagilimParcasi, type DagilimSatiri } from '@/core/hesap/dagilim'
import { para, topla } from '@/core/para'
import { tarih as t, gunEkle } from '@/core/tarih'

const m = (kisiId: string, pay: number, payda: number, stopaj = '20', kdv = '0'): DagilimMaligi => ({
  kisiId, pay, payda, sozlesmeMalikId: `m${kisiId}`, odemeKisiId: kisiId, ibanId: `i${kisiId}`, stopajOrani: para(stopaj), kdvOrani: para(kdv),
})
const parca = (bas: string, bit: string, malikler: DagilimMaligi[]): DagilimParcasi => ({ baslangic: t(bas), bitis: t(bit), malikler })
const subat = (malikler: DagilimMaligi[]) => [parca('2026-02-01', '2026-02-28', malikler)]

function sonuc(x: ReturnType<typeof taksitDagilimi>): DagilimSatiri[] {
  if (!x.ok) throw new Error(`beklenmeyen hata: ${x.hata.kod}`)
  return x.deger
}
const f = (satirlar: DagilimSatiri[], alan: 'payTutari' | 'brut' | 'kdv' | 'stopaj' | 'odenecek') => satirlar.map((s) => s[alan].toFixed(2))

describe('taksitDagilimi — K3 + K4', () => {
  it('tek malik GMSİ brüt 10.000,00 → stopaj 2.000,00, ödenecek 8.000,00', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('10000.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 1)]) }))
    expect(s).toHaveLength(1)
    expect([s[0]!.brut.toFixed(2), s[0]!.kdv.toFixed(2), s[0]!.stopaj.toFixed(2), s[0]!.odenecek.toFixed(2)]).toEqual(['10000.00', '0.00', '2000.00', '8000.00'])
    expect(s[0]!).toMatchObject({ parca: 0, kisiId: '1', sozlesmeMalikId: 'm1', odemeKisiId: '1', ibanId: 'i1', pay: 1, payda: 1 })
    expect(s[0]!.stopajOrani.toString()).toBe('20')
    expect([s[0]!.parcaBaslangic, s[0]!.parcaBitis]).toEqual(['2026-02-01', '2026-02-28'])
  })

  it('üç eşit hisse 100,00 → 33,34 / 33,33 / 33,33; artık kuruş en küçük kişi kimliğine', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('100.00'), bedelTuru: 'BRUT', parcalar: subat([m('9', 1, 3), m('2', 1, 3), m('5', 1, 3)]) }))
    expect(s.map((x) => x.kisiId)).toEqual(['2', '5', '9'])
    expect(f(s, 'payTutari')).toEqual(['33.34', '33.33', '33.33'])
    expect(f(s, 'stopaj')).toEqual(['6.67', '6.67', '6.67'])
    expect(f(s, 'odenecek')).toEqual(['26.67', '26.66', '26.66'])
  })

  it('NET sözleşme 7/24 + 17/24, 1.000,00 → net payı 291,67 / 708,33; brüt 364,59 / 885,41; stopaj 72,92 / 177,08', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('1000.00'), bedelTuru: 'NET', parcalar: subat([m('1', 7, 24), m('2', 17, 24)]) }))
    expect(f(s, 'payTutari')).toEqual(['291.67', '708.33'])
    expect(f(s, 'brut')).toEqual(['364.59', '885.41'])
    expect(f(s, 'stopaj')).toEqual(['72.92', '177.08'])
    expect(f(s, 'odenecek')).toEqual(['291.67', '708.33'])
  })

  it('şirket KDV %20: 10.000,00 → KDV 2.000,00, stopaj 0, ödenecek 12.000,00', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('10000.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 1, '0', '20')]) }))
    expect([f(s, 'kdv'), f(s, 'stopaj'), f(s, 'odenecek')]).toEqual([['2000.00'], ['0.00'], ['12000.00']])
  })

  it('iki parça (10 + 21 gün), 3.100,00 → 1.000,00 (A) ve 2.100,00 (B); satırlar parça sırasıyla', () => {
    const s = sonuc(taksitDagilimi({
      tutar: para('3100.00'), bedelTuru: 'BRUT',
      parcalar: [parca('2026-03-01', '2026-03-10', [m('7', 1, 1)]), parca('2026-03-11', '2026-03-31', [m('3', 1, 1)])],
    }))
    expect(s.map((x) => [x.parca, x.kisiId, x.parcaBaslangic, x.parcaBitis, x.payTutari.toFixed(2)])).toEqual([
      [0, '7', '2026-03-01', '2026-03-10', '1000.00'],
      [1, '3', '2026-03-11', '2026-03-31', '2100.00'],
    ])
    expect(s[0]!.satirlar.some((h) => h.aciklama.startsWith('Parça payı'))).toBe(true)
  })

  it('iki parça (10 + 21 gün), 1.000,00 → 322,58 / 677,42 (artık büyük kalanlı parçaya)', () => {
    const s = sonuc(taksitDagilimi({
      tutar: para('1000.00'), bedelTuru: 'BRUT',
      parcalar: [parca('2026-03-01', '2026-03-10', [m('1', 1, 1)]), parca('2026-03-11', '2026-03-31', [m('1', 1, 1)])],
    }))
    expect(f(s, 'payTutari')).toEqual(['322.58', '677.42'])
  })

  it('tek parçada "Parça payı" satırı yok, "Hisse payı" satırı var', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('100.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 2), m('2', 1, 2)]) }))
    expect(s[0]!.satirlar.some((h) => h.aciklama.startsWith('Parça payı'))).toBe(false)
    expect(s[0]!.satirlar.some((h) => h.aciklama.startsWith('Hisse payı'))).toBe(true)
  })

  it('boş parça listesi, çakışan parçalar, ters parça, negatif tutar ve 3 ondalıklı tutar GECERSIZ_GIRDI', () => {
    const kod = (x: ReturnType<typeof taksitDagilimi>) => (x.ok ? 'OK' : x.hata.kod)
    expect(kod(taksitDagilimi({ tutar: para('1.00'), bedelTuru: 'BRUT', parcalar: [] }))).toBe('GECERSIZ_GIRDI')
    expect(kod(taksitDagilimi({
      tutar: para('1.00'), bedelTuru: 'BRUT',
      parcalar: [parca('2026-03-01', '2026-03-10', [m('1', 1, 1)]), parca('2026-03-10', '2026-03-31', [m('1', 1, 1)])],
    }))).toBe('GECERSIZ_GIRDI')
    expect(kod(taksitDagilimi({
      tutar: para('1.00'), bedelTuru: 'BRUT',
      parcalar: [parca('2026-03-11', '2026-03-31', [m('1', 1, 1)]), parca('2026-03-01', '2026-03-10', [m('1', 1, 1)])],
    }))).toBe('GECERSIZ_GIRDI')
    expect(kod(taksitDagilimi({ tutar: para('1.00'), bedelTuru: 'BRUT', parcalar: [parca('2026-03-10', '2026-03-01', [m('1', 1, 1)])] }))).toBe('GECERSIZ_GIRDI')
    expect(kod(taksitDagilimi({ tutar: para('-1.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 1)]) }))).toBe('GECERSIZ_GIRDI')
    expect(kod(taksitDagilimi({ tutar: para('1.005'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 1)]) }))).toBe('GECERSIZ_GIRDI')
  })

  it('sıfır tutar geçerlidir; tüm tutarlar 0', () => {
    const s = sonuc(taksitDagilimi({ tutar: para('0.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 1)]) }))
    expect(f(s, 'odenecek')).toEqual(['0.00'])
  })

  it('hisse toplamı 1 değilse HISSE_TOPLAMI_HATALI', () => {
    const x = taksitDagilimi({ tutar: para('100.00'), bedelTuru: 'BRUT', parcalar: subat([m('1', 1, 2)]) })
    expect(x.ok ? 'OK' : x.hata.kod).toBe('HISSE_TOPLAMI_HATALI')
  })
})

describe('taksitDagilimi — özellikler', () => {
  const PAYDALAR = [1, 2, 3, 4, 6, 12, 24]
  const malikSeti = fc.integer({ min: 1, max: 6 }).chain((n) =>
    fc.constantFrom(...PAYDALAR).chain((q) => fc.tuple(fc.constant(n), fc.constant(q), fc.array(fc.integer({ min: 1, max: 24 }), { minLength: n, maxLength: n }))),
  ).map(([n, q, agirliklar]) => {
    // Ortak payda q·Σağırlık; her malikin payı ağırlığıdır: toplam tam 1.
    const toplam = agirliklar.reduce((a, b) => a + b, 0)
    return Array.from({ length: n }, (_, i) => ({ kisiId: String(i + 1), pay: agirliklar[i]! * q, payda: toplam * q }))
  })
  const girdi = fc.record({
    kurus: fc.integer({ min: 0, max: 10_000_000 }),
    bedelTuru: fc.constantFrom('BRUT' as const, 'NET' as const),
    stopaj: fc.constantFrom('0', '20'),
    kdv: fc.constantFrom('0', '20'),
    gunler: fc.array(fc.integer({ min: 1, max: 31 }), { minLength: 1, maxLength: 3 }),
    malikler: malikSeti,
  })
  type Girdi = { kurus: number; bedelTuru: 'BRUT' | 'NET'; stopaj: string; kdv: string; gunler: number[]; malikler: { kisiId: string; pay: number; payda: number }[] }
  const kur = (g: Girdi) => {
    let bas = t('2026-01-01')
    const parcalar: DagilimParcasi[] = g.gunler.map((gun) => {
      const p = { baslangic: bas, bitis: gunEkle(bas, gun - 1), malikler: g.malikler.map((x) => m(x.kisiId, x.pay, x.payda, g.stopaj, g.kdv)) }
      bas = gunEkle(bas, gun)
      return p
    })
    const tutar = para(g.kurus.toString()).dividedBy(100)
    return { tutar, sonuc: taksitDagilimi({ tutar, bedelTuru: g.bedelTuru, parcalar }) }
  }

  it('özellik: Σ payTutari = tutar; BRUT ise Σ brut = tutar; NET ise Σ (brut − stopaj) = tutar', () => {
    fc.assert(fc.property(girdi, (g) => {
      const { tutar, sonuc: x } = kur(g)
      if (!x.ok) return false
      const s = x.deger
      if (!topla(s.map((y) => y.payTutari)).equals(tutar)) return false
      return g.bedelTuru === 'BRUT'
        ? topla(s.map((y) => y.brut)).equals(tutar)
        : topla(s.map((y) => y.brut.minus(y.stopaj))).equals(tutar)
    }), { numRuns: 300 })
  })

  it('özellik: her satırda odenecek = brut + kdv − stopaj ve odenecek ≥ 0; aynı girdi aynı çıktı', () => {
    fc.assert(fc.property(girdi, (g) => {
      const a = kur(g).sonuc
      const b = kur(g).sonuc
      if (!a.ok || !b.ok) return false
      const esit = JSON.stringify(a.deger) === JSON.stringify(b.deger)
      return esit && a.deger.every((y) => y.odenecek.equals(y.brut.plus(y.kdv).minus(y.stopaj)) && !y.odenecek.isNegative())
    }), { numRuns: 300 })
  })
})
