import { yolKimligi } from '@/app/_lib/form'
import { indirmeYaniti } from '@/app/api/_lib/indirme'
import { islemBaglami, kullaniciGetir } from '@/server/auth/gerekli'
import { BulunamadiHatasi, IsKuraliHatasi } from '@/server/hata'
import { paketBelgeleriPdf } from '@/server/paket/cikti'

export const dynamic = 'force-dynamic'

/** Paket belgeleri PDF'i (föy ve ek listesi; Görev 13 ile pusula, fiş ve artış tablosu). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const k = await kullaniciGetir()
  if (!k) return new Response('Oturum gerekli.', { status: 401 })
  const id = yolKimligi((await params).id)
  if (id === null) return new Response('Paket bulunamadı.', { status: 404 })
  try {
    const { dosyaAdi, icerik } = await paketBelgeleriPdf(id, await islemBaglami(k))
    return indirmeYaniti(icerik, dosyaAdi, 'pdf')
  } catch (e) {
    if (e instanceof BulunamadiHatasi) return new Response('Paket bulunamadı.', { status: 404 })
    if (e instanceof IsKuraliHatasi) return new Response(e.message, { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    throw e
  }
}
