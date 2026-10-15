import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { kimlikAramasi, kisiAramaHedefi } from '@/server/kisi/arama'

const BULUNAN = '10000000146'
const bul = vi.fn(async (kimlik: string) => (kimlik === BULUNAN ? 7 : null))

describe('kimlikAramasi', () => {
  it('boşlukları atılmış 10 veya 11 haneli rakam dizisini kimlik numarası sayar', () => {
    expect(kimlikAramasi('10000000146')).toBe('10000000146')
    expect(kimlikAramasi(' 100 000 001 46 ')).toBe('10000000146')
    expect(kimlikAramasi('1234567890')).toBe('1234567890')
  })

  it('daha kısa, daha uzun veya rakam dışı içeren metni kimlik numarası saymaz', () => {
    for (const q of ['', '123456789', '123456789012', 'Ahmet', '1234567890a', '12345-67890', 'TR330006100519786457841326']) {
      expect(kimlikAramasi(q), q).toBeNull()
    }
  })
})

describe('kisiAramaHedefi', () => {
  it('bulunan TCKN için kişi sayfasına gider; adreste numara yoktur', async () => {
    bul.mockClear()
    expect(await kisiAramaHedefi(BULUNAN, bul)).toBe('/kisiler/7')
    expect(bul).toHaveBeenCalledExactlyOnceWith(BULUNAN)
  })

  it('boşluklu girişi rakamlara indirip arar', async () => {
    bul.mockClear()
    expect(await kisiAramaHedefi('100 000 001 46', bul)).toBe('/kisiler/7')
    expect(bul).toHaveBeenCalledExactlyOnceWith(BULUNAN)
  })

  it('bulunamayan VKN/TCKN için bildirim adresine gider; adreste numara yoktur', async () => {
    expect(await kisiAramaHedefi('1234567890', bul)).toBe('/kisiler?bulunamadi=1')
    expect(await kisiAramaHedefi('99999999999', bul)).toBe('/kisiler?bulunamadi=1')
  })

  it('ad aramasını GET sorgusuna çevirir, kimlik aramasına başvurmaz', async () => {
    bul.mockClear()
    expect(await kisiAramaHedefi('  Ahmet Yılmaz ', bul)).toBe('/kisiler?q=Ahmet%20Y%C4%B1lmaz')
    expect(await kisiAramaHedefi('a&b=c#d', bul)).toBe('/kisiler?q=a%26b%3Dc%23d')
    expect(bul).not.toHaveBeenCalled()
  })

  it('boş aramada listeye döner', async () => {
    expect(await kisiAramaHedefi('', bul)).toBe('/kisiler')
    expect(await kisiAramaHedefi('   ', bul)).toBe('/kisiler')
  })

  it('özellik: 10/11 haneli herhangi bir numara (boşluklu da) hiçbir hedef adresinde geçmez', async () => {
    const numara = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 }).map((r) => r.join(''))
    const bosluklu = numara.chain((n) => fc.array(fc.boolean(), { minLength: n.length, maxLength: n.length }).map((b) => [...n].map((c, i) => (b[i] ? ` ${c}` : c)).join('')))
    await fc.assert(fc.asyncProperty(bosluklu, fc.boolean(), async (q, bulunur) => {
      const hedef = await kisiAramaHedefi(q, async () => (bulunur ? 7 : null))
      const rakamlar = q.replace(/\s+/g, '')
      expect(hedef).toBe(bulunur ? '/kisiler/7' : '/kisiler?bulunamadi=1')
      expect(hedef).not.toContain(rakamlar.slice(0, 6))
      expect(hedef).not.toContain(rakamlar.slice(-6))
    }), { numRuns: 200 })
  })
})
