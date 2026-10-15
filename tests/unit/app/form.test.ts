import { redirect } from 'next/navigation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { tarih } from '@/core/tarih'
import { formDegerleri, formMetni, formSayi, formSecim, formSurum, hataDurumu, yolKimligi } from '@/app/_lib/form'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { ParametreYokHatasi } from '@/server/parametre/servis'

function form(girdi: Record<string, string>): FormData {
  const f = new FormData()
  for (const [ad, deger] of Object.entries(girdi)) f.append(ad, deger)
  return f
}

afterEach(() => vi.restoreAllMocks())

describe('formMetni', () => {
  it('metni kırpar; yok veya dosya girdisi için boş döner', () => {
    const f = form({ a: '  x  ' })
    f.append('d', new File(['x'], 'd.txt'))
    expect([formMetni(f, 'a'), formMetni(f, 'yok'), formMetni(f, 'd')]).toEqual(['x', '', ''])
  })
})

describe('formSayi', () => {
  it('işaretli tamsayıları döner', () => {
    expect(formSayi(form({ n: '42' }), 'n')).toBe(42)
    expect(formSayi(form({ n: ' -7 ' }), 'n')).toBe(-7)
    expect(formSayi(form({ n: '007' }), 'n')).toBe(7)
    expect(formSayi(form({ n: String(Number.MAX_SAFE_INTEGER) }), 'n')).toBe(Number.MAX_SAFE_INTEGER)
    expect(formSayi(form({ n: String(Number.MIN_SAFE_INTEGER) }), 'n')).toBe(Number.MIN_SAFE_INTEGER)
  })

  it('güvenli tamsayı aralığı dışını (kesinlik kaybı, Infinity) null yapar', () => {
    expect(formSayi(form({ n: '9007199254740992' }), 'n')).toBeNull()
    expect(formSayi(form({ n: '12345678901234567890' }), 'n')).toBeNull()
    expect(formSayi(form({ n: '-9007199254740992' }), 'n')).toBeNull()
    expect(formSayi(form({ n: '9'.repeat(400) }), 'n')).toBeNull()
  })

  it('-0 değerini 0 yapar (Object.is ile ayırt edilir)', () => {
    expect(Object.is(formSayi(form({ n: '-0' }), 'n'), 0)).toBe(true)
    expect(Object.is(formSayi(form({ n: '0' }), 'n'), 0)).toBe(true)
  })

  it('ondalık, bilimsel gösterim ve çöp girdiyi null yapar', () => {
    for (const v of ['1.5', '1,5', '1e3', '0x10', '+5', '--5', '5-', 'abc', '', ' ', '١٢']) {
      expect(formSayi(form({ n: v }), 'n'), JSON.stringify(v)).toBeNull()
    }
    expect(formSayi(form({}), 'n')).toBeNull()
  })
})

