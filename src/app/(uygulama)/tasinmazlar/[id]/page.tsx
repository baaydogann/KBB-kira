import Link from 'next/link'
import { notFound } from 'next/navigation'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { birimListesi } from '@/server/birim/servis'
import { tasinmazGetir } from '@/server/tasinmaz/servis'
import { BulunamadiHatasi } from '@/server/hata'
import { paraDbOpt } from '@/server/donustur'
import { formatTL } from '@/core/para'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { TasinmazFormu } from '../tasinmaz-formu'

export default async function TasinmazSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const kimlik = yolKimligi((await params).id)
  if (kimlik === null) notFound()
  const t = await tasinmazGetir(kimlik).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  const birimler = (await birimListesi(true)).map((b) => ({ id: b.id, ad: b.ad }))
  const m2 = paraDbOpt(t.m2)
  // İstemci bileşenine yalnızca form alanları geçer: Prisma satırı (Decimal içeren sözleşmeler dahil) serileştirilemez.
  const veri = {
    id: t.id, version: t.version, tur: t.tur, kisaAd: t.kisaAd, adres: t.adres, ilce: t.ilce, mahalle: t.mahalle,
    ada: t.ada, parsel: t.parsel, bagimsizBolum: t.bagimsizBolum, tapuBilgisi: t.tapuBilgisi,
    m2: m2 === null ? null : formatTL(m2, false),
    kullananBirimId: t.kullananBirimId, kullanimAmaci: t.kullanimAmaci, notlar: t.notlar,
  }
  return (
    <>
      <SayfaBasligi baslik={t.kisaAd} aciklama={t.adres} />
      <div className="space-y-4">
        <Kart baslik="Bilgiler"><TasinmazFormu birimler={birimler} veri={veri} /></Kart>
        <Kart baslik="Sözleşmeler">
          {t.sozlesmeler.length === 0 ? <p className="text-sm text-slate-500">Bu taşınmaza bağlı sözleşme yok.</p> : (
            <ul className="list-disc pl-5 text-sm">
              {t.sozlesmeler.map((s) => <li key={s.id}><Link href={`/sozlesmeler/${s.id}`} className="text-marka hover:underline">{s.sozlesmeNo}</Link> — {s.durum}</li>)}
            </ul>
          )}
        </Kart>
      </div>
    </>
  )
}
