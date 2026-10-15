'use server'

import { revalidatePath } from 'next/cache'
import { tarihAyristir } from '@/core/tarih'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { parametreEkle } from '@/server/parametre/servis'
import { basariDurumu, formDegerleri, formMetni, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function parametreEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const bas = tarihAyristir(formMetni(f, 'yururlukBaslangic'))
  if (!bas.ok) return { hata: bas.hata.mesaj, alanHatalari: { yururlukBaslangic: bas.hata.mesaj }, tamam: false, degerler: formDegerleri(f) }
  const bitisMetni = formMetni(f, 'yururlukBitis')
  const bit = bitisMetni ? tarihAyristir(bitisMetni) : null
  if (bit && !bit.ok) return { hata: bit.hata.mesaj, alanHatalari: { yururlukBitis: bit.hata.mesaj }, tamam: false, degerler: formDegerleri(f) }
  try {
    await parametreEkle({
      anahtar: formMetni(f, 'anahtar').toUpperCase(), deger: formMetni(f, 'deger'),
      yururlukBaslangic: bas.deger, yururlukBitis: bit && bit.ok ? bit.deger : null,
      mevzuatDayanagi: formMetni(f, 'mevzuatDayanagi') || null, aciklama: formMetni(f, 'aciklama') || null,
    }, await islemBaglami(k))
    revalidatePath('/yonetim/parametreler')
    return basariDurumu('Parametre eklendi. Önceki açık kayıt varsa bir gün öncesinde kapatıldı.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}
