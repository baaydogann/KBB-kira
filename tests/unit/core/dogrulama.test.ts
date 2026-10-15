import { describe, expect, it } from 'vitest'
import { ibanBicimle, ibanGecerliMi, ibanNormalize, maskele, tcknGecerliMi, vknGecerliMi } from '@/core/dogrulama'

describe('TCKN', () => {
  it.each(['10000000146', '12345678950'])('%s geçerli', (s) => expect(tcknGecerliMi(s)).toBe(true))
  it.each(['10000000147', '12345678951', '02345678950', '1234567895', '1234567895a', ''])(
    '%s geçersiz', (s) => expect(tcknGecerliMi(s)).toBe(false))
})

describe('VKN', () => {
  it.each(['1234567890', '9876543217'])('%s geçerli', (s) => expect(vknGecerliMi(s)).toBe(true))
  it.each(['1234567891', '9876543210', '123456789', '12345678901', 'abcdefghij'])(
    '%s geçersiz', (s) => expect(vknGecerliMi(s)).toBe(false))
})

describe('IBAN', () => {
  it('boşluk ve küçük harf toleranslıdır', () => {
    expect(ibanNormalize('tr33 0006 1005 1978 6457 8413 26')).toBe('TR330006100519786457841326')
    expect(ibanGecerliMi('TR330006100519786457841326')).toBe(true)
    expect(ibanGecerliMi('tr33 0006 1005 1978 6457 8413 26')).toBe(true)
  })
  it('kontrol hanesi veya uzunluk bozuksa reddeder', () => {
    expect(ibanGecerliMi('TR330006100519786457841327')).toBe(false)
    expect(ibanGecerliMi('TR33000610051978645784132')).toBe(false)
    expect(ibanGecerliMi('DE89370400440532013000')).toBe(false)
  })
  it('dörtlü gruplar halinde biçimler', () => {
    expect(ibanBicimle('TR330006100519786457841326')).toBe('TR33 0006 1005 1978 6457 8413 26')
  })
})

describe('maskele', () => {
  it('son dört haneyi gösterir', () => {
    expect(maskele('10000000146')).toBe('*******0146')
    expect(maskele('TR330006100519786457841326')).toBe('**********************1326')
    expect(maskele('123')).toBe('123')
  })
})
