import { describe, expect, it } from 'vitest'
import { basarili, hatali, type Sonuc } from '@/core/sonuc'

describe('Sonuc', () => {
  it('basarili değeri ok=true ile taşır', () => {
    const s: Sonuc<number> = basarili(42)
    expect(s).toEqual({ ok: true, deger: 42 })
  })

  it('hatali kod ve mesajı ok=false ile taşır', () => {
    const s: Sonuc<number> = hatali({ kod: 'GECERSIZ_GIRDI', mesaj: 'Bozuk girdi' })
    expect(s.ok).toBe(false)
    if (!s.ok) {
      expect(s.hata.kod).toBe('GECERSIZ_GIRDI')
      expect(s.hata.mesaj).toBe('Bozuk girdi')
    }
  })
})
