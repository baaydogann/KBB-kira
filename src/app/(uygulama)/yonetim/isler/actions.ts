'use server'

import { revalidatePath } from 'next/cache'
import { bugunIstanbul } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { ISLER, isAdiMi } from '@/server/isler'
import { isCalistirAyrintili } from '@/server/isler/kayit'
import { BASKA_CALISMA_MESAJI } from '@/server/isler/tek-kopya'
import { basariDurumu, formMetni, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function isCalistirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  await kullaniciGerekli()
  const ad = formMetni(f, 'is')
  if (!isAdiMi(ad)) return { hata: 'Bilinmeyen iş.', alanHatalari: {}, tamam: false }
  try {
    const r = await isCalistirAyrintili(ad, () => ISLER[ad](bugunIstanbul()))
    revalidatePath('/yonetim/isler')
    revalidatePath('/')
    if (r.durum === 'HATALI') return { hata: 'İş hatayla bitti; ayrıntı aşağıdaki listede.', alanHatalari: {}, tamam: false }
    // Atlanma nedeni gösterilir: başka bir çalışma sürüyor (worker ya da başka bir kullanıcı) ya da EVDS anahtarı tanımlı değil.
    if (r.durum === 'ATLANDI') return { hata: r.ozet ?? BASKA_CALISMA_MESAJI, alanHatalari: {}, tamam: false }
    return basariDurumu(`İş bitti: ${r.durum}`)
  } catch (e) {
    return hataDurumu(e, f)
  }
}
