import { execSync } from 'node:child_process'
import { testVeritabaniniDogrula } from './yardimci'

export default function kurulum(): void {
  testVeritabaniniDogrula(process.env.DATABASE_URL)
  // yıkıcı olmayan şema kurulumu; izolasyon her testteki temizle() ile
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env: process.env })
}
