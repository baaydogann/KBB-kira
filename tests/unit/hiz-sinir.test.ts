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
})
