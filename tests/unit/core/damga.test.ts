import { describe, expect, it } from 'vitest'
import { damgaPaylari, damgaTutari, ilkDamgaMatrahi, type IlkDamgaMatrahiGirdisi } from '@/core/hesap/damga'
import { para } from '@/core/para'
import { tarih as t } from '@/core/tarih'

const BINDE = para('1.89')
const AZAMI_2026 = para('29115961.10')

function ilk(ek: Partial<IlkDamgaMatrahiGirdisi> = {}): IlkDamgaMatrahiGirdisi {
  return {
    baslangic: t('2026-01-01'), bitis: t('2026-12-31'), suresizAy: 12, periyotAy: 1, kist: 'GERCEK_GUN',
    bedel: para('10000.00'), taban: 'AYLIK', bedelTuru: 'BRUT', malikler: [{ kisiId: '1', pay: 1, payda: 1, stopajOrani: para('20') }], ...ek,
  }
}
function matrah(g: IlkDamgaMatrahiGirdisi): string {
  const s = ilkDamgaMatrahi(g)
  if (!s.ok) throw new Error(s.hata.kod)
  return s.deger.matrah.toFixed(2)
}

describe('damgaTutari (K5)', () => {
  it('120.000,00 × binde 1,89 = 226,80', () => {
    const d = damgaTutari({ matrah: para('120000.00'), oranBinde: BINDE, azami: AZAMI_2026 })
    expect([d.tutar.toFixed(2), d.azamiUygulandi]).toEqual(['226.80', false])
    expect(d.satirlar.map((s) => [s.kural, s.formul, s.sonuc])).toEqual([['K5', '120000.00 × 1.89‰', '226.80']])
  })
  it('2.645,50 × binde 1,89 = 4,999995 → 5,00 (yarım yukarı; aşağı yuvarlama 4,99 verirdi)', () => {
    expect(damgaTutari({ matrah: para('2645.50'), oranBinde: BINDE, azami: AZAMI_2026 }).tutar.toFixed(2)).toBe('5.00')
  })
  it('azami: 20.000.000.000,00 matrah → 29.115.961,10, azamiUygulandi true', () => {
    const d = damgaTutari({ matrah: para('20000000000.00'), oranBinde: BINDE, azami: AZAMI_2026 })
    expect([d.tutar.toFixed(2), d.azamiUygulandi]).toEqual(['29115961.10', true])
    expect(d.satirlar.some((s) => s.aciklama.includes('Azami'))).toBe(true)
  })
  it('tutar azamiye tam eşitse azamiUygulandi false', () => {
    // 1.000.000,00 × binde 1,89 = 1.890,00 = azami
    const d = damgaTutari({ matrah: para('1000000.00'), oranBinde: BINDE, azami: para('1890.00') })
    expect([d.tutar.toFixed(2), d.azamiUygulandi]).toEqual(['1890.00', false])
  })
})

