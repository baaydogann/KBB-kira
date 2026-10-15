import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { prisma } from '@/server/db'
import { SISTEM_BAGLAMI } from '@/server/baglam'
import { kullaniciOlustur } from '@/server/kullanici/servis'

const { values } = parseArgs({ options: { 'kullanici-adi': { type: 'string' }, 'ad-soyad': { type: 'string' } } })
const kullaniciAdi = values['kullanici-adi']
const adSoyad = values['ad-soyad']

if (!kullaniciAdi || !adSoyad) {
  console.error('Kullanım: pnpm kullanici:olustur --kullanici-adi ayse.yilmaz --ad-soyad "Ayşe Yılmaz"')
  process.exit(1)
}

const geciciSifre = randomBytes(12).toString('base64url')

kullaniciOlustur({ kullaniciAdi, adSoyad, geciciSifre }, SISTEM_BAGLAMI)
  .then(() => {
    console.log(`Kullanıcı oluşturuldu: ${kullaniciAdi}`)
    console.log(`Geçici şifre (yalnızca bir kez gösterilir): ${geciciSifre}`)
    console.log('İlk girişte şifre değiştirilecek.')
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
