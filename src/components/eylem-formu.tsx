'use client'

import { useActionState, type ReactNode } from 'react'
import { Alan, Girdi, Secim } from './ui/alan'
import { Dugme } from './ui/dugme'
import { FormMesaji } from './form-durumu'
import { BOS_FORM, type FormDurumu } from '@/app/_lib/form-durumu'

/**
 * Sunucu bileşeninden verilebilen düz alan tanımı; girdiler istemcide çizilir, başarısız gönderimde değerleri korunur.
 * `select` alanı ilk seçenekle başlar; `ondalik` tutar/oran girdisi içindir (sayısal klavye, otomatik doldurma kapalı).
 */
export interface EylemAlani {
  ad: string
  etiket: string
  tur?: 'text' | 'date' | 'select'
  zorunlu?: boolean
  ipucu?: string
  yerTutucu?: string
  ondalik?: boolean
  secenekler?: { deger: string; etiket: string }[]
}

export function EylemFormu({ eylem, dugme, tur = 'ikincil', onayMetni, alanlar = [], kimlikOneki = '', children }: {
  eylem: (d: FormDurumu, f: FormData) => Promise<FormDurumu>
  dugme: string
  tur?: 'birincil' | 'ikincil' | 'tehlike' | 'hayalet'
  onayMetni?: string
  alanlar?: EylemAlani[]
  /** Aynı sayfada aynı alan adlarını taşıyan çok sayıda form varsa (liste satırları) etiket ve girdi kimliklerini benzersiz kılar. */
  kimlikOneki?: string
  children?: ReactNode
}) {
  const [durum, calistir, bekliyor] = useActionState(eylem, BOS_FORM)
  return (
    <form action={calistir} className="space-y-2"
      onSubmit={(e) => { if (onayMetni && !window.confirm(onayMetni)) e.preventDefault() }}>
      {children}
      {alanlar.map((a) => {
        const kayitli = durum.degerler?.[a.ad]
        const secili = kayitli ?? a.secenekler?.[0]?.deger
        const kimlik = `${kimlikOneki}${a.ad}`
        return (
          <Alan key={a.ad} etiket={a.etiket} ad={kimlik} hata={durum.alanHatalari[a.ad]} ipucu={a.ipucu}>
            {a.tur === 'select' ? (
              // Başarısız gönderimde React 19 formu sıfırlar: seçim yalnızca yeniden bağlanırsa (key) korunur.
              <Secim key={secili} id={kimlik} name={a.ad} defaultValue={secili} required={a.zorunlu}>
                {a.secenekler?.map((o) => <option key={o.deger} value={o.deger}>{o.etiket}</option>)}
              </Secim>
            ) : (
              <Girdi
                id={kimlik} type={a.tur ?? 'text'} name={a.ad} defaultValue={kayitli ?? ''} required={a.zorunlu} placeholder={a.yerTutucu}
                inputMode={a.ondalik ? 'decimal' : undefined} autoComplete={a.ondalik ? 'off' : undefined}
              />
            )}
          </Alan>
        )
      })}
      <FormMesaji durum={durum} />
      <Dugme type="submit" tur={tur} disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : dugme}</Dugme>
    </form>
  )
}
