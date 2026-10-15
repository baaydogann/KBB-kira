import { kullaniciGerekli } from '@/server/auth/gerekli'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { KisiFormu } from '../kisi-formu'

export default async function YeniKisiSayfasi() {
  await kullaniciGerekli()
  return (
    <>
      <SayfaBasligi baslik="Yeni kişi" aciklama="Malik, hak sahibi veya vekil." />
      <Kart><KisiFormu /></Kart>
    </>
  )
}
