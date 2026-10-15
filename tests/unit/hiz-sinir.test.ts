import { describe, expect, it } from 'vitest'
import { hizSinirlayici } from '@/server/auth/hiz-sinir'

describe('hizSinirlayici', () => {
  it('pencere içinde limiti aşınca reddeder, pencere geçince açar', () => {
    const s = hizSinirlayici(3, 1000)
    expect([s.dene('a', 0), s.dene('a', 10), s.dene('a', 20), s.dene('a', 30)]).toEqual([true, true, true, false])
    expect(s.dene('b', 30)).toBe(true)
    expect(s.dene('a', 1001)).toBe(true)
    s.sifirla('a')
    expect(s.dene('a', 1002)).toBe(true)
  })

  it('anahtar sayısı eşiği aşınca süresi dolmuş anahtarları siler, canlıları korur', () => {
    const s = hizSinirlayici(1, 1000)
    expect(s.dene('canli', 1500)).toBe(true)
    for (let i = 0; i < 10_001; i++) s.dene(`ip-${i}`, 100)
    expect(s.boyut()).toBe(10_002)
    // 1600'de pencere (600, 1600]: ip-* (100) bayat, canli (1500) taze
    expect(s.dene('yeni', 1600)).toBe(true)
    expect(s.boyut()).toBe(2)
    expect(s.dene('canli', 1601)).toBe(false)
  })
})
