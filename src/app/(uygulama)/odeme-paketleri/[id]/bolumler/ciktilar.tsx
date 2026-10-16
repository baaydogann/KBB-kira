import type { PaketDetayi } from '@/server/paket/sorgu'
import { Kart } from '@/components/ui/kart'

const CIKTI_DURUMLARI = ['HESAPLANDI', 'KESINLESTI', 'ODEME_EMRINDE', 'ODENDI']
const KESINLESMIS = ['KESINLESTI', 'ODEME_EMRINDE', 'ODENDI']

/** Spec §10.2: paket belgeleri. Kesinleşmemiş pakette belgeler "TASLAK — KESİNLEŞMEMİŞ" filigranlıdır. */
export function CiktilarBolumu({ p }: { p: PaketDetayi }) {
  if (!CIKTI_DURUMLARI.includes(p.durum)) return null
  return (
    <Kart baslik="Çıktılar">
      <ul className="space-y-1 text-sm">
        <li><a href={`/api/odeme-paketleri/${p.id}/belgeler`} className="text-marka hover:underline">Paket belgeleri (PDF)</a> <span className="text-xs text-slate-500">föy, ek listesi, pusulalar, fiş önerisi, artış tabloları</span></li>
        {KESINLESMIS.includes(p.durum) ? (
          <li><a href={`/api/odeme-paketleri/${p.id}/banka`} className="text-marka hover:underline">Banka aktarım dosyası (Excel)</a> <span className="text-xs text-slate-500">tam IBAN içerir</span></li>
        ) : null}
      </ul>
      {p.durum === 'HESAPLANDI' ? <p className="mt-2 text-xs text-slate-600">Paket kesinleşmediği için belgeler taslak filigranıyla basılır.</p> : null}
    </Kart>
  )
}
