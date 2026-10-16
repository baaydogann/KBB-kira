import type { PaketDetayi } from '@/server/paket/sorgu'
import { Kart } from '@/components/ui/kart'
import { Uyari } from '@/components/ui/uyari'

/** Spec §10.1-2: hatalar kesinleştirmeyi engeller, uyarılar engellemez. Hesaplanmamış pakette gösterilmez. */
export function OnKontrolBolumu({ p }: { p: PaketDetayi }) {
  if (p.onKontrol === null) return null
  const { hatalar, uyarilar } = p.onKontrol
  return (
    <Kart baslik="Ön kontrol">
      {hatalar.length === 0 && uyarilar.length === 0 ? <Uyari ton="basari">Ön kontrolde hata ya da uyarı yok.</Uyari> : null}
      <div className="space-y-1">
        {hatalar.map((b, i) => <Uyari key={`h${i}`} ton="hata">{b.mesaj}</Uyari>)}
        {uyarilar.map((b, i) => <Uyari key={`u${i}`} ton="uyari">{b.mesaj}</Uyari>)}
      </div>
      {hatalar.length > 0 ? <p className="mt-2 text-xs text-slate-600">Hataları giderip paketi yeniden hesaplayın; hatalı paket kesinleştirilemez.</p> : null}
    </Kart>
  )
}
