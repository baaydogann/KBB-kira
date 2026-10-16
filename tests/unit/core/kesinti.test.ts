import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  kesintiHesabi, type DamgaKalani, type GecerliSorgu, type HacizKalani, type KesintiGirdisi, type KesintiSatiri,
} from '@/core/hesap/kesinti'
import { para, topla, type Para } from '@/core/para'
import { tarih as t } from '@/core/tarih'

const ESIK = { esik22aOdeme: para('5000'), esik22aBorc: para('5000') }
const satir = (anahtar: string, odenecek: string, ek: Partial<KesintiSatiri> = {}): KesintiSatiri => ({
  anahtar, sozlesmeId: '10', kisiId: '1', vade: t('2026-02-01'), odenecek: para(odenecek), ...ek,
})
const damga = (kalan: string, ek: Partial<DamgaKalani> = {}): DamgaKalani => ({
  damgaPayiId: '100', sozlesmeId: '10', kisiId: '1', olayTarihi: t('2025-12-20'), kalan: para(kalan), ...ek,
})
const haciz = (hacizId: string, kalan: string, teblig: string, ek: Partial<HacizKalani> = {}): HacizKalani => ({
  hacizId, kisiId: '1', tebligTarihi: t(teblig), kalan: para(kalan), ...ek,
})
const sorgu = (borc: string, kalan = borc, ek: Partial<GecerliSorgu> = {}): GecerliSorgu => ({
  borcSorguId: '50', kisiId: '1', borcVar: para(borc).greaterThan(0), borcTutari: para(borc), kalanBorc: para(kalan), ...ek,
})
const girdi = (ek: Partial<KesintiGirdisi>): KesintiGirdisi => ({ satirlar: [], damgalar: [], hacizler: [], sorgular: [], ...ESIK, ...ek })
const f = (p: Para) => p.toFixed(2)

describe('kesintiHesabi — damga', () => {
  it('damga: ödenecek 8.000,00, kalan 226,80 → damga 226,80, net 7.773,20', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], damgalar: [damga('226.80')], sorgular: [sorgu('0')] }))
    expect(k.satirlar.map((s) => [s.anahtar, f(s.damga), f(s.haciz), f(s.kesinti22a), f(s.net)])).toEqual([['a', '226.80', '0.00', '0.00', '7773.20']])
    expect(k.kesintiler.map((x) => [x.satirAnahtari, x.tur, f(x.tutar), x.kaynakId])).toEqual([['a', 'DAMGA', '226.80', '100']])
    expect(k.satirlar[0]!.satirlar.map((h) => h.aciklama)).toContain('Damga kesintisi (istihkaktan)')
  })
  it('damga devri: ödenecek 100,00, kalan 226,80 → damga 100,00, net 0,00', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '100.00')], damgalar: [damga('226.80')] }))
    expect([f(k.satirlar[0]!.damga), f(k.satirlar[0]!.net)]).toEqual(['100.00', '0.00'])
  })
  it('damga devri iki satırda: 100,00 + 8.000,00 → 100,00 ve 126,80', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('b', '8000.00', { vade: t('2026-03-01') }), satir('a', '100.00')], damgalar: [damga('226.80')],
    }))
    expect(k.satirlar.map((s) => [s.anahtar, f(s.damga)])).toEqual([['a', '100.00'], ['b', '126.80']])
  })
  it('damga yalnız aynı sözleşmenin ve aynı kişinin satırından kesilir', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '1000.00', { sozlesmeId: '11' }), satir('b', '1000.00', { kisiId: '2' }), satir('c', '1000.00')],
      damgalar: [damga('226.80')],
    }))
    expect(k.satirlar.map((s) => [s.anahtar, f(s.damga)])).toEqual([['a', '0.00'], ['b', '0.00'], ['c', '226.80']])
  })
  it('iki damga payı olay tarihi sırasıyla kesilir', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '100.00')],
      damgalar: [damga('80.00', { damgaPayiId: '2', olayTarihi: t('2026-01-10') }), damga('50.00', { damgaPayiId: '9', olayTarihi: t('2025-12-01') })],
    }))
    expect(k.kesintiler.map((x) => [x.kaynakId, f(x.tutar)])).toEqual([['9', '50.00'], ['2', '50.00']])
  })
})

