import Link from 'next/link'
import { formatTarih } from '@/core/tarih'
import type { PanoSatiri } from '@/server/hatirlatma/servis'
import { Rozet, type RozetTonu } from './ui/rozet'
import { EylemFormu, type EylemAlani } from './eylem-formu'
import { erteleAction, tamamlaAction } from '@/app/(uygulama)/actions'
import { hatirlatmaAdresi } from '@/app/_lib/hatirlatma-adresi'

const TON: Record<PanoSatiri['oncelik'], RozetTonu> = { KRITIK: 'kirmizi', YUKSEK: 'sari', NORMAL: 'mavi' }

const TAMAMLA_ALANLARI: EylemAlani[] = [{ ad: 'not', etiket: 'Not', yerTutucu: 'Not (isteğe bağlı)' }]
const ERTELE_ALANLARI: EylemAlani[] = [{ ad: 'tarih', etiket: 'Erteleme tarihi', tur: 'date', zorunlu: true }]

export function HatirlatmaSatiri({ h }: { h: Pick<PanoSatiri, 'id' | 'baslik' | 'aciklama' | 'hedef' | 'oncelik' | 'sozlesmeId' | 'kural' | 'iliskiliTur' | 'iliskiliId'> & { tatileDenk?: boolean } }) {
  const hedefUrl = hatirlatmaAdresi(h)
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
      <Rozet ton={TON[h.oncelik]}>{h.oncelik}</Rozet>
      <div className="min-w-64 flex-1">
        <p className="font-medium">{hedefUrl ? <Link href={hedefUrl} className="hover:underline">{h.baslik}</Link> : h.baslik}</p>
        <p className="text-xs text-slate-600">
          {h.aciklama} — son tarih {formatTarih(h.hedef)}
          {h.tatileDenk ? <span className="ml-1"><Rozet ton="sari">tatile denk geliyor</Rozet></span> : null}
        </p>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-marka">İşlem</summary>
        <div className="mt-2 grid gap-2">
          <EylemFormu eylem={tamamlaAction} dugme="Tamamla" alanlar={TAMAMLA_ALANLARI} kimlikOneki={`tamamla-${h.id}-`}>
            <input type="hidden" name="id" value={h.id} />
          </EylemFormu>
          <EylemFormu eylem={erteleAction} dugme="Ertele" alanlar={ERTELE_ALANLARI} kimlikOneki={`ertele-${h.id}-`}>
            <input type="hidden" name="id" value={h.id} />
          </EylemFormu>
        </div>
      </details>
    </li>
  )
}
