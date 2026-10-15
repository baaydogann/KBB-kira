'use client'

import { createContext, useActionState, useContext, type ReactNode } from 'react'
import { Alan, Girdi, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM, type FormDurumu } from '@/app/_lib/form-durumu'
import { endeksElleGirAction, endeksOnaylaAction } from './actions'

interface OnayBagi { durum: FormDurumu; eylem: (f: FormData) => void; bekliyor: boolean }
const OnayBaglami = createContext<OnayBagi | null>(null)

/**
 * Onay formlarının ortak durumu. Onaylanan endeks bekleyenler listesinden çıkınca kendi formu da kaldırılır; sonuç mesajı
 * (özellikle "bekleyen artışlar hesaplanamadı" uyarısı) formla birlikte kaybolmasın diye `useActionState` listeyi saran bu
 * bileşende, yani yeniden çizimden sonra da bağlı kalan yerde tutulur. Liste boşalsa bile bu bileşen sayfada kalmalıdır.
 */
export function OnayBekleyenleri({ children }: { children: ReactNode }) {
  const [durum, eylem, bekliyor] = useActionState(endeksOnaylaAction, BOS_FORM)
  return (
    <OnayBaglami value={{ durum, eylem, bekliyor }}>
      <div className="space-y-3">
        <FormMesaji durum={durum} />
        {children}
      </div>
    </OnayBaglami>
  )
}

/**
 * Aynı sayfada birden çok onay formu olduğundan alan kimliği kayda özeldir (yinelenen id ve yanlış etiket bağı olmaz).
 * `deger`: sayfada gösterilen EVDS değeri; gizli alanla geri gönderilir, sayfa açıldıktan sonra değiştiyse sunucu onayı reddeder.
 * Ortak durum yalnızca gönderilen kayıt için alan hatası ve girilen değeri gösterir.
 */
export function OnayFormu({ id, deger }: { id: number; deger: string }) {
  const ortak = useContext(OnayBaglami)
  if (ortak === null) throw new Error('OnayFormu, OnayBekleyenleri içinde kullanılmalıdır.')
  const { durum, eylem, bekliyor } = ortak
  const kendi = durum.degerler?.id === String(id)
  const kimlik = `resmiDeger-${id}`
  return (
    <form action={eylem} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="gorulenDeger" value={deger} />
      <Alan etiket="TÜİK bülteninde yayımlanan değer (farklıysa)" ad={kimlik} hata={kendi ? durum.alanHatalari.resmiDeger : undefined} ipucu="Boş bırakılırsa EVDS değeri onaylanır.">
        <Girdi id={kimlik} name="resmiDeger" placeholder="31,49" inputMode="decimal" autoComplete="off" defaultValue={kendi ? durum.degerler?.resmiDeger : undefined} className="w-40" />
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
