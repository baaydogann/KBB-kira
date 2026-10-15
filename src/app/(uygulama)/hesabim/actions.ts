'use server'

import { hataDurumu } from '@/app/_lib/form'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { icsTokenIptal, icsTokenUret, takvimUrl } from '@/server/takvim/servis'

const HATA_YEDEGI = 'İşlem tamamlanamadı; tekrar deneyin.'

// Oturum kontrolü try dışındadır: yönlendirme (redirect) hata sayılmaz. Düz token yalnızca dönüş değerindedir; günlüğe/denetime yazılmaz.
export async function takvimBaglantisiUretAction(): Promise<{ url: string } | { hata: string }> {
  const k = await kullaniciGerekli()
  try {
    return { url: takvimUrl(await icsTokenUret(k.id, await islemBaglami(k))) }
  } catch (e) {
    return { hata: hataDurumu(e).hata ?? HATA_YEDEGI }
  }
}

export async function takvimBaglantisiIptalAction(): Promise<{ hata: string } | null> {
  const k = await kullaniciGerekli()
  try {
    await icsTokenIptal(k.id, await islemBaglami(k))
    return null
  } catch (e) {
    return { hata: hataDurumu(e).hata ?? HATA_YEDEGI }
  }
}
