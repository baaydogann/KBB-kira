import Link from 'next/link'
import type { TaksitGoruntusu } from '@/core/hesap/goruntu'
import { tarihDbOpt } from '@/server/donustur'
import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Rozet, type RozetTonu } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { HesapIzi } from '@/components/hesap-izi'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'

const TON: Record<string, RozetTonu> = { PLANLANDI: 'mavi', PAKETTE: 'sari', ODEME_EMRINDE: 'sari', ODENDI: 'yesil', IPTAL: 'gri' }

export function TaksitlerSekmesi({ s }: { s: SozlesmeDetayi }) {
  return (
    <Tablo>
      <thead><tr><Th>Dönem</Th><Th>Vade</Th><Th>Tür</Th><Th className="text-right">Tutar ({s.bedelTuru === 'BRUT' ? 'brüt' : 'net'})</Th><Th>Durum</Th><Th>Hesap izi</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {s.taksitler.map((x) => {
          // hesapGoruntusu JSON sütunudur; eski/bozuk bir satır sekmeyi çökertmesin diye alanlar isteğe bağlı okunur.
          const g = (x.hesapGoruntusu ?? {}) as Partial<TaksitGoruntusu>
          return (
            <tr key={x.id} className={x.durum === 'IPTAL' ? 'text-slate-400 line-through' : ''}>
              <Td><TarihMetni deger={tarihDbOpt(x.donemBaslangic)} /> – <TarihMetni deger={tarihDbOpt(x.donemBitis)} /></Td>
              <Td>
                <TarihMetni deger={tarihDbOpt(x.vadeTarihi)} />
                {s.tatileDenkTaksitIdleri.includes(x.id) ? <span className="ml-1"><Rozet ton="sari">tatile denk geliyor</Rozet></span> : null}
              </Td>
              <Td>{x.tur}{g.artisBekleniyor ? <span className="ml-1"><Rozet ton="sari">artış bekleniyor (tahmini)</Rozet></span> : null}</Td>
              <Td className="text-right"><ParaMetni deger={x.tutar.toFixed(2)} /></Td>
              <Td>
                <Rozet ton={TON[x.durum] ?? 'gri'}>{x.durum}</Rozet>
                {x.paketKayitlari[0] ? <Link href={`/odeme-paketleri/${x.paketKayitlari[0].paketId}`} className="ml-1 text-xs text-marka hover:underline">paket #{x.paketKayitlari[0].paketId}</Link> : null}
              </Td>
              <Td><HesapIzi satirlar={g.satirlar ?? []} /></Td>
            </tr>
          )
        })}
      </tbody>
    </Tablo>
  )
}
