import { kullaniciGerekli } from '@/server/auth/gerekli'
import { parametreListesi } from '@/server/parametre/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { TarihMetni } from '@/components/tarih'
import { ParametreFormu } from './parametre-formu'

export default async function ParametrelerSayfasi() {
  await kullaniciGerekli()
  const gruplar = await parametreListesi()
  return (
    <>
      <SayfaBasligi baslik="Parametreler" aciklama="Oranlar, eşikler ve kurallar tarihli tutulur. Geçmiş hesaplar kendi tarihindeki değeri kullanır; kayıtlar silinmez." />
      <div className="space-y-4">
        <Kart baslik="Yeni değer ekle"><ParametreFormu /></Kart>
        <Tablo>
          <thead><tr><Th>Anahtar</Th><Th>Değer</Th><Th>Başlangıç</Th><Th>Bitiş</Th><Th>Dayanak / açıklama</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {gruplar.flatMap((g) => g.kayitlar.map((k, i) => (
              <tr key={k.id} className={i === 0 ? '' : 'text-slate-500'}>
                <Td className="font-mono text-xs">{i === 0 ? g.anahtar : ''}</Td>
                <Td className="max-w-xs break-all font-mono text-xs">{k.deger}</Td>
                <Td><TarihMetni deger={k.yururlukBaslangic} /></Td>
                <Td><TarihMetni deger={k.yururlukBitis} /></Td>
                <Td className="text-xs">{[k.mevzuatDayanagi, k.aciklama].filter(Boolean).join(' — ')}</Td>
              </tr>
            )))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
