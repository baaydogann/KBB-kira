import { takvimIcerigi } from '@/server/takvim/servis'

export const dynamic = 'force-dynamic'

// Token adres yolundadır (takvim istemcileri başlık gönderemez). Bu nedenle: yanıtlar önbelleğe alınmaz, token günlüğe yazılmaz
// (burada ve geliştirme sunucusunun istek günlüğünde: next.config.ts `logging.incomingRequests.ignore`), Referrer-Policy same-origin'dir.
const ONBELLEKSIZ = 'private, no-store'

/** Bilinmeyen, yenilenmiş/iptal edilmiş token, pasif kullanıcı ve biçimsiz adres için aynı yanıt: durumlar ayırt edilemez. */
const bulunamadi = (): Response => new Response('Bulunamadı', { status: 404, headers: { 'Cache-Control': ONBELLEKSIZ } })

export async function GET(_: Request, { params }: { params: Promise<{ dosya: string }> }) {
  const { dosya } = await params
  if (!dosya.endsWith('.ics')) return bulunamadi()
  const ics = await takvimIcerigi(dosya.slice(0, -4))
  if (ics === null) return bulunamadi()
  return new Response(ics, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': ONBELLEKSIZ, 'Content-Disposition': 'inline; filename="kbb-kira.ics"' },
  })
}
