'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cerezYaz } from '@/server/auth/cerez'
import { girisYap, istemciIp } from '@/server/auth/servis'
import { BOS_FORM, formMetni, type FormDurumu } from '@/app/_lib/form'

export async function girisAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const kullaniciAdi = formMetni(f, 'kullaniciAdi')
  const sifre = typeof f.get('sifre') === 'string' ? String(f.get('sifre')) : ''
  // Hata durumunda yalnızca kullanıcı adı forma geri verilir; şifre asla.
  const hata = (mesaj: string): FormDurumu => ({ ...BOS_FORM, hata: mesaj, degerler: { kullaniciAdi } })
  if (!kullaniciAdi || !sifre) return hata('Kullanıcı adı ve şifre zorunludur.')
  const h = await headers()
  const r = await girisYap({ kullaniciAdi, sifre, ip: istemciIp(h), userAgent: h.get('user-agent') })
  if (!r.ok) {
    if (r.neden === 'KILITLI' && r.kilitBitis) {
      const saat = r.kilitBitis.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
      return hata(`Çok fazla hatalı deneme. Hesap ${saat} saatine kadar kilitli.`)
    }
    if (r.neden === 'HIZ_SINIRI') return hata('Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.')
    return hata('Kullanıcı adı veya şifre hatalı.')
  }
  await cerezYaz(r.token) // controller kararı (Task 14): çerez mutlak ömürlü, süreyi sunucu uygular
  redirect(r.sifreDegismeli ? '/sifre-degistir' : '/')
}
