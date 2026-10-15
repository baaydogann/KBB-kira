import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'
import { TAKVIM_ISTEK_GUNLUGU_HARIC } from '@/server/takvim/yol'

describe('takvim istek günlüğü deseni', () => {
  it('/takvim/<token>.ics (sorgu dizesiyle de) eşleşir; diğer yollar eşleşmez', () => {
    expect(TAKVIM_ISTEK_GUNLUGU_HARIC.test('/takvim/XPEFh4TK-ptOy70tJo8cJrCJiRaSbo1p.ics')).toBe(true)
    expect(TAKVIM_ISTEK_GUNLUGU_HARIC.test('/takvim/abc.ics?x=1')).toBe(true)
    for (const yol of ['/hesabim', '/', '/api/saglik', '/yonetim/kullanicilar', '/takvimler/abc.ics', '/x/takvim/abc.ics', '/takvim']) {
      expect(TAKVIM_ISTEK_GUNLUGU_HARIC.test(yol), yol).toBe(false)
    }
  })

  it('next.config.ts geliştirme sunucusunun istek günlüğünden bu deseni hariç tutar', () => {
    const gunluk = nextConfig.logging === false ? undefined : nextConfig.logging?.incomingRequests
    const yoksay = typeof gunluk === 'object' ? gunluk.ignore : undefined
    expect(yoksay).toContain(TAKVIM_ISTEK_GUNLUGU_HARIC)
  })
})
