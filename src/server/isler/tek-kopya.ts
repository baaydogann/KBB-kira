import { prisma, type Tx } from '../db'

/**
 * Tüm sözleşmeleri dolaşan toplu işler için etkileşimli transaction süresi (Prisma'nın 5 sn'lik varsayılanı gece işini keserdi).
 * `maxWait`: havuzdan bağlantı alma süresi.
 */
const TOPLU_ISLEM = { timeout: 10 * 60_000, maxWait: 30_000 }

/**
 * Transaction kapsamlı danışma kilidi: kilit ve işin tüm sorguları aynı transaction'da (aynı bağlantıda) çalışır; commit/rollback
 * ile kendiliğinden bırakılır. Oturum kapsamlı kilit kullanılmaz: Prisma havuzunda alma/bırakma farklı bağlantıya düşebilir ve
 * kilit ya hiç korumaz ya da sahipsiz kalır. `fn` yalnızca kendisine verilen `tx` ile çalışmalıdır; global `prisma` ile yapılan
 * işler başka bağlantıya düşer ve kilidin koruması dışında kalır.
 *
 * Kilit alınamazsa (başka bir kopya aynı işi çalıştırıyor) `fn` hiç çalışmaz.
 */
export async function tekKopya<T>(isAdi: string, fn: (tx: Tx) => Promise<T>): Promise<{ calisti: true; sonuc: T } | { calisti: false }> {
  return prisma.$transaction(async (tx) => {
    const [r] = await tx.$queryRaw<{ alindi: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${isAdi})) AS alindi`
    if (!r?.alindi) return { calisti: false as const }
    return { calisti: true as const, sonuc: await fn(tx) }
  }, TOPLU_ISLEM)
}
