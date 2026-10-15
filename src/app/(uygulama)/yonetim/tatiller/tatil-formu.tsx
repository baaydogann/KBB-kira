'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { tatilEkleAction } from './actions'

export function TatilFormu() {
  const [durum, eylem, bekliyor] = useActionState(tatilEkleAction, BOS_FORM)
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-4">
      <div className="md:col-span-4"><FormMesaji durum={durum} /></div>
      <Alan etiket="Tarih" ad="tarih" hata={durum.alanHatalari.tarih}>
        <Girdi name="tarih" placeholder="gg.aa.yyyy" autoComplete="off" defaultValue={durum.degerler?.tarih} required />
      </Alan>
      <Alan etiket="Ad" ad="ad" hata={durum.alanHatalari.ad}>
        <Girdi name="ad" autoComplete="off" defaultValue={durum.degerler?.ad} required />
      </Alan>
      <label className="flex items-end gap-2 text-sm">
        <input type="checkbox" name="yarimGun" defaultChecked={durum.degerler?.yarimGun === 'on'} /> Yarım gün (arife)
      </label>
      <div className="flex items-end"><Dugme type="submit" tur="birincil" disabled={bekliyor}>Ekle</Dugme></div>
    </form>
  )
}