describe('kesintiHesabi — haciz', () => {
  it('haciz tebliğ sırası: kalanlar 3.000 ve 10.000, ödenecek 8.000 → 3.000 + 5.000, net 0', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '8000.00')],
      hacizler: [haciz('7', '10000.00', '2026-02-01'), haciz('8', '3000.00', '2026-01-10')],
    }))
    expect(k.kesintiler.map((x) => [x.tur, x.kaynakId, f(x.tutar)])).toEqual([['HACIZ', '8', '3000.00'], ['HACIZ', '7', '5000.00']])
    expect([f(k.satirlar[0]!.haciz), f(k.satirlar[0]!.net)]).toEqual(['8000.00', '0.00'])
    expect(k.satirlar[0]!.satirlar.map((h) => h.aciklama)).toContain('Haciz kesintisi')
  })
  it('haciz damgadan sonraki tutardan kesilir ve başka kişiye uygulanmaz', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '1000.00'), satir('b', '1000.00', { kisiId: '2' })],
      damgalar: [damga('226.80')], hacizler: [haciz('7', '5000.00', '2026-01-10')],
    }))
    expect(k.satirlar.map((s) => [s.anahtar, f(s.damga), f(s.haciz), f(s.net)])).toEqual([['a', '226.80', '773.20', '0.00'], ['b', '0.00', '0.00', '1000.00']])
  })
})

