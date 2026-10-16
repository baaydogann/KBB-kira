export type IndirmeTuru = 'pdf' | 'xlsx' | 'csv'

const ICERIK_TURU: Record<IndirmeTuru, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
}

/** RFC 5987: encodeURIComponent'in bıraktığı ' ( ) * karakterleri de yüzde kodlanır (attr-char dışıdırlar). */
const dosyaAdiKodla = (ad: string): string => encodeURIComponent(ad).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** Kişisel veri taşıyan çıktı indirmesi: ek olarak indirilir, önbelleğe alınmaz, içerik türü tahmin edilmez. */
export function indirmeYaniti(icerik: Uint8Array | string, dosyaAdi: string, tur: IndirmeTuru): Response {
  const govde = typeof icerik === 'string' ? icerik : new Uint8Array(icerik)
  return new Response(govde, {
    headers: {
      'Content-Type': ICERIK_TURU[tur],
      'Content-Disposition': `attachment; filename*=UTF-8''${dosyaAdiKodla(dosyaAdi)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
