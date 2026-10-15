'use server'

import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { kullaniciAktiflik, kullaniciOlustur, sifreSifirla } from '@/server/kullanici/servis'
import { basariDurumu, formMetni, formSayi, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function kullaniciEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  try {
    await kullaniciOlustur({ kullaniciAdi: formMetni(f, 'kullaniciAdi'), adSoyad: formMetni(f, 'adSoyad'), geciciSifre: String(f.get('geciciSifre') ?? '') }, await islemBaglami(k))
    revalidatePath('/yonetim/kullanicilar')
    return basariDurumu('Kullanıcı oluşturuldu. Geçici şifreyi kişiye güvenli kanaldan iletin.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}

export async function aktiflikAction(f: FormData): Promise<void> {
  const k = await kullaniciGerekli()
  const id = formSayi(f, 'id')
  if (id === null) return
  await kullaniciAktiflik(id, f.get('aktif') === 'true', await islemBaglami(k))
  revalidatePath('/yonetim/kullanicilar')
}

export async function sifreSifirlaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formSayi(f, 'id')
  if (id === null) return { hata: 'Kullanıcı seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    await sifreSifirla(id, String(f.get('geciciSifre') ?? ''), await islemBaglami(k))
    return basariDurumu('Şifre sıfırlandı; kullanıcının açık oturumları kapatıldı.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}
