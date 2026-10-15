import { sozlesmeHatirlatmalari } from '@/server/hatirlatma/servis'
import { Rozet, type RozetTonu } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { TarihMetni } from '@/components/tarih'

const TON: Record<'KRITIK' | 'YUKSEK' | 'NORMAL', RozetTonu> = { KRITIK: 'kirmizi', YUKSEK: 'sari', NORMAL: 'mavi' }

export async function HatirlatmalarSekmesi({ sozlesmeId }: { sozlesmeId: number }) {
  const liste = await sozlesmeHatirlatmalari(sozlesmeId)
  return (
    <Tablo>
      <thead><tr><Th>Son tarih</Th><Th>Başlık</Th><Th>Öncelik</Th><Th>Durum</Th><Th>Not</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {liste.length === 0 ? <tr><Td colSpan={5} className="py-6 text-center text-slate-500">Bu sözleşme için hatırlatma yok.</Td></tr> : null}
        {liste.map((h) => (
          <tr key={h.id} className={h.durum === 'ACIK' ? '' : 'text-slate-500'}>
            <Td><TarihMetni deger={h.hedef} /></Td>
            <Td>{h.baslik}</Td>
            <Td><Rozet ton={TON[h.oncelik]}>{h.oncelik}</Rozet></Td>
            <Td>{h.durum}{h.durum === 'ERTELENDI' && h.ertelenen ? <> → <TarihMetni deger={h.ertelenen} /></> : null}</Td>
            <Td>{h.not ?? ''}</Td>
          </tr>
        ))}
      </tbody>
    </Tablo>
  )
}
