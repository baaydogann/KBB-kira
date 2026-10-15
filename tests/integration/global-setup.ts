import { execSync } from 'node:child_process'

export default function kurulum(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.includes('_test')) {
    throw new Error(`Entegrasyon testleri yalnızca *_test veritabanında çalışır, verilen: ${url}`)
  }
  // yıkıcı olmayan şema kurulumu; izolasyon her testteki temizle() ile
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: process.env })
}
