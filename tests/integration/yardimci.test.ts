import { describe, expect, it } from 'vitest'
import { testVeritabaniniDogrula } from './yardimci'

const PAROLA = 'GizliParola123'

describe('testVeritabaniniDogrula', () => {
  it.each([
    'postgresql://u:p@localhost:5433/kbbkira_test?schema=public',
    'postgresql://u:p@127.0.0.1:5432/kbbkira_test',
    'postgresql://u:p@[::1]:5432/kbbkira_test',
    'postgresql://u:p@postgres:5432/kbbkira_test?schema=public',
    'postgresql://u:p@localhost:5433/kbbkira%5Ftest',
  ])('yerel *_test veritabanını kabul eder: %s', (url) => {
    expect(() => testVeritabaniniDogrula(url)).not.toThrow()
  })

  it.each([
    { neden: 'ad *_test ile bitmiyor', url: `postgresql://u:${PAROLA}@localhost:5433/kbbkira_test_backup` },
    { neden: 'geliştirme veritabanı', url: `postgresql://u:${PAROLA}@localhost:5433/kbbkira` },
    { neden: '_test yalnızca sunucu adında', url: `postgresql://u:${PAROLA}@db_test.internal:5432/kbbkira` },
    { neden: 'yerel olmayan sunucu', url: `postgresql://u:${PAROLA}@prod.example.com:5432/x_test` },
    { neden: 'ad sonunda eğik çizgi', url: `postgresql://u:${PAROLA}@localhost:5433/kbbkira_test/` },
    { neden: 'boş adres', url: '' },
    { neden: 'ayrıştırılamayan adres', url: 'bu bir adres değil' },
  ])('reddeder: $neden', ({ url }) => {
    expect(() => testVeritabaniniDogrula(url)).toThrow(/Entegrasyon testleri/)
  })

  it('tanımsız adresi reddeder', () => {
    expect(() => testVeritabaniniDogrula(undefined)).toThrow(/Entegrasyon testleri/)
  })

  it('hata iletisi yalnızca veritabanı adı ve sunucuyu içerir; parola ve tam adres sızmaz', () => {
    const url = `postgresql://kullanici:${PAROLA}@prod.example.com:5432/x_test?schema=public`
    let ileti = ''
    try {
      testVeritabaniniDogrula(url)
    } catch (e) {
      ileti = (e as Error).message
    }
    expect(ileti).toContain('x_test')
    expect(ileti).toContain('prod.example.com')
    expect(ileti).not.toContain(PAROLA)
    expect(ileti).not.toContain('kullanici')
    expect(ileti).not.toContain(url)
  })

  it('ayrıştırılamayan adreste de parola sızmaz', () => {
    let ileti = ''
    try {
      testVeritabaniniDogrula(`postgresql://kullanici:${PAROLA}@[bozuk`)
    } catch (e) {
      ileti = (e as Error).message
    }
    expect(ileti).not.toBe('')
    expect(ileti).not.toContain(PAROLA)
  })
})
