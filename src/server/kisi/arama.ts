/**
 * Kişi araması (KVKK, spec §16): TCKN/VKN/IBAN adres satırına, tarayıcı geçmişine, günlüklere ve Referer başlığına
 * girmesin diye kimlik benzeri aramalar POST ile yapılır ve yönlendirme adresine hiçbir zaman yazılmaz. "Kimlik benzeri"
 * ölçütü tek yerdedir: `kimlikBenzeriMi` (sözleşme/arama.ts); kişi, sözleşme ve genel arama aynısını kullanır.
 */

import { ibanNormalize } from '@/core/dogrulama'
import { kimlikBenzeriMi } from '../sozlesme/arama'

/** Ortak IBAN sonucunda en çok kaç kişi listelenir (adres ve sayfa aynı sınırı uygular). */
export const ORTAK_IBAN_SINIRI = 20

/** Boşlukları atılmış 10 (VKN) veya 11 (TCKN) haneli arama metni; kimlik numarası gibi değilse null. Tam eşleşme aramasının tek girdisi. */
export function kimlikAramasi(q: string): string | null {
  const s = q.replace(/\s+/g, '')
  return /^\d{10,11}$/.test(s) ? s : null
}

/** Boşlukları atılmış, büyük harfli `TR` + 2 rakamla başlayan IBAN arama metni; IBAN gibi değilse null. */
function ibanAramasi(q: string): string | null {
  const s = ibanNormalize(q)
  return /^TR\d{2}/.test(s) ? s : null
}

/**
 * Arama kutusundan gelen metnin yönlendirileceği adres: kimlik numarası bulunursa kişi sayfası, bulunamazsa bildirim
 * adresi; aksi halde ad/unvan araması GET sorgusuyla (`?q=`). Kimlik benzeri girdi (metinli, tireli, noktalı, IBAN dahil)
 * hiçbir adreste yer almaz; yalnızca temiz 10/11 haneli numara aranır, diğerleri bulunamadı sayılır.
 */
export async function kisiAramaHedefi(q: string, kimlikIleBul: (kimlik: string) => Promise<number | null>): Promise<string> {
  if (kimlikBenzeriMi(q)) {
    const kimlik = kimlikAramasi(q)
    const id = kimlik === null ? null : await kimlikIleBul(kimlik)
    return id === null ? '/kisiler?bulunamadi=1' : `/kisiler/${id}`
  }
  const ad = q.trim()
  return ad ? `/kisiler?q=${encodeURIComponent(ad)}` : '/kisiler'
}

/** Kimlik numarası ya da IBAN'dan kişi kimliklerini bulan aramalar (tam eşleşme). IBAN ortak hesapta birden çok kişide olabilir. */
export interface KimlikBulucular {
  kimlik: (kimlik: string) => Promise<number | null>
  iban: (iban: string) => Promise<number[]>
}

/**
 * Üst çubuktaki genel arama kutusunun (POST) yönlendireceği adres. Kimlik benzeri girdi (`kimlikBenzeriMi`) çözülür ve
 * yalnızca kişi kimlikleriyle yönlendirilir: tek kişi `/kisiler/<id>`, ortak IBAN `/ara?kisiler=3,7`, bulunamayan
 * `/ara?bulunamadi=1`. Kimlik numarası bu adreslerin hiçbirinde yer almaz. Yalnızca temiz 10/11 haneli numara ve `TR`
 * ile başlayan IBAN çözülür; başka metin ya da ayraç içeren kimlik benzeri girdi bulunamadı sayılır. Diğer girdi
 * `/ara?q=` ile gider.
 */
export async function genelAramaHedefi(q: string, bul: KimlikBulucular): Promise<string> {
  if (kimlikBenzeriMi(q)) {
    const kimlik = kimlikAramasi(q)
    const iban = kimlik === null ? ibanAramasi(q) : null
    let idler: number[] = []
    if (kimlik !== null) {
      const id = await bul.kimlik(kimlik)
      idler = id === null ? [] : [id]
    } else if (iban !== null) {
      idler = await bul.iban(iban)
    }
    const [ilk] = idler
    if (ilk === undefined) return '/ara?bulunamadi=1'
    if (idler.length === 1) return `/kisiler/${ilk}`
    return `/ara?kisiler=${idler.slice(0, ORTAK_IBAN_SINIRI).join(',')}`
  }
  const ad = q.trim()
  return ad ? `/ara?q=${encodeURIComponent(ad)}` : '/ara'
}

const EN_BUYUK_KIMLIK = 2_147_483_647

/**
 * `/ara?kisiler=3,7` parametresindeki kişi kimlikleri. Katı: her parça ondalık rakamlardan oluşan, PostgreSQL INTEGER
 * aralığında pozitif tamsayı olmalı (bkz. `yolKimligi`); biri bozuksa hiçbir kimlik döndürülmez. Tekrarlar atılır, en çok
 * `ORTAK_IBAN_SINIRI` kimlik alınır.
 */
export function kisiKimlikListesi(ham: string | string[] | undefined): number[] {
  if (typeof ham !== 'string' || ham === '') return []
  const idler: number[] = []
  for (const parca of ham.split(',')) {
    if (!/^\d+$/.test(parca)) return []
    const n = Number(parca)
    if (!Number.isSafeInteger(n) || n < 1 || n > EN_BUYUK_KIMLIK) return []
    if (!idler.includes(n)) idler.push(n)
  }
  return idler.slice(0, ORTAK_IBAN_SINIRI)
}
