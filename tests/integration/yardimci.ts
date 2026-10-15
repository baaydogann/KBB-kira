import { prisma } from '@/server/db'
import type { IslemBaglami } from '@/server/baglam'

const TABLOLAR = [
  'olay_gunlugu', 'hatirlatma', 'belge', 'is_calisma', 'taksit', 'kira_donemi', 'artis_hesabi',
  'sozlesme_malik', 'sozlesme', 'iban', 'kisi', 'tasinmaz', 'birim', 'endeks_degeri', 'parametre',
  'tatil', 'oturum', 'kullanici',
]

export async function temizle(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLOLAR.join(', ')} RESTART IDENTITY CASCADE`)
}

export const TEST_BAGLAMI: IslemBaglami = { kullaniciId: null, ip: '127.0.0.1' }
