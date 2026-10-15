/**
 * Kişi araması (KVKK, spec §16): TCKN/VKN adres satırına, tarayıcı geçmişine, günlüklere ve Referer başlığına
 * girmesin diye kimlik numarası aramaları POST ile yapılır ve yönlendirme adresine hiçbir zaman yazılmaz.
 */

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
