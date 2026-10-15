'use client'

import { Girdi, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import type { Kisiler, MalikSatiri } from './secenekler'

export function MalikSatirlari({ satirlar, kisiler, degisti }: { satirlar: MalikSatiri[]; kisiler: Kisiler; degisti: (s: MalikSatiri[]) => void }) {
  const guncelle = (i: number, p: Partial<MalikSatiri>) => degisti(satirlar.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const ibanlari = (kisiId: number | null) => kisiler.find((k) => k.id === kisiId)?.ibanlar ?? []
  return (
    <div className="space-y-2">
      {satirlar.map((s, i) => {
        const odemeKisisi = s.vekilKisiId ?? s.kisiId
        return (
          <div key={i} className="grid grid-cols-[2fr_5rem_5rem_2fr_2fr_auto] items-end gap-2 rounded border border-slate-200 p-2">
            <label className="text-xs">Malik
              <Secim value={s.kisiId || ''} onChange={(e) => guncelle(i, { kisiId: Number(e.target.value), ibanId: null })}>
                <option value="">Seçin</option>
                {kisiler.map((k) => <option key={k.id} value={k.id}>{k.ad} — {k.statu}</option>)}
              </Secim>
            </label>
            <label className="text-xs">Pay<Girdi type="number" min={1} value={s.pay} onChange={(e) => guncelle(i, { pay: Number(e.target.value) })} /></label>
            <label className="text-xs">Payda<Girdi type="number" min={1} value={s.payda} onChange={(e) => guncelle(i, { payda: Number(e.target.value) })} /></label>
            <label className="text-xs">Vekil (varsa)
              <Secim value={s.vekilKisiId ?? ''} onChange={(e) => guncelle(i, { vekilKisiId: e.target.value ? Number(e.target.value) : null, ibanId: null })}>
                <option value="">—</option>
                {kisiler.map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}
              </Secim>
            </label>
            <label className="text-xs">Ödeme IBAN&apos;ı
              <Secim value={s.ibanId ?? ''} onChange={(e) => guncelle(i, { ibanId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Seçin</option>
                {ibanlari(odemeKisisi).map((b) => <option key={b.id} value={b.id}>{b.etiket}</option>)}
              </Secim>
            </label>
            <Dugme tur="hayalet" onClick={() => degisti(satirlar.filter((_, j) => j !== i))} aria-label="Maliki kaldır">Kaldır</Dugme>
          </div>
        )
      })}
      <Dugme onClick={() => degisti([...satirlar, { kisiId: 0, pay: 1, payda: 1, ibanId: null, vekilKisiId: null }])}>Malik ekle</Dugme>
    </div>
  )
}
