import { kullaniciGerekli } from '@/server/auth/gerekli'
import { prisma } from '@/server/db'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { DugmeLink } from '@/components/ui/dugme'
import { TakvimBaglantisi } from './takvim-baglantisi'

export default async function HesabimSayfasi() {
  const k = await kullaniciGerekli()
  // İstemciye yalnızca "bağlantı var mı" bilgisi gider; token özeti sunucuda kalır.
  const kayit = await prisma.kullanici.findUniqueOrThrow({ where: { id: k.id }, select: { icsTokenHash: true } })
  return (
    <>
      <SayfaBasligi baslik="Hesabım" aciklama={`${k.adSoyad} (${k.kullaniciAdi})`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Kart baslik="Şifre"><DugmeLink href="/sifre-degistir">Şifre değiştir</DugmeLink></Kart>
        <Kart baslik="Takvim aboneliği (.ics)"><TakvimBaglantisi varMi={kayit.icsTokenHash !== null} /></Kart>
      </div>
    </>
  )
}
