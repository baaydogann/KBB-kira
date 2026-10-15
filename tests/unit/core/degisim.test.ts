import { describe, expect, it } from 'vitest'
import { para, type Para } from '@/core/para'
import { ayAnahtari, ayKaydir } from '@/core/tarih'
import { onIkiAyOrtalamaDegisim, yillikDegisim } from '@/core/endeks/degisim'

// I_k = 100 + k, k=0 → 2024-10, k=23 → 2026-09
function tablo(): Map<string, Para> {
  const m = new Map<string, Para>()
  for (let k = 0; k < 24; k++) m.set(ayAnahtari(ayKaydir({ yil: 2024, ay: 10 }, k)), para(String(100 + k)))
  return m
}

describe('endeks değişimleri', () => {
  it('12 aylık ortalamalara göre değişim: Σ(112..123)/Σ(100..111) − 1 = 1410/1266 − 1 = %11,37', () => {
    const s = onIkiAyOrtalamaDegisim(tablo(), { yil: 2026, ay: 9 })
    expect(s.ok && s.deger.toFixed(2)).toBe('11.37')
  })
  it('yıllık değişim: 123/111 − 1 = %10,81', () => {
    const s = yillikDegisim(tablo(), { yil: 2026, ay: 9 })
    expect(s.ok && s.deger.toFixed(2)).toBe('10.81')
  })
  it('eksik ayda ENDEKS_YOK döner', () => {
    const m = tablo()
    m.delete('2025-01')
    const s = onIkiAyOrtalamaDegisim(m, { yil: 2026, ay: 9 })
    expect(!s.ok && s.hata.kod).toBe('ENDEKS_YOK')
    expect(yillikDegisim(m, { yil: 2026, ay: 1 }).ok).toBe(false)
  })
})

describe('mutasyon kapısı: yıllık değişimde eksik güncel ay', () => {
  it('güncel ayın endeksi yoksa o ay için ENDEKS_YOK döner (önceki yıl değerine bakmadan)', () => {
    const m = tablo()
    m.delete('2026-09')
    const s = yillikDegisim(m, { yil: 2026, ay: 9 })
    expect(s.ok).toBe(false)
    if (!s.ok) {
      expect(s.hata.kod).toBe('ENDEKS_YOK')
      expect(s.hata.mesaj).toBe('2026-09 endeks değeri yok.')
    }
  })
  it('önceki yılın endeksi yoksa o ay raporlanır', () => {
    const m = tablo()
    m.delete('2025-09')
    const s = yillikDegisim(m, { yil: 2026, ay: 9 })
    expect(!s.ok && s.hata.mesaj).toBe('2025-09 endeks değeri yok.')
  })
})