describe('kesintiHesabi — 22/A', () => {
  it('22/A eşiği: kişi toplamı 5.000,00 → sorgu gerekmez; 5.000,01 → gerekir', () => {
    expect(kesintiHesabi(girdi({ satirlar: [satir('a', '5000.00')] })).alicilar)
      .toEqual([{ kisiId: '1', odenecek: para('5000.00'), sorguGerekli: false, borcSorguId: null, kesinti: para('0') }])
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '5000.01')] }))
    expect([k.alicilar[0]!.sorguGerekli, k.alicilar[0]!.borcSorguId, f(k.alicilar[0]!.odenecek)]).toEqual([true, null, '5000.01'])
  })
  it('22/A: ödenecek 8.000, borç 6.000 → kesinti 6.000, net 2.000', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('6000.00')] }))
    expect([f(k.satirlar[0]!.kesinti22a), f(k.satirlar[0]!.net)]).toEqual(['6000.00', '2000.00'])
    expect(k.kesintiler.map((x) => [x.tur, x.kaynakId, f(x.tutar)])).toEqual([['KESINTI_22A', '50', '6000.00']])
    expect(k.alicilar.map((a) => [a.sorguGerekli, a.borcSorguId, f(a.kesinti)])).toEqual([[true, '50', '6000.00']])
    expect(k.satirlar[0]!.satirlar.map((h) => h.aciklama)).toContain('6183 md. 22/A kesintisi')
  })
  it('22/A borç eşiği: borç 5.000,00 → kesinti yok', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('5000.00')] }))
    expect([f(k.satirlar[0]!.kesinti22a), k.alicilar[0]!.borcSorguId]).toEqual(['0.00', '50'])
    expect(k.kesintiler).toEqual([])
  })
  it('22/A borç 5.000,01 → kesinti 5.000,01', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('5000.01')] }))
    expect(f(k.satirlar[0]!.kesinti22a)).toBe('5000.01')
  })
  it('22/A kalan borç: borç 8.000, kalan 3.000 → kesinti 3.000', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('8000.00', '3000.00')] }))
    expect(f(k.satirlar[0]!.kesinti22a)).toBe('3000.00')
  })
  it('22/A borç ödenecekten büyükse kesinti ödenecek kadar: borç 9.000 → 8.000, net 0', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('9000.00')] }))
    expect([f(k.satirlar[0]!.kesinti22a), f(k.satirlar[0]!.net)]).toEqual(['8000.00', '0.00'])
  })
  it('22/A iki satır (vade 10-01 ve 11-01, 4.000 + 4.000), borç 6.000 → 4.000 ve 2.000', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('z', '4000.00', { vade: t('2026-11-01') }), satir('y', '4000.00', { vade: t('2026-10-01') })],
      sorgular: [sorgu('6000.00')],
    }))
    expect(k.satirlar.map((s) => [s.anahtar, f(s.kesinti22a)])).toEqual([['y', '4000.00'], ['z', '2000.00']])
  })
  it('22/A sorgu yok → sorguGerekli true, borcSorguId null, kesinti yok', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')] }))
    expect([k.alicilar[0]!.sorguGerekli, k.alicilar[0]!.borcSorguId, f(k.alicilar[0]!.kesinti)]).toEqual([true, null, '0.00'])
  })
  it('22/A eşik altı: sorgu ve borç olsa da kesinti yok', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '4000.00')], sorgular: [sorgu('6000.00')] }))
    expect([k.alicilar[0]!.sorguGerekli, f(k.satirlar[0]!.kesinti22a)]).toEqual([false, '0.00'])
  })
  it('22/A borç yok sorgusu: kesinti yok, borcSorguId dolu', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '8000.00')], sorgular: [sorgu('0')] }))
    expect([k.alicilar[0]!.sorguGerekli, k.alicilar[0]!.borcSorguId, f(k.satirlar[0]!.kesinti22a)]).toEqual([true, '50', '0.00'])
  })
  it('22/A eşiği damga ve hacizden sonra: ödenecek 6.000, haciz 1.500 → 4.500 → gerekmez', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '6000.00')], hacizler: [haciz('7', '1500.00', '2026-01-10')], sorgular: [sorgu('6000.00')] }))
    expect([f(k.alicilar[0]!.odenecek), k.alicilar[0]!.sorguGerekli, f(k.satirlar[0]!.kesinti22a)]).toEqual(['4500.00', false, '0.00'])
  })
  it('22/A toplamı kişi bazındadır: kişi 1 8.000 (gerekli), kişi 2 3.000 (gerekmez); kişi 2 nin borcu kesilmez', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '8000.00'), satir('b', '3000.00', { kisiId: '2' })],
      sorgular: [sorgu('0'), sorgu('6000.00', '6000.00', { borcSorguId: '51', kisiId: '2' })],
    }))
    expect(k.alicilar.map((a) => [a.kisiId, f(a.odenecek), a.sorguGerekli, a.borcSorguId, f(a.kesinti)]))
      .toEqual([['1', '8000.00', true, '50', '0.00'], ['2', '3000.00', false, '51', '0.00']])
  })
  it('hesap izi: damga, haciz, 22/A ve net satırlarının formülleri', () => {
    const k = kesintiHesabi(girdi({
      satirlar: [satir('a', '8000.00')], damgalar: [damga('226.80')], hacizler: [haciz('7', '1000.00', '2026-01-10')], sorgular: [sorgu('6000.00')],
    }))
    expect(k.satirlar[0]!.satirlar).toEqual([
      { kural: 'K4', aciklama: 'Damga kesintisi (istihkaktan)', formul: 'min(damga kalanı 226.80, 8000.00)', sonuc: '226.80' },
      { kural: 'K4', aciklama: 'Haciz kesintisi', formul: 'min(haciz kalanı 1000.00, 7773.20)', sonuc: '1000.00' },
      { kural: 'K4', aciklama: '6183 md. 22/A kesintisi', formul: 'min(borç kalanı 6000.00, alıcının ödeneceği 6773.20) → bu satırdan en çok 6773.20', sonuc: '6000.00' },
      { kural: 'K4', aciklama: 'Net ödenecek (kesintiler sonrası)', formul: '8000.00 − 226.80 − 1000.00 − 6000.00', sonuc: '773.20' },
    ])
  })
  it('alıcılar kişi kimliğine göre sayısal sıralı; satırdaki her kişi listelenir', () => {
    const k = kesintiHesabi(girdi({ satirlar: [satir('a', '1.00', { kisiId: '10' }), satir('b', '1.00', { kisiId: '9' })] }))
    expect(k.alicilar.map((a) => a.kisiId)).toEqual(['9', '10'])
  })
})

