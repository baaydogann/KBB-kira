import Link from 'next/link'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { birimListesi } from '@/server/birim/servis'
import { paketListesi } from '@/server/paket/sorgu'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { PAKET_DURUMLARI, PAKET_DURUM_ETIKETI, PAKET_DURUM_TONU } from './durum'
import { PaketFormu } from './paket-formu'

export default async function OdemePaketleriSayfasi({ searchParams }: { searchParams: Promise<{ durum?: string | string[] }> }) {
  await kullaniciGerekli()
  const { durum: hamDurum } = await searchParams
  const durum = PAKET_DURUMLARI.find((d) => d === hamDurum)
  const [liste, birimler] = await Promise.all([paketListesi({ durum }), birimListesi(true)])
  return (
    <>
      <SayfaBasligi baslik="Ödeme paketleri" aciklama="Taslak → hesapla → kesinleştir → ödeme emri → ödendi" />
      <div className="space-y-4">
        <Kart baslik="Yeni paket"><PaketFormu birimler={birimler.map((b) => ({ id: b.id, ad: b.ad }))} /></Kart>
        <form className="flex gap-2">
          <select name="durum" defaultValue={durum ?? ''} aria-label="Durum" className="rounded-md border border-slate-300 px-2 text-sm">
            <option value="">Tüm durumlar</option>
            {PAKET_DURUMLARI.map((d) => <option key={d} value={d}>{PAKET_DURUM_ETIKETI[d]}</option>)}
          </select>
          <button className="rounded-md border border-slate-300 bg-white px-3 text-sm">Süz</button>
        </form>
        <Tablo>
          <thead><tr><Th>No</Th><Th>Ad</Th><Th>Birim</Th><Th>Vade aralığı</Th><Th>Durum</Th><Th className="text-right">Taksit</Th><Th className="text-right">Net</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/odeme-paketleri/${p.id}`} className="text-marka hover:underline">#{p.id}</Link></Td>
                <Td>{p.ad}</Td>
                <Td>{p.birim}</Td>
                <Td><TarihMetni deger={p.vadeBaslangic} /> – <TarihMetni deger={p.vadeBitis} /></Td>
                <Td><Rozet ton={PAKET_DURUM_TONU[p.durum]}>{PAKET_DURUM_ETIKETI[p.durum]}</Rozet></Td>
                <Td className="text-right">{p.taksitSayisi}</Td>
                <Td className="text-right">{p.net === null ? '—' : <ParaMetni deger={p.net} />}</Td>
              </tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
