'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { kullaniciEkleAction, sifreSifirlaAction } from './actions'

export function KullaniciFormu() {
  const [durum, eylem, bekliyor] = useActionState(kullaniciEkleAction, BOS_FORM)
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-4">
      <div className="md:col-span-4"><FormMesaji durum={durum} /></div>
      <Alan etiket="Kullanıcı adı" ad="kullaniciAdi" hata={durum.alanHatalari.kullaniciAdi}>
        <Girdi name="kullaniciAdi" autoComplete="off" defaultValue={durum.degerler?.kullaniciAdi} required />
      </Alan>
      <Alan etiket="Ad soyad" ad="adSoyad" hata={durum.alanHatalari.adSoyad}>
        <Girdi name="adSoyad" autoComplete="off" defaultValue={durum.degerler?.adSoyad} required />
      </Alan>
      <Alan etiket="Geçici şifre" ad="geciciSifre" hata={durum.alanHatalari.geciciSifre} ipucu="En az 12 karakter">
        <Girdi name="geciciSifre" type="password" autoComplete="new-password" minLength={12} required />
      </Alan>
      <div className="flex items-end"><Dugme type="submit" tur="birincil" disabled={bekliyor}>Kullanıcı ekle</Dugme></div>
    </form>
  )
}

export function SifreSifirlaFormu({ id }: { id: number }) {
  const [durum, eylem, bekliyor] = useActionState(sifreSifirlaAction, BOS_FORM)
  return (
    <form action={eylem} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {/* Tabloda her satırda bir form var: Girdi'nin varsayılan kimliği (name) satırlar arasında çakışırdı. */}
      <Girdi id={`geciciSifre-${id}`} name="geciciSifre" type="password" autoComplete="new-password" placeholder="Yeni geçici şifre" minLength={12} required className="w-44" aria-label="Yeni geçici şifre" />
      <Dugme type="submit" disabled={bekliyor}>Sıfırla</Dugme>
      {durum.hata ? <span role="alert" className="text-xs text-red-600">{durum.hata}</span> : durum.mesaj ? <span role="status" className="text-xs text-green-700">{durum.mesaj}</span> : null}
    </form>
  )
}
