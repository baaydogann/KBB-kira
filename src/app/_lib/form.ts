import { unstable_rethrow } from 'next/navigation'
import { z, ZodError } from 'zod'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { ParametreYokHatasi } from '@/server/parametre/servis'
import type { FormDurumu } from './form-durumu'

export { BOS_FORM, basariDurumu, type FormDurumu } from './form-durumu'

// Doğrulama mesajları Türkçe (spec §15). Zod'u kullanan her server action bu modülden geçer.
z.config(z.locales.tr())

// Şifre türü alanlar ve Next'in action iç alanları ($ACTION_...) istemciye geri gönderilmez.
const GERI_GONDERILMEZ = /sifre|parola|password/i

/** Gönderilen metin alanları; hata durumunda girdiler formda korunsun diye `FormDurumu.degerler`e konur. */
export function formDegerleri(f: FormData): Record<string, string> {
  const degerler: Record<string, string> = {}
  for (const [ad, deger] of f.entries()) {
    if (typeof deger === 'string' && !ad.startsWith('$') && !GERI_GONDERILMEZ.test(ad)) degerler[ad] ??= deger
  }
  return degerler
}

function hataGovdesi(e: unknown): FormDurumu {
  if (e instanceof ZodError) {
    const alanHatalari: Record<string, string> = {}
    for (const i of e.issues) {
      const yol = i.path.join('.')
      alanHatalari[yol] ??= i.message
    }
    return { hata: 'Formdaki işaretli alanları düzeltin.', alanHatalari, tamam: false }
  }
  if (e instanceof IsKuraliHatasi) return { hata: e.message, alanHatalari: e.alan ? { [e.alan]: e.message } : {}, tamam: false }
  if (e instanceof CakismaHatasi || e instanceof BulunamadiHatasi || e instanceof ParametreYokHatasi) {
    return { hata: e.message, alanHatalari: {}, tamam: false }
  }
  console.error(e)
  return { hata: 'Beklenmeyen bir hata oluştu; kayıt değişmedi. Tekrar deneyin, sürerse sistem yöneticisine bildirin.', alanHatalari: {}, tamam: false }
}

export function hataDurumu(e: unknown, f?: FormData): FormDurumu {
  unstable_rethrow(e)
  const durum = hataGovdesi(e)
  return f ? { ...durum, degerler: formDegerleri(f) } : durum
}

export function formMetni(f: FormData, ad: string): string {
  const v = f.get(ad)
  return typeof v === 'string' ? v.trim() : ''
}

/** Yalnızca güvenli tamsayı (işaretli olabilir); aksi halde null. `-0` sıfıra normalleştirilir. */
export function formSayi(f: FormData, ad: string): number | null {
  const v = formMetni(f, ad)
  if (!/^-?\d+$/.test(v)) return null
  const n = Number(v)
  if (!Number.isSafeInteger(n)) return null
  return n === 0 ? 0 : n
}

/**
 * İyimser kilit sürümü: yok/boş → undefined; negatif olmayan güvenli tamsayı → o sayı;
 * bozuk değer sessizce yok sayılmaz (kilidi düşürürdü), hata verilir.
 */
export function formSurum(f: FormData, ad = 'version'): number | undefined {
  const v = formMetni(f, ad)
  if (v === '') return undefined
  const n = /^\d+$/.test(v) ? formSayi(f, ad) : null
  if (n === null) throw new IsKuraliHatasi('VERSION', 'Form sürümü geçersiz; sayfayı yenileyip tekrar deneyin.')
  return n
}

export function formSecim(f: FormData, ad: string): boolean {
  return f.get(ad) === 'on' || f.get(ad) === 'true'
}