describe('ilkDamgaMatrahi', () => {
  it('ILK aylık 10.000 brüt, 2026-01-01–2026-12-31, aylık → matrah 120.000,00, 12 dönem', () => {
    const s = ilkDamgaMatrahi(ilk())
    expect(s.ok && [s.deger.matrah.toFixed(2), s.deger.donemSayisi]).toEqual(['120000.00', 12])
    expect(s.ok && s.deger.satirlar).toEqual([{
      kural: 'K5', aciklama: 'Matrah: ilk bedelle toplam brüt kira (KDV hariç)', formul: '01.01.2026 – 31.12.2026, 12 dönem', sonuc: '120000.00',
    }])
  })
  it('hesap izi: süresizde süre metni, NET te brütleştirme notu', () => {
    const s = ilkDamgaMatrahi(ilk({ bitis: null }))
    expect(s.ok && s.deger.satirlar[0]!.formul).toBe('süresiz: 12 ay (01.01.2026 – 31.12.2026), 12 dönem')
    const n = ilkDamgaMatrahi(ilk({ bedelTuru: 'NET', bedel: para('8000.00') }))
    expect(n.ok && n.deger.satirlar[0]!.aciklama).toBe('Matrah: ilk bedelle toplam brüt kira (net bedel brütleştirildi, KDV hariç)')
  })
  it('ILK kıst: 2026-01-15–2026-12-31 aylık 10.000 → 115.483,87 (11 tam ay + 17/31)', () => {
    expect(matrah(ilk({ baslangic: t('2026-01-15') }))).toBe('115483.87')
  })
  it('ILK süresiz (bitis null, 12 ay) → 120.000,00', () => {
    expect(matrah(ilk({ bitis: null }))).toBe('120000.00')
  })
  it('ILK süresiz 6 ay ayarıyla → 60.000,00', () => {
    expect(matrah(ilk({ bitis: null, suresizAy: 6 }))).toBe('60000.00')
  })
  it('ILK yıllık 120.000, üç aylık ödeme → 120.000,00', () => {
    expect(matrah(ilk({ bedel: para('120000.00'), taban: 'YILLIK', periyotAy: 3 }))).toBe('120000.00')
  })
  it('ILK NET aylık 8.000, tek malik %20 → matrah 120.000,00 (brüt); stopajsız malikte 96.000,00', () => {
    expect(matrah(ilk({ bedel: para('8000.00'), bedelTuru: 'NET' }))).toBe('120000.00')
    expect(matrah(ilk({ bedel: para('8000.00'), bedelTuru: 'NET', malikler: [{ kisiId: '1', pay: 1, payda: 1, stopajOrani: para('0') }] }))).toBe('96000.00')
  })
  it('ILK NET iki malik (biri stopajsız): 8.000 net → 5.000 + 4.000 brüt/ay → 108.000,00', () => {
    // 4.000 net %20 → 5.000 brüt; 4.000 net %0 → 4.000 brüt
    expect(matrah(ilk({
      bedel: para('8000.00'), bedelTuru: 'NET',
      malikler: [{ kisiId: '1', pay: 1, payda: 2, stopajOrani: para('20') }, { kisiId: '2', pay: 1, payda: 2, stopajOrani: para('0') }],
    }))).toBe('108000.00')
  })
  it('NET sözleşmede hisse toplamı 1 değilse hata', () => {
    const s = ilkDamgaMatrahi(ilk({ bedelTuru: 'NET', malikler: [{ kisiId: '1', pay: 1, payda: 2, stopajOrani: para('20') }] }))
    expect(s.ok ? 'OK' : s.hata.kod).toBe('HISSE_TOPLAMI_HATALI')
  })
})

describe('damgaPaylari', () => {
  it('226,80 → 1/3 × 3 = 75,60', () => {
    const s = damgaPaylari(para('226.80'), [{ kisiId: '1', pay: 1, payda: 3 }, { kisiId: '2', pay: 1, payda: 3 }, { kisiId: '3', pay: 1, payda: 3 }])
    expect(s.ok && s.deger.map((p) => [p.kisiId, p.pay, p.payda, p.tutar.toFixed(2)])).toEqual([['1', 1, 3, '75.60'], ['2', 1, 3, '75.60'], ['3', 1, 3, '75.60']])
  })
  it('100,01 → 1/2 + 1/2 = 50,01 (kişi 1) / 50,00', () => {
    const s = damgaPaylari(para('100.01'), [{ kisiId: '2', pay: 1, payda: 2 }, { kisiId: '1', pay: 1, payda: 2 }])
    expect(s.ok && s.deger.map((p) => [p.kisiId, p.tutar.toFixed(2)])).toEqual([['2', '50.00'], ['1', '50.01']])
  })
  it('hisse toplamı 1 değilse hata', () => {
    const s = damgaPaylari(para('10.00'), [{ kisiId: '1', pay: 1, payda: 2 }])
    expect(s.ok ? 'OK' : s.hata.kod).toBe('HISSE_TOPLAMI_HATALI')
  })
})
