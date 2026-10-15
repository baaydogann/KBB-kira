import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { D, para, type Para } from '@/core/para'
import { ayAnahtari, tarih as t, type Ay } from '@/core/tarih'
import { artisHesapla, type ArtisGirdi, type OnayliOranlar, type OranSerisi } from '@/core/hesap/artis'

// Araştırmadaki yayımlanmış TÜFE12 değerleri (docs/arastirma/02 §6)
const TUFE12: Record<string, string> = {
  '2026-01': '33.98', '2026-02': '33.39', '2026-03': '32.82', '2026-08': '31.79', '2026-09': '31.49',
}

function oranlar(ek: Partial<Record<OranSerisi, Record<string, string>>> = {}): OnayliOranlar {
  const tablo: Record<OranSerisi, Record<string, string>> = {
    TUFE_12AY_ORT: TUFE12, TUFE_YILLIK: {}, YIUFE_12AY_ORT: {}, YIUFE_YILLIK: {}, ...ek,
  }
  return { oran: (seri: OranSerisi, ay: Ay) => { const v = tablo[seri][ayAnahtari(ay)]; return v ? para(v) : null } }
}

function girdi(ek: Partial<ArtisGirdi>): ArtisGirdi {
  return {
    donemBaslangic: t('2026-03-01'), ilkKiraBaslangici: t('2025-03-01'), oncekiBedel: para('100000'),
    kural: 'TUFE12', degisimTuru: 'ON_IKI_AY_ORT', sabitOran: null, elleOran: null,
    tasinmazTuru: 'ISYERI', konutSiniri: null, oranlar: oranlar(), ...ek,
  }
}

function hesaplandi(g: ArtisGirdi) {
  const s = artisHesapla(g)
  if (!s.ok) throw new Error(s.hata.mesaj)
  if (s.deger.durum !== 'HESAPLANDI') throw new Error(`beklenmeyen durum ${s.deger.durum}`)
  return s.deger
}

describe('K2 altın örnekler', () => {
  it('spec örneği: 100.000 TL, Mart 2026 dönemi, Şubat TÜFE12 %33,39 → 133.390,00', () => {
    const r = hesaplandi(girdi({}))
    expect(r.referansAy).toEqual({ yil: 2026, ay: 2 })
    expect(r.uygulananOran.toString()).toBe('33.39')
    expect(r.yeniBedel.toFixed(2)).toBe('133390.00')
  })
  it('7.500 TL, Ekim 2026, Eylül %31,49 → 9.861,75', () => {
    const r = hesaplandi(girdi({ donemBaslangic: t('2026-10-01'), ilkKiraBaslangici: t('2024-10-01'), oncekiBedel: para('7500') }))
    expect(r.yeniBedel.toFixed(2)).toBe('9861.75')
  })
  it('sonuç kuruşa AŞAĞI yuvarlanır: 8.333,33 × 1,3282 = 11.068,3289 → 11.068,32', () => {
    const r = hesaplandi(girdi({ donemBaslangic: t('2026-04-01'), ilkKiraBaslangici: t('2025-04-01'), oncekiBedel: para('8333.33') }))
    expect(r.yeniBedel.toFixed(2)).toBe('11068.32')
  })
})

