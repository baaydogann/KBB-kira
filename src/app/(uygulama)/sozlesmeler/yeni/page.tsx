import { kullaniciGerekli } from '@/server/auth/gerekli'
import { sihirbazSecenekleri } from '@/server/sozlesme/sorgu'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Sihirbaz } from '../_bilesenler/sihirbaz'
import { BOS_SIHIRBAZ } from '../_bilesenler/secenekler'

export default async function YeniSozlesmeSayfasi() {
  await kullaniciGerekli()
  const secenekler = await sihirbazSecenekleri()
  return (
    <>
      <SayfaBasligi baslik="Yeni sözleşme" aciklama="Taslak olarak kaydedilir; kontrol ettikten sonra sözleşme sayfasından aktifleştirin." />
      <Sihirbaz baslangicVerisi={BOS_SIHIRBAZ} secenekler={secenekler} id={null} version={null} belgeId={null} />
    </>
  )
}
