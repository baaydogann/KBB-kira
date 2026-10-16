import type { PaketDetayi } from '@/server/paket/sorgu'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { paketFaturaAction } from '../../actions'

const ALANLAR: EylemAlani[] = [
  { ad: 'faturaNo', etiket: 'Fatura no', zorunlu: true },
  { ad: 'faturaTarihi', etiket: 'Fatura tarihi', tur: 'date', zorunlu: true },
]

/** KDV'li malikler için fatura zorunludur (ön kontrol FATURA_YOK); KDV'siz tüzel kişilerin belgesi yalnız ek listesine girer. */
export function FaturalarBolumu({ p, duzenlenebilir }: { p: PaketDetayi; duzenlenebilir: boolean }) {
  if (p.faturaGereken.length === 0) return null
  const taksit = new Map(p.taksitler.map((t) => [t.taksitId, t]))
  return (
    <Kart baslik="Faturalar">
      <ul className="space-y-3 text-sm">
        {p.faturaGereken.map((f) => {
          const t = taksit.get(f.taksitId)
          return (
            <li key={`${f.taksitId}:${f.kisiId}`} className="rounded border border-slate-200 p-2">
              <div className="mb-1">
                <strong>{f.kisiAdi}</strong> — {t?.sozlesmeNo} <TarihMetni deger={t?.donemBaslangic ?? null} />{' '}
                {f.faturaNo ? <Rozet ton="yesil">{f.faturaNo} / <TarihMetni deger={f.faturaTarihi} /></Rozet> : <Rozet ton="kirmizi">fatura girilmedi</Rozet>}
              </div>
              {duzenlenebilir ? (
                <div className="max-w-md">
                  <EylemFormu eylem={paketFaturaAction} dugme="Faturayı kaydet" alanlar={ALANLAR} kimlikOneki={`fatura-${f.taksitId}-${f.kisiId}-`}>
                    <input type="hidden" name="paketId" value={p.id} />
                    <input type="hidden" name="version" value={p.version} />
                    <input type="hidden" name="taksitId" value={f.taksitId} />
                    <input type="hidden" name="kisiId" value={f.kisiId} />
                  </EylemFormu>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Kart>
  )
}
