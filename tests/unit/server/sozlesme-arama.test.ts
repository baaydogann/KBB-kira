import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { kimlikBenzeriMi, sozlesmeAramaHedefi, tasinmazAramaHedefi } from '@/server/sozlesme/arama'

describe('kimlikBenzeriMi', () => {
  it('boşluk, nokta ve tire atıldıktan sonra 10 ya da daha uzun rakam dizisi içeren girdiyi ve TR+2 rakamla başlayan IBAN\'ı kimlik benzeri sayar', () => {
    for (const q of [
      '10000000146', ' 100 000 001 46 ', '1234567890', 'TR330006100519786457841326', 'tr33 0006 1005 1978 6457 8413 26', 'TR33',
      'Ahmet 10000000146', '100-000-001-46', '100.000.001.46', '100 - 000.001-46', '123456789012', '12345-67890', '000610000000000000000006',
    ]) {
      expect(kimlikBenzeriMi(q), q).toBe(true)
    }
  })

  it('sözleşme no, tarih ve ada/parsel gibi sıradan aramaları kimlik saymaz (10 haneden kısa rakam dizileri)', () => {
    for (const q of ['', 'MRM-001', '2026', '123456789', 'Arsa B', 'TRX1', 'Hizmet Binası', '123/45', '123.45', '2026-01-15', '1234 5678']) {
      expect(kimlikBenzeriMi(q), q).toBe(false)
    }
  })
})

describe('sozlesmeAramaHedefi', () => {
  it('kimlik numarasına benzeyen girdiyi bildirim adresine yönlendirir; adreste değer yoktur', () => {
    expect(sozlesmeAramaHedefi('10000000146', '')).toBe('/sozlesmeler?kimlik=1')
    expect(sozlesmeAramaHedefi(' 100 000 001 46 ', 'AKTIF')).toBe('/sozlesmeler?kimlik=1')
    expect(sozlesmeAramaHedefi('TR33 0006 1005 1978 6457 8413 26', '')).toBe('/sozlesmeler?kimlik=1')
  })

  it('diğer girdiyi kodlanmış `q` ile, geçerli durum süzgeciyle birlikte döndürür', () => {
    expect(sozlesmeAramaHedefi('  Arsa B ', '')).toBe('/sozlesmeler?q=Arsa%20B')
    expect(sozlesmeAramaHedefi('a&b=c#d', '')).toBe('/sozlesmeler?q=a%26b%3Dc%23d')
    expect(sozlesmeAramaHedefi('MRM-001', 'AKTIF')).toBe('/sozlesmeler?q=MRM-001&durum=AKTIF')
    expect(sozlesmeAramaHedefi('', 'FESHEDILDI')).toBe('/sozlesmeler?durum=FESHEDILDI')
  })

  it('bilinmeyen durumu yok sayar; boş aramada listeye döner', () => {
    expect(sozlesmeAramaHedefi('MRM-001', 'XYZ')).toBe('/sozlesmeler?q=MRM-001')
    expect(sozlesmeAramaHedefi('', '')).toBe('/sozlesmeler')
    expect(sozlesmeAramaHedefi('   ', 'bilinmeyen')).toBe('/sozlesmeler')
  })

  it('özellik: 10/11 haneli numara (boşluklu da) ve IBAN benzeri girdi hiçbir hedef adreste geçmez', () => {
    const numara = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 }).map((r) => r.join(''))
    const iban = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 2, maxLength: 24 }).map((r) => `TR${r.join('')}`)
    fc.assert(fc.property(fc.oneof(numara, iban), fc.constantFrom('', 'AKTIF', 'XYZ'), (q, durum) => {
      const hedef = sozlesmeAramaHedefi(q, durum)
      expect(hedef).toBe('/sozlesmeler?kimlik=1')
      expect(hedef).not.toContain(q.slice(0, 6))
      expect(hedef).not.toContain(q.slice(-6))
    }), { numRuns: 200 })
  })
})

describe('tasinmazAramaHedefi (POST arama, kişi ve sözleşme listeleriyle aynı kural)', () => {
  it('kimlik numarasına/IBAN benzeri girdiyi bildirim adresine yönlendirir; adreste değer yoktur', () => {
    expect(tasinmazAramaHedefi('10000000146')).toBe('/tasinmazlar?kimlik=1')
    expect(tasinmazAramaHedefi('Ahmet 100 000 001 46')).toBe('/tasinmazlar?kimlik=1')
    expect(tasinmazAramaHedefi('tr33 0006 1005 1978 6457 8413 26')).toBe('/tasinmazlar?kimlik=1')
  })

  it('ad, adres, ilçe ve ada/parsel aramasını kodlanmış `q` ile döndürür; boş aramada listeye döner', () => {
    expect(tasinmazAramaHedefi(' 123/45 ')).toBe('/tasinmazlar?q=123%2F45')
    expect(tasinmazAramaHedefi('Meram hizmet binası')).toBe('/tasinmazlar?q=Meram%20hizmet%20binas%C4%B1')
    expect(tasinmazAramaHedefi('   ')).toBe('/tasinmazlar')
  })

  it('özellik: 10/11 haneli numara ve IBAN benzeri girdi hedef adreste geçmez', () => {
    const numara = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 }).map((r) => r.join(''))
    const iban = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 2, maxLength: 24 }).map((r) => `TR${r.join('')}`)
    fc.assert(fc.property(fc.oneof(numara, iban), (q) => {
      expect(tasinmazAramaHedefi(q)).toBe('/tasinmazlar?kimlik=1')
    }), { numRuns: 200 })
  })
})
