import { describe, expect, it } from 'vitest'
import { para, SIFIR } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { sozlesmeOnizleme, type OnizlemeGirdi } from '@/core/hesap/onizleme'

function girdi(ek: Partial<OnizlemeGirdi> = {}): OnizlemeGirdi {
  return {
    baslangic: t('2026-01-01'), bitis: t('2026-12-31'), periyotAy: 1, zaman: 'PESIN',
    vadeKurali: 'DONEM_BASI_ARTI_GUN', vadeParametresi: 0, kist: 'GERCEK_GUN', bedelTuru: 'BRUT',
    kiraDonemleri: [{ id: '1', baslangic: t('2026-01-01'), bitis: null, bedel: para('10000'), taban: 'AYLIK' }],
    malikler: [
      { kisiId: '1', pay: 1, payda: 2, statu: 'GMSI_GERCEK' },
      { kisiId: '2', pay: 1, payda: 3, statu: 'GMSI_GERCEK' },
      { kisiId: '3', pay: 1, payda: 6, statu: 'GMSI_GERCEK' },
    ],
    oranlar: () => ({ stopaj: para('20'), kdv: SIFIR }),
    ufuk: t('2028-01-01'),
    ...ek,
  }
}

describe('sozlesmeOnizleme', () => {
  it('spec örneği: 3 malik, her satırda kuruş toplamı korunur', () => {
    const s = sozlesmeOnizleme(girdi())
    expect(s.ok).toBe(true)
    if (!s.ok) return
    expect(s.deger).toHaveLength(12)
    const ilk = s.deger[0]!
    expect(ilk.vade).toBe('2026-01-01')
    expect(ilk.tutar.toFixed(2)).toBe('10000.00')
    expect(ilk.malikler.map((m) => [m.brut, m.stopaj, m.net].map((x) => x.toFixed(2)))).toEqual([
      ['5000.00', '1000.00', '4000.00'],
      ['3333.33', '666.67', '2666.66'],
      ['1666.67', '333.33', '1333.34'],
    ])
  })
  it('azamiSatir ile sınırlanır', () => {
    const s = sozlesmeOnizleme(girdi({ bitis: null, azamiSatir: 24 }))
    expect(s.ok && s.deger.length).toBe(24)
  })
  it('NET sözleşmede malik netleri korunur, brüt büyür', () => {
    const s = sozlesmeOnizleme(girdi({
      bedelTuru: 'NET',
      kiraDonemleri: [{ id: '1', baslangic: t('2026-01-01'), bitis: null, bedel: para('8000'), taban: 'AYLIK' }],
      malikler: [{ kisiId: '1', pay: 1, payda: 2, statu: 'GMSI_GERCEK' }, { kisiId: '2', pay: 1, payda: 2, statu: 'GMSI_GERCEK' }],
    }))
    expect(s.ok && s.deger[0]!.malikler.map((m) => [m.brut.toFixed(2), m.net.toFixed(2)])).toEqual([['5000.00', '4000.00'], ['5000.00', '4000.00']])
  })
  it('hisse toplamı hatalıysa hata döner', () => {
    const s = sozlesmeOnizleme(girdi({ malikler: [{ kisiId: '1', pay: 1, payda: 2, statu: 'GMSI_GERCEK' }] }))
    expect(!s.ok && s.hata.kod).toBe('HISSE_TOPLAMI_HATALI')
  })
})
