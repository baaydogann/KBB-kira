import { cookies } from 'next/headers'

export const OTURUM_CEREZI = 'kbbkira_oturum'

export async function cerezYaz(token: string, bitis: Date): Promise<void> {
  const depo = await cookies()
  depo.set(OTURUM_CEREZI, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: bitis,
  })
}

export async function cerezSil(): Promise<void> {
  const depo = await cookies()
  depo.delete(OTURUM_CEREZI)
}

export async function cerezOku(): Promise<string | null> {
  const depo = await cookies()
  return depo.get(OTURUM_CEREZI)?.value ?? null
}
