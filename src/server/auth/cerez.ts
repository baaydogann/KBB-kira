import { cookies } from 'next/headers'
import { ortam } from '../env'
import { OTURUM_MUTLAK_MS } from './oturum'

export const OTURUM_CEREZI = 'kbbkira_oturum'

/**
 * Çerez ömrü mutlak oturum süresidir; boşta kalma (8 sa) ve mutlak (24 sa) sınırları sunucuda,
 * oturum kaydı üzerinden uygulanır. Böylece kayan süre istemci tarafında kesilmez.
 */
export async function cerezYaz(token: string): Promise<void> {
  const depo = await cookies()
  depo.set(OTURUM_CEREZI, token, {
    httpOnly: true,
    secure: ortam().APP_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: OTURUM_MUTLAK_MS / 1000,
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
