import { yolKimligi } from '@/app/_lib/form'
import { indirmeYaniti } from '@/app/api/_lib/indirme'
import { islemBaglami, kullaniciGetir } from '@/server/auth/gerekli'
import { BulunamadiHatasi, IsKuraliHatasi } from '@/server/hata'
import { denetimDosyasiPdf } from '@/server/rapor/denetim-dosyasi'

export const dynamic = 'force-dynamic'

/** Sözleşme denetim dosyası (PDF); taslak sözleşmede 409. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const k = await kullaniciGetir()
  if (!k) return new Response('Oturum gerekli.', { status: 401 })
  const id = yolKimligi((await params).id)
  if (id === null) return new Response('Sözleşme bulunamadı.', { status: 404 })
  try {
    const { dosyaAdi, icerik } = await denetimDosyasiPdf(id, await islemBaglami(k))
    return indirmeYaniti(icerik, dosyaAdi, 'pdf')
  } catch (e) {
    if (e instanceof BulunamadiHatasi) return new Response('Sözleşme bulunamadı.', { status: 404 })
    if (e instanceof IsKuraliHatasi) return new Response(e.message, { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    throw e
  }
}
