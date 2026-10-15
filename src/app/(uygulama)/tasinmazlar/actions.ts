'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { tasinmazSemasi } from '@/server/tasinmaz/sema'
import { tasinmazKaydet } from '@/server/tasinmaz/servis'
import { formKimligi, formMetni, formSurum, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function tasinmazKaydetAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const g = tasinmazSemasi.parse(Object.fromEntries(f))
    const mevcutId = formKimligi(f, 'id') ?? undefined
    // Dolu ama bozuk bir kimlik "yeni kayıt" gibi işlenmez.
    if (mevcutId === undefined && formMetni(f, 'id') !== '') throw new IsKuraliHatasi('ID', 'Kayıt kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    id = await tasinmazKaydet(g, await islemBaglami(k), mevcutId, formSurum(f))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/tasinmazlar')
  redirect(`/tasinmazlar/${id}`)
}
