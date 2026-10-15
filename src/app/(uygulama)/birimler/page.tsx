import { kullaniciGerekli } from '@/server/auth/gerekli'
import { birimListesi } from '@/server/birim/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { BirimFormu } from './birim-formu'

export default async function BirimlerSayfasi() {
  await kullaniciGerekli()
  const liste = await birimListesi()
  return (
    <>
      <SayfaBasligi baslik="Harcama birimleri" aciklama="Ödeme emri bütçe tertibi (kurumsal / fonksiyonel / finans kodu) buradan gelir." />
      <div className="space-y-4">
        <Kart baslik="Yeni birim"><BirimFormu /></Kart>
        <Tablo>
          <thead><tr><Th>Birim</Th><Th>Kurumsal</Th><Th>Fonksiyonel</Th><Th>Finans</Th><Th>Gerçekleştirme görevlisi</Th><Th>Harcama yetkilisi</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((b) => (
              <tr key={b.id}><Td>{b.ad}</Td><Td>{b.kurumsalKod}</Td><Td>{b.fonksiyonelKod}</Td><Td>{b.finansKodu}</Td><Td>{b.gerceklestirmeGorevlisi ?? '—'}</Td><Td>{b.harcamaYetkilisi ?? '—'}</Td></tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
