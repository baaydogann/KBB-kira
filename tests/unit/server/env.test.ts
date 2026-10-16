import { describe, expect, it } from 'vitest'
import { ortamiDogrula } from '@/server/env'

const TEMEL = { DATABASE_URL: 'postgresql://k:p@localhost:5432/kbbkira' }
const ORNEK = 'bunu-en-az-32-karakterlik-rastgele-bir-degerle-degistirin'
const RASTGELE = 'p0Q8v9cJx2LrT4mWz7Yk1sHf6Nd3Ga5Ub8Re2Xi4Oq'

describe('ortamiDogrula: SESSION_SECRET', () => {
  it('üretimde .env.example yer tutucusunu ve açık yer tutucu işaretlerini reddeder; Türkçe ve eyleme dönük ileti verir', () => {
    for (const sir of [ORNEK, 'CHANGE-ME-change-me-change-me-change-me', 'placeholder-placeholder-placeholder-1234', 'gizli-anahtari-buraya-yazin-degistirin-0000']) {
      expect(() => ortamiDogrula({ ...TEMEL, NODE_ENV: 'production', SESSION_SECRET: sir }), sir)
        .toThrow('Üretimde SESSION_SECRET örnek/yer tutucu bir değer olamaz; `openssl rand -base64 48` ile üretilmiş rastgele bir değer verin.')
    }
  })

  it('üretimde rastgele değeri kabul eder; geliştirme ve testte yer tutucuya izin verir; 32 karakter alt sınırı her ortamda geçerlidir', () => {
    expect(ortamiDogrula({ ...TEMEL, NODE_ENV: 'production', SESSION_SECRET: RASTGELE }).SESSION_SECRET).toBe(RASTGELE)
    // e2e ve CI üretim kipinde bu test değerleriyle çalışır.
    expect(() => ortamiDogrula({ ...TEMEL, NODE_ENV: 'production', SESSION_SECRET: 'ci-icin-en-az-otuz-iki-karakterlik-gizli-deger' })).not.toThrow()
    expect(ortamiDogrula({ ...TEMEL, NODE_ENV: 'development', SESSION_SECRET: ORNEK }).NODE_ENV).toBe('development')
    expect(ortamiDogrula({ ...TEMEL, SESSION_SECRET: ORNEK }).NODE_ENV).toBe('development')
    expect(() => ortamiDogrula({ ...TEMEL, NODE_ENV: 'test', SESSION_SECRET: 'kisa' })).toThrow('SESSION_SECRET en az 32 karakter olmalı')
  })
})
