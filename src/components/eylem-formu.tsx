'use client'

import { useActionState, type ReactNode } from 'react'
import { Alan, Girdi } from './ui/alan'
import { Dugme } from './ui/dugme'
import { FormMesaji } from './form-durumu'
import { BOS_FORM, type FormDurumu } from '@/app/_lib/form-durumu'

/** Sunucu bileşeninden verilebilen düz alan tanımı; girdiler istemcide çizilir, başarısız gönderimde değerleri korunur. */
export interface EylemAlani { ad: string; etiket: string; tur?: 'text' | 'date'; zorunlu?: boolean }

export function EylemFormu({ eylem, dugme, tur = 'ikincil', onayMetni, alanlar = [], children }: {
  eylem: (d: FormDurumu, f: FormData) => Promise<FormDurumu>
  dugme: string
  tur?: 'birincil' | 'ikincil' | 'tehlike' | 'hayalet'
  onayMetni?: string
  alanlar?: EylemAlani[]
  children?: ReactNode
}) {
  const [durum, calistir, bekliyor] = useActionState(eylem, BOS_FORM)
  return (
    <form action={calistir} className="space-y-2"
      onSubmit={(e) => { if (onayMetni && !window.confirm(onayMetni)) e.preventDefault() }}>
      {children}
      {alanlar.map((a) => (
        <Alan key={a.ad} etiket={a.etiket} ad={a.ad} hata={durum.alanHatalari[a.ad]}>
          <Girdi type={a.tur ?? 'text'} name={a.ad} defaultValue={durum.degerler?.[a.ad] ?? ''} required={a.zorunlu} />
        </Alan>
      ))}
      <FormMesaji durum={durum} />
      <Dugme type="submit" tur={tur} disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : dugme}</Dugme>
    </form>
  )
}
