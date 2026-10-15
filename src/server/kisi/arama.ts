/**
 * Kişi araması (KVKK, spec §16): TCKN/VKN adres satırına, tarayıcı geçmişine, günlüklere ve Referer başlığına
 * girmesin diye kimlik numarası aramaları POST ile yapılır ve yönlendirme adresine hiçbir zaman yazılmaz.
 */

import { ibanNormalize } from '@/core/dogrulama'
import { kimlikBenzeriMi } from '../sozlesme/arama'

/** Boşlukları atılmış 10 (VKN) veya 11 (TCKN) haneli arama metni; kimlik numarası gibi değilse null. */
export function kimlikAramasi(q: string): string | null {
  const s = q.replace(/\s+/g, '')
  return /^\d{10,11}$/.test(s) ? s : null
}

/**
 * Arama kutusundan gelen metnin yönlendirileceği adres: kimlik numarası bulunursa kişi sayfası, bulunamazsa bildirim
 * adresi; aksi halde ad/unvan araması GET sorgusuyla (`?q=`). Kimlik numarası bu adreslerin hiçbirinde yer almaz.
 */
export async function kisiAramaHedefi(q: string, kimlikIleBul: (kimlik: string) => Promise<number | null>): Promise<string> {
  const kimlik = kimlikAramasi(q)
  if (kimlik !== null) {
    const id = await kimlikIleBul(kimlik)
    return id === null ? '/kisiler?bulunamadi=1' : `/kisiler/${id}`
  }
  const ad = q.trim()
  return ad ? `/kisiler?q=${encodeURIComponent(ad)}` : '/kisiler'
}

/** Kimlik numarası ya da IBAN'dan kişi kimliğini bulan aramalar (tam eşleşme); bulunamazsa null. */
export interface KimlikBulucular {
  kimlik: (kimlik: string) => Promise<number | null>
  iban: (iban: string) => Promise<number | null>
}

/**
 * Üst çubuktaki genel arama kutusunun (POST) yönlendireceği adres. TCKN, VKN ve IBAN benzeri girdi (`kimlikBenzeriMi`)
 * çözülür ve yalnızca kişi kimliğiyle yönlendirilir (IBAN kendi kişisine gider); bulunamazsa `/ara?bulunamadi=1`.
 * Kimlik numarası bu adreslerin hiçbirinde yer almaz. Diğer girdi `/ara?q=` ile gider.
 */
export async function genelAramaHedefi(q: string, bul: KimlikBulucular): Promise<string> {
  if (kimlikBenzeriMi(q)) {
    const kimlik = kimlikAramasi(q)
    const id = kimlik !== null ? await bul.kimlik(kimlik) : await bul.iban(ibanNormalize(q))
    return id === null ? '/ara?bulunamadi=1' : `/kisiler/${id}`
  }
  const ad = q.trim()
  return ad ? `/ara?q=${encodeURIComponent(ad)}` : '/ara'
}
