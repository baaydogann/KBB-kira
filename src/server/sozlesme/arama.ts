import type { SozlesmeDurumu } from '@/generated/prisma'

/**
 * Sözleşme listesi araması (KVKK, spec §16; kişi aramasıyla aynı kural, bkz. kisi/arama.ts): TCKN/VKN/IBAN adres
 * satırına, tarayıcı geçmişine, günlüklere ve Referer başlığına girmesin diye arama formu POST'tur ve kimlik
 * numarasına benzeyen girdi hiçbir hedef adreste yer almaz.
 */
export const SOZLESME_DURUMLARI: readonly SozlesmeDurumu[] = ['TASLAK', 'AKTIF', 'UZADI', 'FESHEDILDI', 'SONA_ERDI']

/**
 * Boşluk, nokta ve tire (her türlü) atıldıktan sonra metnin herhangi bir yerinde 10 ya da daha uzun ardışık rakam dizisi
 * kalıyorsa (TCKN/VKN, ayraçlı ya da başka metinle yazılmış numara, çıplak BBAN) ya da metin `TR` + iki rakamla
 * başlıyorsa (IBAN) kimlik benzeridir. Ada/parsel (`123/45`), tarih ve sözleşme no gibi kısa rakam dizileri değildir.
 */
export function kimlikBenzeriMi(q: string): boolean {
  const s = q.replace(/[\s.\-‐-―−]+/g, '')
  return /\d{10}/.test(s) || /^TR\d{2}/i.test(s)
}

/**
 * Arama kutusundan gelen metnin yönlendirileceği adres: kimlik numarasına benzeyen girdi bildirim adresine gider (değer
 * adrese yazılmaz); aksi halde sözleşme no/taşınmaz araması `?q=` ile, geçerli bir durum süzgeci varsa `&durum=` ile.
 */
export function sozlesmeAramaHedefi(q: string, durum: string): string {
  if (kimlikBenzeriMi(q)) return '/sozlesmeler?kimlik=1'
  const parcalar: string[] = []
  const ad = q.trim()
  if (ad) parcalar.push(`q=${encodeURIComponent(ad)}`)
  if ((SOZLESME_DURUMLARI as readonly string[]).includes(durum)) parcalar.push(`durum=${durum}`)
  return parcalar.length ? `/sozlesmeler?${parcalar.join('&')}` : '/sozlesmeler'
}
