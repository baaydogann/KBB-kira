'use server'

import { revalidatePath } from 'next/cache'
import { oranAyristir } from '@/core/para'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { endeksElleGir, endeksOnayla, oranSerisiMi } from '@/server/endeks/servis'
import { basariDurumu, formDegerleri, formKimligi, formMetni, hataDurumu, type FormDurumu } from '@/app/_lib/form'

const alanHatasi = (f: FormData, alan: string, mesaj: string): FormDurumu =>
  ({ hata: mesaj, alanHatalari: { [alan]: mesaj }, tamam: false, degerler: formDegerleri(f) })

export async function endeksOnaylaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'id')
  if (id === null) return { hata: 'Kayıt seçilmedi.', alanHatalari: {}, tamam: false, degerler: formDegerleri(f) }
  const metin = formMetni(f, 'resmiDeger')
  const resmi = metin ? oranAyristir(metin) : null
  if (resmi && !resmi.ok) return alanHatasi(f, 'resmiDeger', resmi.hata.mesaj)
  try {
    await endeksOnayla(id, resmi && resmi.ok ? resmi.deger : null, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/endeksler')
  return basariDurumu('Endeks onaylandı.')
}

export async function endeksElleGirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const seri = formMetni(f, 'seri')
  if (!oranSerisiMi(seri)) return alanHatasi(f, 'seri', 'Geçerli bir seri seçin.')
  const ay = /^(\d{4})-(\d{2})$/.exec(formMetni(f, 'ay'))
  if (!ay) return alanHatasi(f, 'ay', 'Ayı yyyy-aa biçiminde seçin (ör. 2026-09).')
  const deger = oranAyristir(formMetni(f, 'deger'))
  if (!deger.ok) return alanHatasi(f, 'deger', deger.hata.mesaj)
  try {
    await endeksElleGir({ seri, ay: { yil: Number(ay[1]), ay: Number(ay[2]) }, deger: deger.deger }, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/endeksler')
  return basariDurumu('Değer onaylı olarak kaydedildi.')
}