describe('formSurum', () => {
  it('alan yoksa veya boşsa undefined döner', () => {
    expect(formSurum(form({}))).toBeUndefined()
    expect(formSurum(form({ version: '' }))).toBeUndefined()
    expect(formSurum(form({ version: '   ' }))).toBeUndefined()
  })

  it('negatif olmayan güvenli tamsayıyı döner; varsayılan alan adı version', () => {
    expect(formSurum(form({ version: '0' }))).toBe(0)
    expect(formSurum(form({ version: '12' }))).toBe(12)
    expect(formSurum(form({ surum: ' 3 ' }), 'surum')).toBe(3)
    expect(formSurum(form({ version: String(Number.MAX_SAFE_INTEGER) }))).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('bozuk değeri sessizce yok saymaz, IsKuraliHatasi fırlatır', () => {
    for (const v of ['-1', '-0', '1.5', '1e2', 'abc', '9007199254740992', '9'.repeat(400)]) {
      const hata = (() => {
        try {
          formSurum(form({ version: v }))
        } catch (e) {
          return e
        }
        return null
      })()
      expect(hata, JSON.stringify(v)).toBeInstanceOf(IsKuraliHatasi)
      expect(hata).toMatchObject({ kod: 'VERSION', message: 'Form sürümü geçersiz; sayfayı yenileyip tekrar deneyin.' })
    }
  })
})

describe('yolKimligi', () => {
  it('rakamlardan oluşan pozitif INTEGER kimliklerini döner', () => {
    expect(yolKimligi('1')).toBe(1)
    expect(yolKimligi('42')).toBe(42)
    expect(yolKimligi('007')).toBe(7)
    expect(yolKimligi('2147483647')).toBe(2_147_483_647)
  })

  it('sıfır, aralık dışı ve Number(x) ile sayıya dönüşen çöp girdiyi null yapar', () => {
    for (const v of ['0', '2147483648', '9'.repeat(400), '', ' ', ' 7', '7 ', '-1', '+5', '1.5', '1,5', '1e3', '0x10', 'abc', '١٢', 'Infinity', 'NaN']) {
      expect(yolKimligi(v), JSON.stringify(v)).toBeNull()
    }
  })
})

describe('formSecim', () => {
  it("'on' ve 'true' işaretli sayılır; diğerleri ve yok değil", () => {
    expect(formSecim(form({ a: 'on' }), 'a')).toBe(true)
    expect(formSecim(form({ a: 'true' }), 'a')).toBe(true)
    expect(formSecim(form({ a: 'false' }), 'a')).toBe(false)
    expect(formSecim(form({ a: '' }), 'a')).toBe(false)
    expect(formSecim(form({}), 'a')).toBe(false)
  })
})

describe('formDegerleri', () => {
  it('metin alanlarını toplar; şifre türü, $ACTION ve dosya alanlarını atlar', () => {
    const f = form({
      kullaniciAdi: 'ayse', not: '  boşluk korunur ', sifre: 'gizli', yeniSifre: 'gizli', eskiParola: 'gizli', Password: 'gizli', $ACTION_KEY: 'k',
    })
    f.append('dosya', new File(['x'], 'd.txt'))
    expect(formDegerleri(f)).toEqual({ kullaniciAdi: 'ayse', not: '  boşluk korunur ' })
  })

  it('aynı adlı alanlarda ilk değeri tutar (formData.get ile tutarlı)', () => {
    const f = new FormData()
    f.append('a', '1')
    f.append('a', '2')
    expect(formDegerleri(f)).toEqual({ a: '1' })
  })
})

describe('hataDurumu', () => {
  it('ZodError: alan yolu noktayla birleşir, ilk mesaj kazanır', () => {
    const sonuc = z.object({ ad: z.string().min(3, 'Ad kısa'), adres: z.object({ il: z.string().min(1, 'İl zorunlu') }) }).safeParse({ ad: 'a', adres: { il: '' } })
    expect(sonuc.success).toBe(false)
    const durum = hataDurumu(sonuc.error)
    expect(durum).toEqual({
      hata: 'Formdaki işaretli alanları düzeltin.',
      alanHatalari: { ad: 'Ad kısa', 'adres.il': 'İl zorunlu' },
      tamam: false,
    })
  })

  it('ZodError: aynı yoldaki ikinci sorun ilkini ezmez', () => {
    const sonuc = z.string().min(3, 'ilk').regex(/^\d+$/, 'ikinci').safeParse('a')
    const durum = hataDurumu(sonuc.error)
    expect(durum.alanHatalari).toEqual({ '': 'ilk' })
  })

  it('ZodError mesajları Türkçe yerelleştirilmiştir (form.ts z.config)', () => {
    const durum = hataDurumu(z.object({ n: z.string() }).safeParse({ n: 5 }).error)
    expect(durum.alanHatalari.n).toBe('Geçersiz değer: beklenen string, alınan number')
  })

  it('IsKuraliHatasi: alan varsa alanHatalari\'na, yoksa yalnız üst mesaja yazılır', () => {
    expect(hataDurumu(new IsKuraliHatasi('K', 'Tutar geçersiz', 'tutar'))).toEqual({
      hata: 'Tutar geçersiz', alanHatalari: { tutar: 'Tutar geçersiz' }, tamam: false,
    })
    expect(hataDurumu(new IsKuraliHatasi('K', 'Genel kural'))).toEqual({ hata: 'Genel kural', alanHatalari: {}, tamam: false })
  })

  it('Cakisma, Bulunamadi ve ParametreYok hataları mesajlarını üst hataya taşır', () => {
    for (const e of [new CakismaHatasi(), new BulunamadiHatasi('Yok'), new ParametreYokHatasi('X', tarih('2026-01-01'))]) {
      expect(hataDurumu(e)).toEqual({ hata: e.message, alanHatalari: {}, tamam: false })
    }
  })

  it('bilinmeyen hata: genel mesaj döner, ayrıntıyı sızdırmaz ve günlüğe yazar', () => {
    const gunluk = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ic = new Error('veritabanı parolası: gizli')
    const durum = hataDurumu(ic)
    expect(durum.alanHatalari).toEqual({})
    expect(durum.hata).toMatch(/^Beklenmeyen bir hata oluştu/)
    expect(durum.hata).not.toContain('gizli')
    expect(gunluk).toHaveBeenCalledExactlyOnceWith(ic)
  })

  it('Next yönlendirme hatasını yutmaz, yeniden fırlatır', () => {
    const yonlendirme = (() => {
      try {
        redirect('/giris')
      } catch (e) {
        return e
      }
      return null
    })()
    expect(yonlendirme).not.toBeNull()
    expect(() => hataDurumu(yonlendirme)).toThrow(yonlendirme as Error)
  })

  it('form verilirse degerler doldurulur (şifre alanları hariç); verilmezse alan yoktur', () => {
    const f = form({ kullaniciAdi: 'ayse', sifre: 'gizli' })
    expect(hataDurumu(new IsKuraliHatasi('K', 'x'), f).degerler).toEqual({ kullaniciAdi: 'ayse' })
    expect(hataDurumu(new CakismaHatasi(), f).degerler).toEqual({ kullaniciAdi: 'ayse' })
    expect('degerler' in hataDurumu(new IsKuraliHatasi('K', 'x'))).toBe(false)
  })
})
