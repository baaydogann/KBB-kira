import { tarihDbOpt } from '@/server/donustur'
import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { TarihMetni } from '@/components/tarih'
import type { Kisiler } from '../../_bilesenler/secenekler'
import { MalikDegistirFormu } from '../malik-degistir-formu'

export function MaliklerSekmesi({ s, kisiler }: { s: SozlesmeDetayi; kisiler: Kisiler }) {
  const acik = s.malikler.filter((m) => m.gecerlilikBitis === null)
  return (
    <div className="space-y-4">
      <Tablo>
        <thead><tr><Th>Malik</Th><Th>Hisse</Th><Th>Vekil</Th><Th>IBAN</Th><Th>Geçerlilik</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {s.malikler.map((m) => (
            <tr key={m.id} className={m.gecerlilikBitis ? 'text-slate-500' : ''}>
              <Td>{m.kisiAdi}</Td><Td>{m.pay}/{m.payda}</Td><Td>{m.vekilAdi ?? '—'}</Td><Td className="font-mono text-xs">{m.ibanMaskeli ?? '—'}</Td>
              <Td><TarihMetni deger={tarihDbOpt(m.gecerlilikBaslangic)} /> – <TarihMetni deger={tarihDbOpt(m.gecerlilikBitis)} /></Td>
            </tr>
          ))}
        </tbody>
      </Tablo>
      {s.durum === 'AKTIF' || s.durum === 'UZADI' ? (
        <Kart baslik="Malik değişikliği (satış, miras — TBK 310)">
          <MalikDegistirFormu id={s.id} version={s.version} kisiler={kisiler}
            mevcut={acik.map((m) => ({ kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId }))} />
        </Kart>
      ) : null}
    </div>
  )
}
