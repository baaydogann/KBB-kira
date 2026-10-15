'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { tarihAyristir } from '@/core/tarih'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { hatirlatmaErtele, hatirlatmaTamamla } from '@/server/hatirlatma/servis'
import { genelAramaHedefi } from '@/server/kisi/arama'
import { kisiIbanIleBul, kisiKimlikIleBul } from '@/server/kisi/servis'
import { basariDurumu, formKimligi, formMetni, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function tamamlaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'id')
  if (id === null) return { hata: 'Kayıt seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    await hatirlatmaTamamla(id, formMetni(f, 'not'), await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/')
  return basariDurumu('Tamamlandı.')
}

export async function erteleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'id')
  if (id === null) return { hata: 'Kayıt seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    const tarih = tarihAyristir(formMetni(f, 'tarih'))
    if (!tarih.ok) throw new IsKuraliHatasi('TARIH', 'Erteleme tarihini seçin.', 'tarih')
    await hatirlatmaErtele(id, tarih.deger, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/')
  return basariDurumu('Ertelendi.')
}

/**
 * Üst çubuktaki genel arama (POST, KVKK): TCKN/VKN/IBAN adres satırına, tarayıcı geçmişine, günlüklere ve Referer başlığına
 * girmesin diye kimlik benzeri girdi burada çözülür ve yalnızca kişi kimliğiyle yönlendirilir (bkz. `genelAramaHedefi`).
 */
export async function araAction(f: FormData): Promise<void> {
  await kullaniciGerekli()
  redirect(await genelAramaHedefi(formMetni(f, 'q'), { kimlik: kisiKimlikIleBul, iban: kisiIbanIleBul }))
}
