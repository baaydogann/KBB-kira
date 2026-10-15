import { yolKimligi } from '@/app/_lib/form'
import { kullaniciGetir } from '@/server/auth/gerekli'
import { belgeOku } from '@/server/belge/servis'
import { BulunamadiHatasi } from '@/server/hata'

export const dynamic = 'force-dynamic'

/** RFC 5987: encodeURIComponent'in bıraktığı ' ( ) * karakterleri de yüzde kodlanır (attr-char dışıdırlar). */
const dosyaAdiKodla = (ad: string): string => encodeURIComponent(ad).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await kullaniciGetir())) return new Response('Oturum gerekli.', { status: 401 })
  const id = yolKimligi((await params).id)
  if (id === null) return new Response('Belge bulunamadı.', { status: 404 })
  try {
    const { belge, icerik } = await belgeOku(id)
    return new Response(new Uint8Array(icerik), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${dosyaAdiKodla(belge.dosyaAdi)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    if (e instanceof BulunamadiHatasi) return new Response('Belge bulunamadı.', { status: 404 })
    throw e
  }
}
