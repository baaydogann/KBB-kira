'use server'

import { revalidatePath } from 'next/cache'
import { bugunIstanbul } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { ISLER, isAdiMi } from '@/server/isler'
import { isCalistir } from '@/server/isler/kayit'
import { basariDurumu, formMetni, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function isCalistirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  await kullaniciGerekli()
  const ad = formMetni(f, 'is')
  if (!isAdiMi(ad)) return { hata: 'Bilinmeyen iş.', alanHatalari: {}, tamam: false }
  try {
    const durum = await isCalistir(ad, () => ISLER[ad](bugunIstanbul()))
    revalidatePath('/yonetim/isler')
    revalidatePath('/')
    return durum === 'HATALI' ? { hata: 'İş hatayla bitti; ayrıntı aşağıdaki listede.', alanHatalari: {}, tamam: false } : basariDurumu(`İş bitti: ${durum}`)
  } catch (e) {
    return hataDurumu(e, f)
  }
}
