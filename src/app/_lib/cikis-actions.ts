'use server'

import { redirect } from 'next/navigation'
import { cerezOku, cerezSil } from '@/server/auth/cerez'
import { oturumKapat } from '@/server/auth/oturum'

// Oturum gerektirmez: hem uygulama kabuğundan hem zorunlu şifre değiştirme ekranından çağrılır.
export async function cikisAction(): Promise<void> {
  const token = await cerezOku()
  if (token) await oturumKapat(token)
  await cerezSil()
  redirect('/giris')
}
