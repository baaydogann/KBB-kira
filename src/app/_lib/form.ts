import { unstable_rethrow } from 'next/navigation'
import { ZodError } from 'zod'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { ParametreYokHatasi } from '@/server/parametre/servis'
import type { FormDurumu } from './form-durumu'

export { BOS_FORM, basariDurumu, type FormDurumu } from './form-durumu'

export function hataDurumu(e: unknown): FormDurumu {
  unstable_rethrow(e)
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

export function formMetni(f: FormData, ad: string): string {
  const v = f.get(ad)
  return typeof v === 'string' ? v.trim() : ''
}

export function formSayi(f: FormData, ad: string): number | null {
  const v = formMetni(f, ad)
  return /^-?\d+$/.test(v) ? Number(v) : null
}

export function formSecim(f: FormData, ad: string): boolean {
  return f.get(ad) === 'on' || f.get(ad) === 'true'
}
