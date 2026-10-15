'use client'

import { useActionState, useState } from 'react'
import { Alan, Girdi, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { kisiKaydetAction } from './actions'

export interface KisiFormVerisi {
  id?: number; version?: number; tip?: 'GERCEK' | 'TUZEL'; tckn?: string | null; vkn?: string | null; ad?: string | null
  soyad?: string | null; unvan?: string | null; vergiDairesi?: string | null; vergiStatusu?: string; telefon?: string | null; adres?: string | null
}

export const STATU_SECENEKLERI: [string, string][] = [
  ['GMSI_GERCEK', 'Gerçek kişi (GMSİ) — %20 stopaj'], ['SERBEST_MESLEK', 'Serbest meslek — %20 stopaj'],
  ['TICARI_AKTIF', 'Tüccar, taşınmaz işletme aktifinde — KDV (teyit)'], ['BASIT_USUL', 'Basit usul — %20 stopaj (teyit)'],
  ['SIRKET', 'Şirket — KDV, stopaj yok'], ['KOOPERATIF', 'Kooperatif — %20 stopaj (teyit)'],
  ['VAKIF_DERNEK', 'Vakıf / dernek — %20 stopaj'], ['KAMU', 'Kamu idaresi (teyit)'],
]

export function KisiFormu({ veri = {} }: { veri?: KisiFormVerisi }) {
  const [durum, eylem, bekliyor] = useActionState(kisiKaydetAction, BOS_FORM)
  const [tip, setTip] = useState<'GERCEK' | 'TUZEL'>(veri.tip ?? 'GERCEK')
  const h = durum.alanHatalari
  const d = durum.degerler
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      {veri.id ? <><input type="hidden" name="id" value={veri.id} /><input type="hidden" name="version" value={veri.version} /></> : null}
      <Alan etiket="Tip" ad="tip" hata={h.tip}>
        {/* Kontrollü (`value`) olamaz: React 19'un form sıfırlaması select'i ilk seçeneğe döndürür, durum ile ekran ayrışır. */}
        <Secim key={d?.tip ?? ''} name="tip" defaultValue={d?.tip ?? veri.tip ?? 'GERCEK'} onChange={(e) => setTip(e.target.value === 'TUZEL' ? 'TUZEL' : 'GERCEK')}>
          <option value="GERCEK">Gerçek kişi</option><option value="TUZEL">Tüzel kişi</option>
        </Secim>
      </Alan>
      {/* key: tip değişince React, yazılmış değerleri başka bir alana taşımasın; vkn iki dalda da aynı alandır ve korunur. */}
      {tip === 'GERCEK' ? (
        <>
          <Alan key="tckn" etiket="T.C. kimlik no" ad="tckn" hata={h.tckn}><Girdi name="tckn" defaultValue={d?.tckn ?? veri.tckn ?? ''} inputMode="numeric" maxLength={11} required /></Alan>
          <Alan key="vkn" etiket="Vergi kimlik no (varsa)" ad="vkn" hata={h.vkn}><Girdi name="vkn" defaultValue={d?.vkn ?? veri.vkn ?? ''} inputMode="numeric" maxLength={10} /></Alan>
          <Alan key="ad" etiket="Ad" ad="ad" hata={h.ad}><Girdi name="ad" defaultValue={d?.ad ?? veri.ad ?? ''} required /></Alan>
          <Alan key="soyad" etiket="Soyad" ad="soyad" hata={h.soyad}><Girdi name="soyad" defaultValue={d?.soyad ?? veri.soyad ?? ''} required /></Alan>
        </>
      ) : (
        <>
          <Alan key="vkn" etiket="Vergi kimlik no" ad="vkn" hata={h.vkn}><Girdi name="vkn" defaultValue={d?.vkn ?? veri.vkn ?? ''} inputMode="numeric" maxLength={10} required /></Alan>
          <Alan key="unvan" etiket="Unvan" ad="unvan" hata={h.unvan} className="md:col-span-2"><Girdi name="unvan" defaultValue={d?.unvan ?? veri.unvan ?? ''} required /></Alan>
        </>
      )}
      <Alan etiket="Vergi dairesi" ad="vergiDairesi" hata={h.vergiDairesi}><Girdi name="vergiDairesi" defaultValue={d?.vergiDairesi ?? veri.vergiDairesi ?? ''} /></Alan>
      {/* `key`: başarısız gönderimden sonra select'in seçili değeri korunsun diye yeniden kurulur (bkz. tasinmaz-formu.tsx). */}
      <Alan etiket="Vergi statüsü" ad="vergiStatusu" hata={h.vergiStatusu} className="md:col-span-2" ipucu="Stopaj ve KDV uygulamasını belirler; statü değişirse teyit sıfırlanır.">
        <Secim key={d?.vergiStatusu ?? ''} name="vergiStatusu" defaultValue={d?.vergiStatusu ?? veri.vergiStatusu ?? 'GMSI_GERCEK'}>{STATU_SECENEKLERI.map(([k, e]) => <option key={k} value={k}>{e}</option>)}</Secim>
      </Alan>
      <Alan etiket="Telefon" ad="telefon" hata={h.telefon}><Girdi name="telefon" defaultValue={d?.telefon ?? veri.telefon ?? ''} /></Alan>
      <Alan etiket="Adres" ad="adres" hata={h.adres} className="md:col-span-2"><Girdi name="adres" defaultValue={d?.adres ?? veri.adres ?? ''} /></Alan>
      <div><Dugme type="submit" tur="birincil" disabled={bekliyor}>Kaydet</Dugme></div>
    </form>
  )
}
