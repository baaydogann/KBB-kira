'use server'

import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { birimSemasi } from '@/server/birim/sema'
import { birimKaydet } from '@/server/birim/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { basariDurumu, formKimligi, formMetni, formSurum, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function birimKaydetAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  try {
    const g = birimSemasi.parse(Object.fromEntries(f))
    const id = formKimligi(f, 'id') ?? undefined
    // Dolu ama bozuk bir kimlik "yeni kayıt" gibi işlenmez.
    if (id === undefined && formMetni(f, 'id') !== '') throw new IsKuraliHatasi('ID', 'Kayıt kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    await birimKaydet(g, await islemBaglami(k), id, formSurum(f))
    revalidatePath('/birimler')
    return basariDurumu('Birim kaydedildi.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}
