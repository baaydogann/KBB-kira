import { Cron } from 'croner'
import { bugunIstanbul } from '@/core/tarih'
import { prisma } from '@/server/db'
import { ortam } from '@/server/env'
import { ISLER } from '@/server/isler'
import { gozetimTuru } from '@/server/isler/gozetim'
import { isCalistir, takiliCalismalariSupur, yurutulenCalismalariTerket } from '@/server/isler/kayit'
import { GOZETIM_ZAMANI, IS_ZAMANLARI, ZAMAN_DILIMI, type IsAdi } from '@/server/isler/zamanlama'

/** Kapanışta çalışan işlerin bitmesi için beklenen en uzun süre (Docker'ın varsayılan 10 sn'lik SIGTERM süresine sığar). */
const KAPANIS_BEKLEME_MS = 8_000

// Hatalı yapılandırma gece 05:30'u beklemeden açılışta görünsün.
ortam()

const calisanlar = new Set<Promise<unknown>>()
const isler: Cron[] = []
let kapaniyor = false

/** "Bugün" her çalışmanın başında hesaplanır: gözetimin telafi çalışmaları ve gün aşımı sonrası tetiklenen çalışmalar doğru günü kullanır. */
async function calistir(ad: IsAdi): Promise<void> {
  if (kapaniyor) return
  const p = isCalistir(ad, () => ISLER[ad](bugunIstanbul()))
  calisanlar.add(p)
  try {
    await p
  } finally {
    calisanlar.delete(p)
  }
}

/**
 * Kaçırılan çalışmaları yakalar (bkz. gozetimTuru; her tur takılı kayıtları da süpürür). Açılışta ve her yarım saatte çalışır.
 * Açılış turu toleranssızdır: kapalıyken zamanı gelen iş hemen yakalanır. Sıradan turlar yalnızca bir şey yaptığında günlüğe yazar.
 */
async function gozetim(kaynak: 'açılış' | 'periyodik'): Promise<void> {
  if (kapaniyor) return
  try {
    const { supurulen, sonuclar } = await gozetimTuru(calistir, { toleransMs: kaynak === 'açılış' ? 0 : undefined, durdu: () => kapaniyor })
    if (supurulen > 0) console.log(`Gözetim (${kaynak}): takılı kalmış ${supurulen} çalışma HATALI işaretlendi.`)
    const ozet = sonuclar.map((s) => `${s.ad}=${s.karar}`).join(', ')
    if (kaynak === 'açılış' || sonuclar.some((s) => s.karar === 'calistirildi' || s.karar === 'hata')) console.log(`Gözetim (${kaynak}): ${ozet}`)
  } catch (e) {
    console.error('Gözetim turu başarısız:', e)
  }
}

async function baslat(): Promise<void> {
  // Önceki süreç ölürken CALISIYOR kalan kayıtlar, başka hiçbir şey yapılmadan temizlenir.
  try {
    const temizlenen = await takiliCalismalariSupur()
    console.log(temizlenen > 0 ? `Takılı kalmış ${temizlenen} çalışma HATALI işaretlendi.` : 'Takılı kalmış çalışma yok.')
  } catch (e) {
    console.error('Takılı çalışmalar temizlenemedi:', e)
  }

  if (kapaniyor) return
  const ortak = { timezone: ZAMAN_DILIMI, protect: true, catch: (e: unknown) => console.error('Zamanlayıcı hatası:', e) }
  for (const ad of Object.keys(IS_ZAMANLARI) as IsAdi[]) isler.push(new Cron(IS_ZAMANLARI[ad], ortak, () => calistir(ad)))
  isler.push(new Cron(GOZETIM_ZAMANI, ortak, () => gozetim('periyodik')))
  console.log(`Worker başladı (${ZAMAN_DILIMI}). Sonraki çalışmalar:`, isler.map((c) => c.nextRun()?.toISOString()))

  // Koşulsuz açılış çalıştırması yok: gözetim yalnızca zamanlanmış anından beri başarılı çalışması olmayan işleri çalıştırır.
  await gozetim('açılış')
}

async function kapat(sinyal: string): Promise<void> {
  if (kapaniyor) return
  kapaniyor = true
  console.log(`${sinyal} alındı; yeni çalışma başlatılmıyor, çalışan işler bekleniyor.`)
  for (const c of isler) c.stop()
  const sureDoldu = new Promise<false>((tamam) => setTimeout(() => tamam(false), KAPANIS_BEKLEME_MS))
  const bitti = await Promise.race([Promise.allSettled([...calisanlar]).then(() => true), sureDoldu])
  if (!bitti) {
    try {
      const n = await yurutulenCalismalariTerket()
      console.log(`Bekleme süresi doldu; yarıda kalan ${n} çalışma HATALI işaretlendi.`)
    } catch (e) {
      console.error('Yarıda kalan çalışmalar işaretlenemedi:', e)
    }
  }
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => void kapat('SIGTERM'))
process.on('SIGINT', () => void kapat('SIGINT'))

baslat().catch((e: unknown) => console.error('Worker başlatılamadı:', e))
