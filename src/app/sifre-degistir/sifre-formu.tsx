'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { sifreDegistirAction } from './actions'

export function SifreFormu() {
  const [durum, eylem, bekliyor] = useActionState(sifreDegistirAction, BOS_FORM)
  return (
    <form action={eylem} className="space-y-4">
      <FormMesaji durum={durum} />
      <Alan etiket="Mevcut şifre" ad="eski"><Girdi name="eski" type="password" autoComplete="current-password" required /></Alan>
      <Alan etiket="Yeni şifre" ad="yeni" ipucu="En az 12 karakter."><Girdi name="yeni" type="password" autoComplete="new-password" minLength={12} required /></Alan>
      <Alan etiket="Yeni şifre (tekrar)" ad="yeniTekrar" hata={durum.alanHatalari.yeniTekrar}><Girdi name="yeniTekrar" type="password" autoComplete="new-password" required /></Alan>
      <Dugme type="submit" tur="birincil" className="w-full" disabled={bekliyor}>Şifreyi değiştir</Dugme>
    </form>
  )
}
