import { notFound, redirect } from 'next/navigation'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { belgeListesi } from '@/server/belge/servis'
import { BulunamadiHatasi } from '@/server/hata'
import { sihirbazSecenekleri, sozlesmeTaslakFormu } from '@/server/sozlesme/sorgu'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Sihirbaz } from '../../_bilesenler/sihirbaz'

export default async function SozlesmeDuzenleSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const id = yolKimligi((await params).id)
  if (id === null) notFound()
  const f = await sozlesmeTaslakFormu(id).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  if (f.durum !== 'TASLAK') redirect(`/sozlesmeler/${id}`)
  const [secenekler, belgeler] = await Promise.all([sihirbazSecenekleri(), belgeListesi('sozlesme', id)])
  const pdf = belgeler.find((b) => b.belgeTuru === 'SOZLESME')
  return (
    <>
      <SayfaBasligi baslik={`Taslağı düzenle — ${f.veri.sozlesmeNo}`} />
      <Sihirbaz baslangicVerisi={f.veri} secenekler={secenekler} id={f.id} version={f.version} belgeId={pdf?.id ?? null} />
    </>
  )
}
