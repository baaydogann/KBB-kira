import { kullaniciGerekli } from '@/server/auth/gerekli'
import { birimListesi } from '@/server/birim/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { TasinmazFormu } from '../tasinmaz-formu'

export default async function YeniTasinmazSayfasi() {
  await kullaniciGerekli()
  const birimler = (await birimListesi(true)).map((b) => ({ id: b.id, ad: b.ad }))
  return (
    <>
      <SayfaBasligi baslik="Yeni taşınmaz" />
      <Kart><TasinmazFormu birimler={birimler} /></Kart>
    </>
  )
}
