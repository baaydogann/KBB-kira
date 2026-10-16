import { execSync } from 'node:child_process'
import { prisma } from '@/server/db'
import { sifreHashle } from '@/server/auth/parola'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { temizle, testVeritabaniniDogrula } from '../integration/yardimci'

export const E2E_KULLANICI = { kullaniciAdi: 'e2e.kullanici', sifre: 'e2e-sifre-123456' }

export default async function kurulum(): Promise<void> {
  testVeritabaniniDogrula(process.env.DATABASE_URL) // controller kararı (Task 12): ayrıştırılmış ad/host denetimi
  // Yıkıcı olmayan şema kurulumu (controller kararı, Task 12): migrate reset yerine deploy + tablo boşaltma.
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: process.env })
  await temizle()
  await seedVerisiniYukle(prisma, { tufeOnayli: true })
  await prisma.kullanici.create({ data: { kullaniciAdi: E2E_KULLANICI.kullaniciAdi, adSoyad: 'E2E Kullanıcı', sifreHash: await sifreHashle(E2E_KULLANICI.sifre), sifreDegismeli: false } })
  const birim = await prisma.birim.create({ data: { ad: 'Emlak ve İstimlak Dairesi', kurumsalKod: '46.01.33.01', fonksiyonelKod: '01.3.9.00' } })
  await prisma.tasinmaz.create({ data: { tur: 'ISYERI', kisaAd: 'Meram hizmet binası', adres: 'Meram', ilce: 'Meram', kullanimAmaci: 'HIZMET_BINASI', kullananBirimId: birim.id } })
  const kisi = await prisma.kisi.create({ data: { tip: 'GERCEK', tckn: '10000000146', ad: 'Deneme', soyad: 'Malik', vergiStatusu: 'GMSI_GERCEK' } })
  await prisma.iban.create({ data: { kisiId: kisi.id, iban: 'TR330006100519786457841326', bankaAdi: 'Deneme Bankası' } })
  await prisma.$disconnect()
}
