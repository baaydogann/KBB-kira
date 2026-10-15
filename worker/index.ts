import { Cron } from 'croner'
import { bugunIstanbul } from '@/core/tarih'
import { prisma } from '@/server/db'
import { ortam } from '@/server/env'
import { ISLER, type IsAdi } from '@/server/isler'
import { isCalistir } from '@/server/isler/kayit'

const ZAMAN_DILIMI = 'Europe/Istanbul'
/** Kapanışta çalışan işlerin bitmesi için beklenen en uzun süre (Docker'ın varsayılan 10 sn'lik SIGTERM süresine sığar). */
const KAPANIS_BEKLEME_MS = 8_000

// Hatalı yapılandırma gece 05:30'u beklemeden açılışta görünsün.
ortam()

const calisanlar = new Set<Promise<unknown>>()

/** "Bugün" her çalışmanın başında hesaplanır: açılıştaki telafi ve gün aşımı sonrası tetiklenen çalışmalar doğru günü kullanır. */
async function calistir(ad: IsAdi): Promise<void> {
  const p = isCalistir(ad, () => ISLER[ad](bugunIstanbul()))
  calisanlar.add(p)
  try {
    await p
  } finally {
    calisanlar.delete(p)
  }
}

const ortak = { timezone: ZAMAN_DILIMI, protect: true, catch: (e: unknown) => console.error('Zamanlayıcı hatası:', e) }

const isler = [
  new Cron('30 5 * * *', ortak, () => calistir('takvim-guncelle')),
  new Cron('0 6 * * *', ortak, () => calistir('hatirlatma-uret')),
  new Cron('15 10-17 3-10 * *', ortak, () => calistir('endeks-cek')),
]

let kapaniyor = false

async function telafi(): Promise<void> {
  // Sunucu 05:30/06:00'da kapalıysa iş kaçmasın: açılışta sırayla bir kez çalıştır. İşler idempotenttir (her biri yalnızca
  // eksik/değişen kaydı yazar) ve kilit alınamazsa atlanır; bir işin hatası diğerlerini engellemez.
  for (const ad of ['takvim-guncelle', 'endeks-cek', 'hatirlatma-uret'] as const) {
    if (kapaniyor) return
    try {
      await calistir(ad)
    } catch (e) {
      console.error(`Telafi çalışması başarısız (${ad}):`, e)
    }
  }
}

async function kapat(sinyal: string): Promise<void> {
  if (kapaniyor) return
  kapaniyor = true
  console.log(`${sinyal} alındı; yeni çalışma başlatılmıyor, çalışan işler bekleniyor.`)
  for (const c of isler) c.stop()
  const sureDoldu = new Promise<void>((tamam) => setTimeout(tamam, KAPANIS_BEKLEME_MS))
  await Promise.race([Promise.allSettled([...calisanlar]), sureDoldu])
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void kapat('SIGTERM'))
process.on('SIGINT', () => void kapat('SIGINT'))

console.log(`Worker başladı (${ZAMAN_DILIMI}). Sonraki çalışmalar:`, isler.map((c) => c.nextRun()?.toISOString()))
void telafi()
