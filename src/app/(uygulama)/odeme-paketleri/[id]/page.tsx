import { notFound } from 'next/navigation'
import { bugunIstanbul } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { BulunamadiHatasi } from '@/server/hata'
import { paketDetayi, paketOnerileri } from '@/server/paket/sorgu'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { Rozet } from '@/components/ui/rozet'
import { PAKET_DURUM_ETIKETI, PAKET_DURUM_TONU } from '../durum'
import { FaturalarBolumu } from './bolumler/faturalar'
import { TaksitlerBolumu } from './bolumler/taksitler'

export default async function PaketSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const id = yolKimligi((await params).id)
  if (id === null) notFound()
  const bugun = bugunIstanbul()
  const p = await paketDetayi(id, bugun).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  const duzenlenebilir = p.durum === 'TASLAK' || p.durum === 'HESAPLANDI'
  const oneriler = duzenlenebilir ? await paketOnerileri(id, bugun) : []
  return (
    <>
      <SayfaBasligi baslik={`Ödeme paketi #${p.id} — ${p.ad}`} aciklama={p.birim.ad} />
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm md:grid-cols-4">
        <div>Durum<br /><Rozet ton={PAKET_DURUM_TONU[p.durum]}>{PAKET_DURUM_ETIKETI[p.durum]}</Rozet></div>
        <div>Vade aralığı<br /><TarihMetni deger={p.vadeBaslangic} /> – <TarihMetni deger={p.vadeBitis} /></div>
        <div>Hesap tarihi<br /><TarihMetni deger={p.hesapTarihi} /></div>
        <div>Kalan ödenek<br />{p.kalanOdenek === null ? '—' : <ParaMetni deger={p.kalanOdenek} />}</div>
      </div>
      <div className="space-y-4">
        <TaksitlerBolumu p={p} oneriler={oneriler} duzenlenebilir={duzenlenebilir} />
        <FaturalarBolumu p={p} duzenlenebilir={duzenlenebilir} />
      </div>
    </>
  )
}
