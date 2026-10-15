'use server'

import { redirect } from 'next/navigation'
import { cerezOku, cerezSil } from '@/server/auth/cerez'
import { oturumKapat } from '@/server/auth/oturum'

export async function cikisAction(): Promise<void> {
  const token = await cerezOku()
  if (token) await oturumKapat(token)
  await cerezSil()
  redirect('/giris')
}
