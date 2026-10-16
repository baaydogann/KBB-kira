'use client'

import { useActionState } from 'react'
import { Alan, Girdi, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { paketOlusturAction } from './actions'

/** Yeni paket: birim ve vade aralığındaki planlı taksitler pakete kendiliğinden eklenir; gecikmişler detayda öneri olarak gelir. */
export function PaketFormu({ birimler }: { birimler: { id: number; ad: string }[] }) {
  const [durum, eylem, bekliyor] = useActionState(paketOlusturAction, BOS_FORM)
  const d = durum.degerler
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-5">
      <div className="md:col-span-5"><FormMesaji durum={durum} /></div>
      <Alan etiket="Harcama birimi" ad="birimId" hata={durum.alanHatalari.birimId}>
        <Secim key={d?.birimId} name="birimId" defaultValue={d?.birimId} required>
          {birimler.map((b) => <option key={b.id} value={b.id}>{b.ad}</option>)}
        </Secim>
      </Alan>
      <Alan etiket="Paket adı" ad="ad" hata={durum.alanHatalari.ad}>
        <Girdi name="ad" defaultValue={d?.ad} placeholder="Şubat 2026 kira ödemeleri" required />
      </Alan>
      <Alan etiket="Vade başlangıcı" ad="vadeBaslangic" hata={durum.alanHatalari.vadeBaslangic}>
        <Girdi type="date" name="vadeBaslangic" defaultValue={d?.vadeBaslangic} required />
      </Alan>
      <Alan etiket="Vade bitişi" ad="vadeBitis" hata={durum.alanHatalari.vadeBitis}>
        <Girdi type="date" name="vadeBitis" defaultValue={d?.vadeBitis} required />
      </Alan>
      <Alan etiket="Kalan ödenek (isteğe bağlı)" ad="kalanOdenek" hata={durum.alanHatalari.kalanOdenek}>
        <Girdi name="kalanOdenek" defaultValue={d?.kalanOdenek} inputMode="decimal" autoComplete="off" placeholder="1.234,56" />
      </Alan>
      <div className="md:col-span-5"><Dugme type="submit" tur="birincil" disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : 'Paketi oluştur'}</Dugme></div>
    </form>
  )
}
