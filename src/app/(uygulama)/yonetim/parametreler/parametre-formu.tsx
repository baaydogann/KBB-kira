'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { parametreEkleAction } from './actions'

export function ParametreFormu({ anahtar }: { anahtar?: string }) {
  const [durum, eylem, bekliyor] = useActionState(parametreEkleAction, BOS_FORM)
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      <Alan etiket="Anahtar" ad="anahtar" hata={durum.alanHatalari.anahtar} ipucu="Tablodaki mevcut bir anahtar; yeni anahtarlar yalnızca kurulum verisiyle eklenir.">
        <Girdi name="anahtar" autoComplete="off" defaultValue={durum.degerler?.anahtar ?? anahtar} required />
      </Alan>
      <Alan etiket="Değer" ad="deger" hata={durum.alanHatalari.deger} ipucu="Ondalık ayracı nokta: 29115961.10">
        <Girdi name="deger" autoComplete="off" defaultValue={durum.degerler?.deger} required />
      </Alan>
      <Alan etiket="Yürürlük başlangıcı" ad="yururlukBaslangic" hata={durum.alanHatalari.yururlukBaslangic}>
        <Girdi name="yururlukBaslangic" placeholder="gg.aa.yyyy" autoComplete="off" defaultValue={durum.degerler?.yururlukBaslangic} required />
      </Alan>
      <Alan etiket="Yürürlük bitişi (boş = açık)" ad="yururlukBitis" hata={durum.alanHatalari.yururlukBitis}>
        <Girdi name="yururlukBitis" placeholder="gg.aa.yyyy" autoComplete="off" defaultValue={durum.degerler?.yururlukBitis} />
      </Alan>
      <Alan etiket="Mevzuat dayanağı" ad="mevzuatDayanagi">
        <Girdi name="mevzuatDayanagi" autoComplete="off" defaultValue={durum.degerler?.mevzuatDayanagi} />
      </Alan>
      <Alan etiket="Açıklama" ad="aciklama">
        <Girdi name="aciklama" autoComplete="off" defaultValue={durum.degerler?.aciklama} />
      </Alan>
      <div><Dugme type="submit" tur="birincil" disabled={bekliyor}>Yeni yürürlük kaydı ekle</Dugme></div>
    </form>
  )
}