describe('kesintiHesabi — özellikler', () => {
  const tutar = fc.integer({ min: 0, max: 2_000_000 }).map((k) => para(k.toString()).dividedBy(100))
  const arb = fc.record({
    satirlar: fc.array(fc.record({ kisi: fc.constantFrom('1', '2'), soz: fc.constantFrom('10', '11'), gun: fc.integer({ min: 1, max: 28 }), odenecek: tutar }), { minLength: 1, maxLength: 6 }),
    damgalar: fc.array(fc.record({ kisi: fc.constantFrom('1', '2'), soz: fc.constantFrom('10', '11'), kalan: tutar }), { maxLength: 3 }),
    hacizler: fc.array(fc.record({ kisi: fc.constantFrom('1', '2'), gun: fc.integer({ min: 1, max: 28 }), kalan: tutar }), { maxLength: 3 }),
    sorgular: fc.array(fc.record({ kisi: fc.constantFrom('1', '2'), borc: tutar, kullanilan: tutar }), { maxLength: 2 }),
  })
  type Uretilen = {
    satirlar: { kisi: string; soz: string; gun: number; odenecek: Para }[]
    damgalar: { kisi: string; soz: string; kalan: Para }[]
    hacizler: { kisi: string; gun: number; kalan: Para }[]
    sorgular: { kisi: string; borc: Para; kullanilan: Para }[]
  }
  const kur = (a: Uretilen): KesintiGirdisi => {
    const sorgular = new Map<string, GecerliSorgu>()
    for (const [i, s] of a.sorgular.entries()) {
      const kalan = s.borc.minus(s.kullanilan)
      sorgular.set(s.kisi, { borcSorguId: String(i + 1), kisiId: s.kisi, borcVar: s.borc.greaterThan(0), borcTutari: s.borc, kalanBorc: kalan.isNegative() ? para('0') : kalan })
    }
    return girdi({
      satirlar: a.satirlar.map((s, i) => satir(`s${i}`, s.odenecek.toFixed(2), { kisiId: s.kisi, sozlesmeId: s.soz, vade: t(`2026-02-${String(s.gun).padStart(2, '0')}`) })),
      damgalar: a.damgalar.map((d, i) => damga(d.kalan.toFixed(2), { damgaPayiId: String(i + 1), kisiId: d.kisi, sozlesmeId: d.soz })),
      hacizler: a.hacizler.map((h, i) => haciz(String(i + 1), h.kalan.toFixed(2), `2026-01-${String(h.gun).padStart(2, '0')}`, { kisiId: h.kisi })),
      sorgular: [...sorgular.values()],
    })
  }

  it('özellik: satır başına damga + haciz + 22A ≤ odenecek, net = odenecek − kesintiler ≥ 0', () => {
    fc.assert(fc.property(arb, (a) => {
      const g = kur(a)
      const k = kesintiHesabi(g)
      return k.satirlar.every((s) => {
        const o = g.satirlar.find((x) => x.anahtar === s.anahtar)!.odenecek
        return s.net.equals(o.minus(s.damga).minus(s.haciz).minus(s.kesinti22a)) && !s.net.isNegative()
      })
    }), { numRuns: 300 })
  })

  it('özellik: damga payı ve haciz başına Σ kesinti ≤ kalan; kişi başına 22A ≤ min(kalanBorc, odenecek22)', () => {
    fc.assert(fc.property(arb, (a) => {
      const g = kur(a)
      const k = kesintiHesabi(g)
      const toplamKaynak = (tur: string, id: string) => topla(k.kesintiler.filter((x) => x.tur === tur && x.kaynakId === id).map((x) => x.tutar))
      const damgaOk = g.damgalar.every((d) => toplamKaynak('DAMGA', d.damgaPayiId).lessThanOrEqualTo(d.kalan))
      const hacizOk = g.hacizler.every((h) => toplamKaynak('HACIZ', h.hacizId).lessThanOrEqualTo(h.kalan))
      const sorguOk = k.alicilar.every((al) => {
        const s = g.sorgular.find((x) => x.kisiId === al.kisiId)
        return s === undefined ? al.kesinti.isZero() : al.kesinti.lessThanOrEqualTo(s.kalanBorc) && al.kesinti.lessThanOrEqualTo(al.odenecek)
      })
      return damgaOk && hacizOk && sorguOk && k.kesintiler.every((x) => x.tutar.greaterThan(0))
    }), { numRuns: 300 })
  })

  it('özellik: girdi sırası karıştırılınca sonuç aynı', () => {
    fc.assert(fc.property(arb, fc.integer({ min: 1, max: 1000 }), (a, tohum) => {
      const g = kur(a)
      const karistir = <T>(xs: readonly T[]): T[] => [...xs].sort((x, y) => ((JSON.stringify(x).length * tohum) % 7) - ((JSON.stringify(y).length * tohum) % 7)).reverse()
      const k1 = kesintiHesabi(g)
      const k2 = kesintiHesabi({ ...g, satirlar: karistir(g.satirlar), damgalar: karistir(g.damgalar), hacizler: karistir(g.hacizler), sorgular: karistir(g.sorgular) })
      return JSON.stringify(k1) === JSON.stringify(k2)
    }), { numRuns: 200 })
  })
})
