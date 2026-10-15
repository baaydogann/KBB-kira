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
  it('gorunen sıfır veya negatifken değerin tamamını açmaz', () => {
    expect(maskele('12345', 0)).toBe('*****')
    expect(maskele('12345', -2)).toBe('*****')
  })
  it('gorunen değer uzunluğuna eşitken değeri olduğu gibi döner', () => {
    expect(maskele('1234', 4)).toBe('1234')
  })
})

describe('mutasyon kapısı: kimlik doğrulama kenarları', () => {
  // Algoritmik (sentetik) geçerli kimlikler; hiçbiri gerçek bir kişiye ait değildir.
  it.each(['35172694894', '57391486272', '46829137572'])('%s: tek ve çift hane toplamları ayrı ayrı etkilidir', (s) => {
    expect(tcknGecerliMi(s)).toBe(true)
  })
  it('TCKN: tam 11 hane ister (geçerli kimliğin önüne/arkasına rakam eklenemez)', () => {
    expect(tcknGecerliMi('12345678950')).toBe(true)
    expect(tcknGecerliMi('123456789507')).toBe(false)
    expect(tcknGecerliMi('012345678950')).toBe(false)
  })
  it('TCKN: 10. hane yanlışken 11. hane buna göre tutsa bile reddedilir', () => {
    // 12345678950'de 10. hane 5; 6 yapılıp 11. hane yeni toplama (51 → 1) göre ayarlandı.
    expect(tcknGecerliMi('12345678961')).toBe(false)
  })
  it.each(['0123456789', '0000000001', '1020304052'])('VKN %s: tmp=9 kolu dahil kontrol hanesi doğru hesaplanır', (s) => {
    expect(vknGecerliMi(s)).toBe(true)
  })
  it('IBAN: tam TR + 24 hane ister (mod-97 tesadüfen tutan ön/son ekler reddedilir)', () => {
    expect(ibanGecerliMi('TR330006100519786457841326')).toBe(true)
    expect(ibanGecerliMi('TR33000610051978645784132678')).toBe(false)
    expect(ibanGecerliMi('76TR330006100519786457841326')).toBe(false)
  })
})
