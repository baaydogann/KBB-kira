import { prisma } from '@/server/db'
import type { IslemBaglami } from '@/server/baglam'

const YEREL_SUNUCULAR = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'])

/**
 * Entegrasyon testleri veritabanını TRUNCATE eder; yalnızca yerel bir *_test
 * veritabanında çalışmalıdır. Hata iletisi parola/tam adres içermez.
 */
export function testVeritabaniniDogrula(url: string | undefined): void {
  let ad: string
  let sunucu: string
  try {
    const u = new URL(url ?? '')
    ad = decodeURIComponent(u.pathname.slice(1))
    sunucu = u.hostname
  } catch {
    throw new Error('Entegrasyon testleri için geçerli bir DATABASE_URL gerekir.')
  }
  if (!/_test$/.test(ad) || !YEREL_SUNUCULAR.has(sunucu)) {
    throw new Error(`Entegrasyon testleri yalnızca yerel *_test veritabanında çalışır; veritabanı: "${ad}", sunucu: "${sunucu}".`)
  }
}

const tirnakla = (kimlik: string): string => `"${kimlik.replaceAll('"', '""')}"`

/** public şemasındaki tüm tabloları (Prisma geçmişi hariç) boşaltır; sonradan eklenen tablolar da kapsanır. */
export async function temizle(): Promise<void> {
  testVeritabaniniDogrula(process.env.DATABASE_URL)
  const satirlar = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (satirlar.length === 0) return
  const liste = satirlar.map((s) => tirnakla(s.tablename)).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE ${liste} RESTART IDENTITY CASCADE`)
}

export const TEST_BAGLAMI: IslemBaglami = { kullaniciId: null, ip: '127.0.0.1' }