describe('K2 kurallar', () => {
  it('ilk kira yılı dolmadan oran 0', () => {
    const r = hesaplandi(girdi({ donemBaslangic: t('2026-02-01'), ilkKiraBaslangici: t('2025-06-01') }))
    expect(r.uygulananOran.isZero()).toBe(true)
    expect(r.yeniBedel.toFixed(2)).toBe('100000.00')
  })
  it('YOK kuralında oran 0 ve endeks istenmez', () => {
    const r = hesaplandi(girdi({ kural: 'YOK', oranlar: oranlar({ TUFE_12AY_ORT: {} }) }))
    expect(r.uygulananOran.isZero()).toBe(true)
  })
  it('SABIT oran tavanı aşarsa tavan uygulanır', () => {
    const r = hesaplandi(girdi({ donemBaslangic: t('2026-10-01'), ilkKiraBaslangici: t('2024-10-01'), kural: 'SABIT', sabitOran: para('50') }))
    expect(r.sozlesmeOrani.toString()).toBe('50')
    expect(r.tavan?.toString()).toBe('31.49')
    expect(r.uygulananOran.toString()).toBe('31.49')
  })
  it('SABIT oran tavanın altındaysa aynen uygulanır', () => {
    const r = hesaplandi(girdi({ kural: 'SABIT', sabitOran: para('10') }))
    expect(r.uygulananOran.toString()).toBe('10')
  })
  it('SABIT kuralında oran yoksa hata', () => {
    const s = artisHesapla(girdi({ kural: 'SABIT', sabitOran: null }))
    expect(!s.ok && s.hata.kod).toBe('GECERSIZ_GIRDI')
  })
  it('(TÜFE + Yİ-ÜFE)/2 dört ondalığa yuvarlanır', () => {
    const r = hesaplandi(girdi({
      donemBaslangic: t('2026-10-01'), ilkKiraBaslangici: t('2024-10-01'), kural: 'TUFE_YIUFE_ORT',
      oranlar: oranlar({ YIUFE_12AY_ORT: { '2026-09': '27.13' } }),
    }))
    expect(r.sozlesmeOrani.toString()).toBe('29.31')
    expect(r.uygulananOran.toString()).toBe('29.31')
  })
  it('YILLIK değişim türü yıllık seriyi kullanır', () => {
    const r = hesaplandi(girdi({
      donemBaslangic: t('2026-10-01'), ilkKiraBaslangici: t('2024-10-01'), degisimTuru: 'YILLIK',
      oranlar: oranlar({ TUFE_YILLIK: { '2026-09': '29.73' } }),
    }))
    expect(r.sozlesmeOrani.toString()).toBe('29.73')
  })
  it('negatif Yİ-ÜFE oranında kira değişmez', () => {
    const r = hesaplandi(girdi({
      donemBaslangic: t('2026-10-01'), ilkKiraBaslangici: t('2024-10-01'), kural: 'YIUFE', degisimTuru: 'YILLIK',
      oranlar: oranlar({ YIUFE_YILLIK: { '2026-09': '-2.5' } }),
    }))
    expect(r.uygulananOran.isZero()).toBe(true)
    expect(r.yeniBedel.toFixed(2)).toBe('100000.00')
  })
  it('endeks yoksa BEKLEMEDE ve eksik seri listesi tekil', () => {
    const s = artisHesapla(girdi({ donemBaslangic: t('2026-11-01'), ilkKiraBaslangici: t('2025-11-01') }))
    expect(s.ok && s.deger.durum).toBe('BEKLEMEDE')
    if (s.ok && s.deger.durum === 'BEKLEMEDE') {
      expect(s.deger.neden).toBe('ENDEKS_YOK')
      expect(s.deger.eksikSeriler).toEqual(['TUFE_12AY_ORT'])
      expect(s.deger.referansAy).toEqual({ yil: 2026, ay: 10 })
    }
  })
  it('ELLE kuralında oran girilmemişse BEKLEMEDE/ELLE_ORAN_YOK, girilmişse tavana tabi', () => {
    const a = artisHesapla(girdi({ kural: 'ELLE', elleOran: null }))
    expect(a.ok && a.deger.durum === 'BEKLEMEDE' && a.deger.neden).toBe('ELLE_ORAN_YOK')
    const b = hesaplandi(girdi({ kural: 'ELLE', elleOran: para('40') }))
    expect(b.uygulananOran.toString()).toBe('33.39')
  })
  it('konutta 2022-06-11 – 2024-07-01 arası %25 sınırı', () => {
    const r = hesaplandi(girdi({
      donemBaslangic: t('2023-07-01'), ilkKiraBaslangici: t('2022-07-01'), tasinmazTuru: 'KONUT', konutSiniri: para('25'),
      oranlar: oranlar({ TUFE_12AY_ORT: { '2023-06': '50.00' } }),
    }))
    expect(r.tavan?.toString()).toBe('25')
    expect(r.uygulananOran.toString()).toBe('25')
  })
  it('01.07.2020 öncesi kamu işyeri döneminde tavan yok ve TÜFE istenmez', () => {
    const r = hesaplandi(girdi({
      donemBaslangic: t('2019-05-01'), ilkKiraBaslangici: t('2018-05-01'), kural: 'SABIT', sabitOran: para('30'),
      oranlar: oranlar({ TUFE_12AY_ORT: {} }),
    }))
    expect(r.tavan).toBeNull()
    expect(r.uygulananOran.toString()).toBe('30')
  })
  it('hesap izi referans ayı ve uygulanan oranı içerir', () => {
    const r = hesaplandi(girdi({}))
    const metin = r.satirlar.map((s) => `${s.aciklama} ${s.sonuc}`).join('\n')
    expect(metin).toContain('Şubat 2026')
    expect(metin).toContain('133390.00')
  })
  it('özellik: yeni bedel önceki bedelden küçük değil ve tavanı aşmaz', () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1n, max: 10n ** 11n }),
      fc.integer({ min: -5000, max: 20000 }),
      fc.integer({ min: 0, max: 10000 }),
      (kurus, sozBaz, tavanBaz) => {
        const onceki: Para = new D(kurus.toString()).dividedBy(100)
        const tavan = new D(tavanBaz).dividedBy(100)
        const r = hesaplandi(girdi({
          kural: 'SABIT', sabitOran: new D(sozBaz).dividedBy(100), oncekiBedel: onceki,
          oranlar: oranlar({ TUFE_12AY_ORT: { '2026-02': tavan.toString() } }),
        }))
        expect(r.yeniBedel.greaterThanOrEqualTo(onceki)).toBe(true)
        expect(r.yeniBedel.lessThanOrEqualTo(onceki.times(tavan.dividedBy(100).plus(1)))).toBe(true)
        expect(r.yeniBedel.decimalPlaces()).toBeLessThanOrEqual(2)
      },
    ))
  })
})
