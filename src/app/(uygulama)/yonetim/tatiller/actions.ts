'use server'

import { revalidatePath } from 'next/cache'
import { tarihAyristir } from '@/core/tarih'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { BulunamadiHatasi } from '@/server/hata'
import { tatilEkle, tatilSil } from '@/server/tatil/servis'
import { basariDurumu, formDegerleri, formMetni, formSayi, formSecim, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function tatilEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const t = tarihAyristir(formMetni(f, 'tarih'))
  if (!t.ok) return { hata: t.hata.mesaj, alanHatalari: { tarih: t.hata.mesaj }, tamam: false, degerler: formDegerleri(f) }
  try {
    await tatilEkle({ tarih: t.deger, ad: formMetni(f, 'ad'), yarimGun: formSecim(f, 'yarimGun') }, await islemBaglami(k))
    revalidatePath('/yonetim/tatiller')
    return basariDurumu('Tatil eklendi.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}

export async function tatilSilAction(f: FormData): Promise<void> {
  const k = await kullaniciGerekli()
  const id = formSayi(f, 'id')
  if (id === null) return
  try {
    await tatilSil(id, await islemBaglami(k))
  } catch (e) {
    // Kayıt başka bir kullanıcı ya da eski bir sayfadan zaten silinmiş: istenen sonuç sağlanmış, hata sayfası gösterilmez.
    if (!(e instanceof BulunamadiHatasi)) throw e
  }
  revalidatePath('/yonetim/tatiller')
}
