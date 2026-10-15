import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { IslemBaglami } from '../baglam'
import { cerezOku } from './cerez'
import { oturumDogrula, type OturumKullanicisi } from './oturum'
import { istemciIp } from './servis'

export async function kullaniciGetir(): Promise<OturumKullanicisi | null> {
  const token = await cerezOku()
  return token ? oturumDogrula(token) : null
}

/** Oturum yoksa girişe, şifre değişimi zorunluysa değişim ekranına yönlendirir. */
export async function kullaniciGerekli(s: { sifreDegisimiSerbest?: boolean } = {}): Promise<OturumKullanicisi> {
  const token = await cerezOku()
  const k = token ? await oturumDogrula(token) : null
  if (!k) redirect(token ? '/giris?oturum=kapandi' : '/giris')
  if (k.sifreDegismeli && !s.sifreDegisimiSerbest) redirect('/sifre-degistir')
  return k
}

export async function islemBaglami(k: OturumKullanicisi): Promise<IslemBaglami> {
  return { kullaniciId: k.id, ip: istemciIp(await headers()) }
}
