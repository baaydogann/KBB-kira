import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Kart } from '@/components/ui/kart'
import { BelgeYukle } from '@/components/belge-yukle'

export function BelgelerSekmesi({ s }: { s: SozlesmeDetayi }) {
  return (
    <Kart baslik="Belgeler">
      <ul className="mb-3 space-y-1 text-sm">
        {s.belgeler.map((b) => (
          <li key={b.id}><a href={`/api/belgeler/${b.id}`} target="_blank" rel="noreferrer" className="text-marka hover:underline">{b.dosyaAdi}</a> — {b.belgeTuru} — {(b.boyut / 1024).toFixed(0)} KB</li>
        ))}
      </ul>
      <BelgeYukle sahipTur="sozlesme" sahipId={s.id} />
    </Kart>
  )
}
