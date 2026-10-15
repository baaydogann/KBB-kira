'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { birimKaydetAction } from './actions'

export function BirimFormu() {
  const [durum, eylem, bekliyor] = useActionState(birimKaydetAction, BOS_FORM)
  const h = durum.alanHatalari
  const d = durum.degerler
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      <Alan etiket="Birim adı" ad="ad" hata={h.ad}><Girdi name="ad" defaultValue={d?.ad} required /></Alan>
      <Alan etiket="Kurumsal kod" ad="kurumsalKod" hata={h.kurumsalKod}><Girdi name="kurumsalKod" defaultValue={d?.kurumsalKod} placeholder="46.01.33.01" required /></Alan>
      <Alan etiket="Fonksiyonel kod" ad="fonksiyonelKod" hata={h.fonksiyonelKod}><Girdi name="fonksiyonelKod" defaultValue={d?.fonksiyonelKod} placeholder="01.3.9.00" required /></Alan>
      <Alan etiket="Gerçekleştirme görevlisi" ad="gerceklestirmeGorevlisi" hata={h.gerceklestirmeGorevlisi}><Girdi name="gerceklestirmeGorevlisi" defaultValue={d?.gerceklestirmeGorevlisi} /></Alan>
      <Alan etiket="Harcama yetkilisi" ad="harcamaYetkilisi" hata={h.harcamaYetkilisi}><Girdi name="harcamaYetkilisi" defaultValue={d?.harcamaYetkilisi} /></Alan>
      <div className="flex items-end"><Dugme type="submit" tur="birincil" disabled={bekliyor}>Birim ekle</Dugme></div>
    </form>
  )
}
