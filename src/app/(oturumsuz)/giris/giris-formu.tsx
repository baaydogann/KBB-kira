'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { girisAction } from './actions'

export function GirisFormu() {
  const [durum, eylem, bekliyor] = useActionState(girisAction, BOS_FORM)
  return (
    <form action={eylem} className="space-y-4">
      <FormMesaji durum={durum} />
      <Alan etiket="Kullanıcı adı" ad="kullaniciAdi">
        <Girdi name="kullaniciAdi" autoComplete="username" defaultValue={durum.degerler?.kullaniciAdi} required autoFocus />
      </Alan>
      <Alan etiket="Şifre" ad="sifre">
        <Girdi name="sifre" type="password" autoComplete="current-password" required />
      </Alan>
      <Dugme type="submit" tur="birincil" className="w-full" disabled={bekliyor}>{bekliyor ? 'Giriş yapılıyor…' : 'Giriş yap'}</Dugme>
    </form>
  )
}
