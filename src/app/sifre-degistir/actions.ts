'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { istemciIp, sifreDegistir } from '@/server/auth/servis'
import { BOS_FORM, type FormDurumu } from '@/app/_lib/form'

export async function sifreDegistirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli({ sifreDegisimiSerbest: true })
  const eski = String(f.get('eski') ?? '')
  const yeni = String(f.get('yeni') ?? '')
  // Tek uyarı: yalnızca alan hatası (üstte aynı metinle ikinci bir uyarı gösterilmez).
  if (yeni !== String(f.get('yeniTekrar') ?? '')) return { ...BOS_FORM, alanHatalari: { yeniTekrar: 'Şifreler eşleşmiyor.' } }
  const r = await sifreDegistir({ kullaniciId: k.id, oturumId: k.oturumId, eski, yeni, ip: istemciIp(await headers()) })
  if (!r.ok) return { ...BOS_FORM, hata: r.mesaj }
  redirect('/')
}
