import { notFound } from 'next/navigation'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { tarihDbOpt } from '@/server/donustur'
import { BulunamadiHatasi } from '@/server/hata'
import { sihirbazSecenekleri, sozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Rozet } from '@/components/ui/rozet'
import { Sekmeler } from '@/components/ui/sekmeler'
import { Uyari } from '@/components/ui/uyari'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { DURUM_ETIKETI, DURUM_TONU } from '../_bilesenler/durum'
import { GenelSekmesi } from './sekmeler/genel'
import { MaliklerSekmesi } from './sekmeler/malikler'
import { DonemlerSekmesi } from './sekmeler/donemler'
import { TaksitlerSekmesi } from './sekmeler/taksitler'
import { BelgelerSekmesi } from './sekmeler/belgeler'
import { GecmisSekmesi } from './sekmeler/gecmis'

const SEKMELER = [
  { anahtar: 'genel', etiket: 'Genel' }, { anahtar: 'malikler', etiket: 'Malikler' }, { anahtar: 'donemler', etiket: 'Kira dönemleri ve artışlar' },
  { anahtar: 'taksitler', etiket: 'Taksitler' }, { anahtar: 'belgeler', etiket: 'Belgeler' }, { anahtar: 'gecmis', etiket: 'Geçmiş' },
]

export default async function SozlesmeSayfasi({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sekme?: string | string[] }> }) {
  await kullaniciGerekli()
  const id = yolKimligi((await params).id)
  if (id === null) notFound()
  const { sekme: hamSekme } = await searchParams
  // Bilinmeyen ya da çoklu sekme değeri genel sekmeye düşer.
  const sekme = SEKMELER.find((x) => x.anahtar === hamSekme)?.anahtar ?? 'genel'
  const s = await sozlesmeDetayi(id).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  return (
    <>
      <SayfaBasligi baslik={`${s.sozlesmeNo} — ${s.tasinmaz.kisaAd}`} aciklama={s.birim.ad} />
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm md:grid-cols-4">
        <div>Durum<br /><Rozet ton={DURUM_TONU[s.durum]}>{DURUM_ETIKETI[s.durum]}</Rozet></div>
        <div>Güncel bedel<br /><strong><ParaMetni deger={s.guncelBedel} /></strong> /{s.bedelTabani === 'AYLIK' ? 'ay' : 'yıl'} ({s.bedelTuru === 'BRUT' ? 'brüt' : 'net'})</div>
        <div>Bitiş<br /><TarihMetni deger={tarihDbOpt(s.bitis)} />{s.kalanGun !== null ? ` (${s.kalanGun} gün)` : ' (belirsiz süreli)'}</div>
        <div>Uzama sayısı<br />{s.uzamaSayisi}</div>
      </div>
      {s.uyarilar.length ? <div className="mb-4 space-y-1">{s.uyarilar.map((u) => <Uyari key={u.kod} ton="uyari">{u.mesaj}</Uyari>)}</div> : null}
      <Sekmeler sekmeler={SEKMELER} aktif={sekme} temelUrl={`/sozlesmeler/${id}`} />
      <div className="mt-4">
        {sekme === 'genel' ? <GenelSekmesi s={s} /> : null}
        {sekme === 'malikler' ? <MaliklerSekmesi s={s} kisiler={(await sihirbazSecenekleri()).kisiler} /> : null}
        {sekme === 'donemler' ? <DonemlerSekmesi s={s} /> : null}
        {sekme === 'taksitler' ? <TaksitlerSekmesi s={s} /> : null}
        {sekme === 'belgeler' ? <BelgelerSekmesi s={s} /> : null}
        {sekme === 'gecmis' ? <GecmisSekmesi s={s} /> : null}
      </div>
    </>
  )
}
