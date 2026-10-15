import { NextResponse, type NextRequest } from 'next/server'
import { formKimligi } from '@/app/_lib/form'
import { kullaniciGetir } from '@/server/auth/gerekli'
import { istemciIp } from '@/server/auth/servis'
import { BELGE_AZAMI_BAYT, SAHIP_TURLERI, belgeKaydet, type BelgeTuru, type SahipTur } from '@/server/belge/servis'
import { IsKuraliHatasi } from '@/server/hata'

export const dynamic = 'force-dynamic'

const BELGE_TURLERI: readonly BelgeTuru[] = ['SOZLESME', 'TAPU', 'ONAY_BELGESI', 'PIYASA_ARASTIRMA', 'BORC_YAZISI', 'FATURA', 'EK_PROTOKOL', 'MAHKEME_KARARI', 'DAMGA_MAKBUZU', 'DIGER']
// Çok parçalı gövde, dosyanın üstüne sınır çizgileri ve alan başlıkları taşır.
const AZAMI_GOVDE_BAYT = BELGE_AZAMI_BAYT + 1024 * 1024

const hata = (mesaj: string, status: number) => NextResponse.json({ hata: mesaj }, { status })

/** CSRF: yükleme yalnızca uygulamanın kendi sayfasından gelir. "null" ya da bozuk Origin da reddedilir. */
function ayniKaynakMi(istek: NextRequest): boolean {
  const origin = istek.headers.get('origin')
  const host = istek.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Gövdeyi en çok `azami` bayt okur; aşılırsa okumayı bırakıp null döner (Content-Length bildirmeyen ya da yanıltan istemciye karşı). */
async function govdeyiSinirliOku(istek: NextRequest, azami: number): Promise<Blob | null> {
  if (!istek.body) return new Blob([])
  const okuyucu = istek.body.getReader()
  const parcalar: Uint8Array<ArrayBuffer>[] = []
  let toplam = 0
  for (;;) {
    const { done, value } = await okuyucu.read()
    if (done) return new Blob(parcalar)
    toplam += value.byteLength
    if (toplam > azami) {
      await okuyucu.cancel()
      return null
    }
    parcalar.push(value)
  }
}

export async function POST(istek: NextRequest) {
  const k = await kullaniciGetir()
  if (!k) return hata('Oturum gerekli.', 401)
  if (!ayniKaynakMi(istek)) return hata('Geçersiz kaynak.', 403)
  const bildirilen = Number(istek.headers.get('content-length'))
  if (Number.isFinite(bildirilen) && bildirilen > AZAMI_GOVDE_BAYT) return hata('Dosya 50 MB sınırını aşıyor.', 413)
  const govde = await govdeyiSinirliOku(istek, AZAMI_GOVDE_BAYT)
  if (!govde) return hata('Dosya 50 MB sınırını aşıyor.', 413)
  let form: FormData
  try {
    form = await new Response(govde, { headers: { 'content-type': istek.headers.get('content-type') ?? '' } }).formData()
  } catch {
    return hata('İstek gövdesi çözümlenemedi.', 400)
  }
  const dosya = form.get('dosya')
  const sahipTur = String(form.get('sahipTur') ?? '') as SahipTur
  const belgeTuru = String(form.get('belgeTuru') ?? '') as BelgeTuru
  // Geçici belgenin sahibi her zaman yükleyendir; istemcinin gönderdiği sahipId yok sayılır.
  const sahipId = sahipTur === 'gecici' ? k.id : formKimligi(form, 'sahipId')
  if (!(dosya instanceof File) || !SAHIP_TURLERI.includes(sahipTur) || !BELGE_TURLERI.includes(belgeTuru) || sahipId === null) {
    return hata('Eksik veya hatalı alan.', 400)
  }
  try {
    const id = await belgeKaydet(
      { sahipTur, sahipId, belgeTuru, dosyaAdi: dosya.name, icerik: new Uint8Array(await dosya.arrayBuffer()) },
      { kullaniciId: k.id, ip: istemciIp(istek.headers) },
    )
    return NextResponse.json({ id })
  } catch (e) {
    if (e instanceof IsKuraliHatasi) return hata(e.message, 422)
    throw e
  }
}
