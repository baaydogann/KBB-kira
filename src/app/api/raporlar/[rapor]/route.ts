import { indirmeYaniti } from '@/app/api/_lib/indirme'
import { bugunIstanbul } from '@/core/tarih'
import { islemBaglami, kullaniciGetir } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { raporIndir } from '@/server/rapor/indir'

export const dynamic = 'force-dynamic'

/** Rapor indirme: `?ay=YYYY-MM&bicim=xlsx|csv`. Bilinmeyen rapor 404, hatalı parametre 400. */
export async function GET(istek: Request, { params }: { params: Promise<{ rapor: string }> }) {
  const k = await kullaniciGetir()
  if (!k) return new Response('Oturum gerekli.', { status: 401 })
  try {
    const sonuc = await raporIndir((await params).rapor, new URL(istek.url).searchParams, await islemBaglami(k), bugunIstanbul())
    if (sonuc === null) return new Response('Rapor bulunamadı.', { status: 404 })
    return indirmeYaniti(sonuc.icerik, sonuc.dosyaAdi, sonuc.tur)
  } catch (e) {
    if (e instanceof IsKuraliHatasi) return new Response(e.message, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    throw e
  }
}
