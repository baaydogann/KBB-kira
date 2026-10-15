'use client'

import { useActionState } from 'react'
import { Alan, Girdi, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { endeksElleGirAction, endeksOnaylaAction } from './actions'

/**
 * Aynı sayfada birden çok onay formu olduğundan alan kimliği kayda özeldir (yinelenen id ve yanlış etiket bağı olmaz).
 * `deger`: sayfada gösterilen EVDS değeri; gizli alanla geri gönderilir, sayfa açıldıktan sonra değiştiyse sunucu onayı reddeder.
 */
export function OnayFormu({ id, deger }: { id: number; deger: string }) {
  const [durum, eylem, bekliyor] = useActionState(endeksOnaylaAction, BOS_FORM)
  const kimlik = `resmiDeger-${id}`
  return (
    <form action={eylem} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="gorulenDeger" value={deger} />
      <FormMesaji durum={durum} />
      <Alan etiket="TÜİK bülteninde yayımlanan değer (farklıysa)" ad={kimlik} hata={durum.alanHatalari.resmiDeger} ipucu="Boş bırakılırsa EVDS değeri onaylanır.">
        <Girdi id={kimlik} name="resmiDeger" placeholder="31,49" inputMode="decimal" autoComplete="off" defaultValue={durum.degerler?.resmiDeger} className="w-40" />
      </Alan>
      <Dugme type="submit" tur="birincil" disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : 'Onayla'}</Dugme>
    </form>
  )
}

export function ElleGirisFormu({ seriler }: { seriler: { deger: string; etiket: string }[] }) {
  const [durum, eylem, bekliyor] = useActionState(endeksElleGirAction, BOS_FORM)
  const seri = durum.degerler?.seri ?? seriler[0]?.deger
  return (
    <form action={eylem} className="space-y-3">
      <FormMesaji durum={durum} />
      <div className="grid gap-3 md:grid-cols-3">
        <Alan etiket="Seri" ad="seri" hata={durum.alanHatalari.seri}>
          <Secim name="seri" key={seri} defaultValue={seri}>
            {seriler.map((s) => <option key={s.deger} value={s.deger}>{s.etiket}</option>)}
          </Secim>
        </Alan>
        <Alan etiket="Ay" ad="ay" hata={durum.alanHatalari.ay} ipucu="Tarayıcınız ay seçici göstermezse yyyy-aa yazın (2026-09).">
          <Girdi type="month" name="ay" pattern="\d{4}-\d{2}" placeholder="2026-09" defaultValue={durum.degerler?.ay} required />
        </Alan>
        <Alan etiket="Oran (%)" ad="deger" hata={durum.alanHatalari.deger}>
          <Girdi name="deger" placeholder="31,49" inputMode="decimal" autoComplete="off" defaultValue={durum.degerler?.deger} required />
        </Alan>
      </div>
      <Dugme type="submit" tur="birincil" disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : 'Onaylı olarak kaydet'}</Dugme>
    </form>
  )
}
