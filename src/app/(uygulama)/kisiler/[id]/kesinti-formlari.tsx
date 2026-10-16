'use client'

import { useActionState, useState } from 'react'
import { Alan, Girdi } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { BelgeYukle } from '@/components/belge-yukle'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { borcSorguEkleAction } from '../actions'

/**
 * 22/A borç sorgusu girişi. Borç yazısı (PDF) isteğe bağlıdır: yüklenince kimliği gizli alana yazılır ve sorguyla birlikte gönderilir.
 * Geçerlilik bitişini sunucu hesaplar (15 gün; tatilde sonraki iş günü).
 */
export function BorcSorguFormu({ kisiId }: { kisiId: number }) {
  const [durum, eylem, bekliyor] = useActionState(borcSorguEkleAction, BOS_FORM)
  const [belgeId, setBelgeId] = useState<number | null>(null)
  const [borcVar, setBorcVar] = useState(false)
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      <input type="hidden" name="kisiId" value={kisiId} />
      <input type="hidden" name="belgeId" value={belgeId ?? ''} />
      <Alan etiket="Sorgu tarihi" ad="sorguTarihi" hata={durum.alanHatalari.sorguTarihi}>
        <Girdi type="date" name="sorguTarihi" defaultValue={durum.degerler?.sorguTarihi} required />
      </Alan>
      <div className="flex items-end gap-2 pb-1.5">
        <input id="borcVar" type="checkbox" name="borcVar" checked={borcVar} onChange={(e) => setBorcVar(e.target.checked)} />
        <label htmlFor="borcVar" className="text-sm">Vadesi geçmiş borcu var</label>
      </div>
      <Alan etiket="Borç tutarı" ad="borcTutari" hata={durum.alanHatalari.borcTutari} ipucu="Yalnız borç varsa">
        <Girdi name="borcTutari" defaultValue={durum.degerler?.borcTutari} inputMode="decimal" autoComplete="off" disabled={!borcVar} />
      </Alan>
      {/* Kişi sayfasındaki kişi formu da vergiDairesi kimliğini taşır; etiket doğru girdiye bağlansın diye benzersiz kimlik. */}
      <Alan etiket="Vergi dairesi" ad="sorgu-vergiDairesi" hata={durum.alanHatalari.vergiDairesi}>
        <Girdi id="sorgu-vergiDairesi" name="vergiDairesi" defaultValue={durum.degerler?.vergiDairesi} autoComplete="off" />
      </Alan>
      <Alan etiket="Belge no" ad="belgeNo" hata={durum.alanHatalari.belgeNo}>
        <Girdi name="belgeNo" defaultValue={durum.degerler?.belgeNo} autoComplete="off" />
      </Alan>
      <div className="space-y-1">
        <span className="block text-sm font-medium text-slate-700">Borç yazısı (PDF)</span>
        {belgeId === null
          ? <BelgeYukle sahipTur="kisi" sahipId={kisiId} belgeTuru="BORC_YAZISI" tamam={setBelgeId} />
          : <p className="text-sm text-slate-600">Belge yüklendi; sorguyla birlikte kaydedilecek.</p>}
        {durum.alanHatalari.belgeId ? <p className="text-xs text-red-600" role="alert">{durum.alanHatalari.belgeId}</p> : null}
      </div>
      <div className="md:col-span-3"><Dugme type="submit" disabled={bekliyor}>{bekliyor ? 'İşleniyor…' : 'Borç sorgusunu kaydet'}</Dugme></div>
    </form>
  )
}
