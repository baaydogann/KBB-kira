import { tarihDbOpt } from '@/server/donustur'
import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'

export function DonemlerSekmesi({ s }: { s: SozlesmeDetayi }) {
  return (
    <Kart baslik="Kira dönemleri">
      <Tablo>
        <thead><tr><Th>Başlangıç</Th><Th>Bitiş</Th><Th className="text-right">Bedel</Th><Th>Taban</Th><Th>Kaynak</Th><Th>Açıklama</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {s.kiraDonemleri.map((k) => (
            <tr key={k.id}>
              <Td><TarihMetni deger={tarihDbOpt(k.baslangic)} /></Td><Td><TarihMetni deger={tarihDbOpt(k.bitis)} /></Td>
              <Td className="text-right"><ParaMetni deger={k.bedelTutari.toFixed(2)} /></Td><Td>{k.bedelTabani}</Td><Td>{k.kaynak}</Td><Td>{k.aciklama ?? ''}</Td>
            </tr>
          ))}
        </tbody>
      </Tablo>
    </Kart>
  )
}
