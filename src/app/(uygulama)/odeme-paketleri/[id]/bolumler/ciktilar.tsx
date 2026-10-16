import type { PaketDetayi } from '@/server/paket/sorgu'
import { Kart } from '@/components/ui/kart'

const CIKTI_DURUMLARI = ['HESAPLANDI', 'KESINLESTI', 'ODEME_EMRINDE', 'ODENDI']

/** Spec §10.2: paket belgeleri. Kesinleşmemiş pakette belgeler "TASLAK — KESİNLEŞMEMİŞ" filigranlıdır. */
export function CiktilarBolumu({ p }: { p: PaketDetayi }) {
  if (!CIKTI_DURUMLARI.includes(p.durum)) return null
  return (
    <Kart baslik="Çıktılar">
      <ul className="space-y-1 text-sm">
        <li><a href={`/api/odeme-paketleri/${p.id}/belgeler`} className="text-marka hover:underline">Paket belgeleri (PDF)</a> <span className="text-xs text-slate-500">föy ve ek belge listesi</span></li>
      </ul>
      {p.durum === 'HESAPLANDI' ? <p className="mt-2 text-xs text-slate-600">Paket kesinleşmediği için belgeler taslak filigranıyla basılır.</p> : null}
    </Kart>
  )
}
