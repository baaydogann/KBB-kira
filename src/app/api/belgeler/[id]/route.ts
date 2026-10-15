import { yolKimligi } from '@/app/_lib/form'
import { islemBaglami, kullaniciGetir } from '@/server/auth/gerekli'
import { BelgeDosyasiHatasi, belgeAkisiAc } from '@/server/belge/servis'
import { BulunamadiHatasi } from '@/server/hata'

export const dynamic = 'force-dynamic'

/** RFC 5987: encodeURIComponent'in bıraktığı ' ( ) * karakterleri de yüzde kodlanır (attr-char dışıdırlar). */
const dosyaAdiKodla = (ad: string): string => encodeURIComponent(ad).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const k = await kullaniciGetir()
  if (!k) return new Response('Oturum gerekli.', { status: 401 })
  const id = yolKimligi((await params).id)
  if (id === null) return new Response('Belge bulunamadı.', { status: 404 })
  try {
    const { belge, akis } = await belgeAkisiAc(id, await islemBaglami(k))
    return new Response(akis, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(belge.boyut),
        'Content-Disposition': `inline; filename*=UTF-8''${dosyaAdiKodla(belge.dosyaAdi)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e) {
    if (e instanceof BulunamadiHatasi) return new Response('Belge bulunamadı.', { status: 404 })
    if (e instanceof BelgeDosyasiHatasi) {
      // Ham hata (ENOENT + yol) yalnızca sunucu günlüğüne, o da kimlikle ve kodla; istemciye genel mesaj gider.
      console.error(`Belge dosyası okunamadı: belgeId=${e.belgeId} neden=${e.kod}`)
      return new Response('Belge dosyasına şu anda erişilemiyor. Sistem yöneticisine bildirin.', { status: 500 })
    }
    throw e
  }
}
