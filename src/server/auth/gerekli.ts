import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { IslemBaglami } from '../baglam'
import { cerezOku } from './cerez'
import { oturumDogrula, type OturumKullanicisi } from './oturum'
import { istemciIp } from './servis'

interface Secenekler {
  sifreDegisimiSerbest?: boolean
}

async function cerezdenOturum(): Promise<{ token: string | null; kullanici: OturumKullanicisi | null }> {
  const token = await cerezOku()
  return { token, kullanici: token ? await oturumDogrula(token) : null }
}

/** Zorunlu şifre değişimi bekleyen kullanıcı, değişim ekranı dışında oturumsuz sayılır. */
const sifreDegisimiBekliyor = (k: OturumKullanicisi, s: Secenekler): boolean => k.sifreDegismeli && !s.sifreDegisimiSerbest

export async function kullaniciGetir(s: Secenekler = {}): Promise<OturumKullanicisi | null> {
  const { kullanici } = await cerezdenOturum()
  return kullanici && !sifreDegisimiBekliyor(kullanici, s) ? kullanici : null
}

/** Oturum yoksa girişe, şifre değişimi zorunluysa değişim ekranına yönlendirir. */
export async function kullaniciGerekli(s: Secenekler = {}): Promise<OturumKullanicisi> {
  const { token, kullanici } = await cerezdenOturum()
  if (!kullanici) redirect(token ? '/giris?oturum=kapandi' : '/giris')
  if (sifreDegisimiBekliyor(kullanici, s)) redirect('/sifre-degistir')
  return kullanici
}

export async function islemBaglami(k: OturumKullanicisi): Promise<IslemBaglami> {
  return { kullaniciId: k.id, ip: istemciIp(await headers()) }
}
