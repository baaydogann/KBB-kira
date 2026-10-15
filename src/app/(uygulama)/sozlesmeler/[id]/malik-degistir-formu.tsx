'use client'

import { useState, useTransition } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { MalikSatirlari } from '../_bilesenler/malik-satirlari'
import type { Kisiler, MalikSatiri } from '../_bilesenler/secenekler'
import { malikDegistirAction } from '../actions'

export function MalikDegistirFormu({ id, version, mevcut, kisiler }: { id: number; version: number; mevcut: MalikSatiri[]; kisiler: Kisiler }) {
  // Girdiler istemci durumunda: başarısız gönderim tarihi ve malik satırlarını silmez.
  const [tarih, setTarih] = useState('')
  const [satirlar, setSatirlar] = useState(mevcut)
  const [durum, setDurum] = useState(BOS_FORM)
  const [bekliyor, baslat] = useTransition()
  // Genel iletiyle aynı olan ya da tarih alanında gösterilen iletiler yinelenmesin; Zod gibi ayrıntılar listelenir.
  const ayrintilar = Object.entries(durum.alanHatalari).filter(([ad, m]) => ad !== 'tarih' && m !== durum.hata)
  function kaydet() {
    baslat(async () => {
      try {
        const r = await malikDegistirAction({ id, version, tarih, malikler: satirlar })
        setDurum(r)
        if (r.tamam) setTarih('')
      } catch {
        setDurum({ hata: 'Sunucuya ulaşılamadı; girdileriniz korundu, tekrar deneyin.', alanHatalari: {}, tamam: false })
      }
    })
  }
  return (
    <div className="space-y-3">
      <FormMesaji durum={durum} />
      {ayrintilar.length ? <ul className="list-disc pl-5 text-xs text-red-700">{ayrintilar.map(([ad, m]) => <li key={ad}>{ad}: {m}</li>)}</ul> : null}
      <Alan etiket="Değişiklik tarihi (yeni malikler bu tarihten itibaren)" ad="tarih" hata={durum.alanHatalari.tarih}><Girdi id="tarih" type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Alan>
      <MalikSatirlari satirlar={satirlar} kisiler={kisiler} degisti={setSatirlar} />
      <Dugme tur="birincil" disabled={bekliyor} onClick={kaydet}>Malik değişikliğini kaydet</Dugme>
    </div>
  )
}
