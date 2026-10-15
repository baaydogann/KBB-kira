'use client'

import { useActionState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { ibanEkleAction } from './actions'

export function IbanFormu({ kisiId }: { kisiId: number }) {
  const [durum, eylem, bekliyor] = useActionState(ibanEkleAction, BOS_FORM)
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      <input type="hidden" name="kisiId" value={kisiId} />
      <Alan etiket="IBAN" ad="iban" hata={durum.alanHatalari.iban}><Girdi name="iban" defaultValue={durum.degerler?.iban} autoComplete="off" placeholder="TR00 0000 0000 0000 0000 0000 00" required /></Alan>
      <Alan etiket="Banka" ad="bankaAdi"><Girdi name="bankaAdi" defaultValue={durum.degerler?.bankaAdi} autoComplete="off" /></Alan>
      <div className="flex items-end"><Dugme type="submit" disabled={bekliyor}>IBAN ekle</Dugme></div>
    </form>
  )
}
