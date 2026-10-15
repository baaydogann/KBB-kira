import { prisma } from '../db'

/**
 * Kilit tutan işlem: yalnızca danışma kilidini alır ve iş bitene dek açık kalır (satır kilidi, yazma yok). Süre dolarsa Prisma işlemi
 * sonlandırır ve kilit düşer, bu yüzden en kötü iş süresinden uzundur (gece işi dakikalar sürer). `maxWait`: havuzdan bağlantı alma süresi.
 */
const KILIT_ISLEMI = { timeout: 60 * 60_000, maxWait: 30_000 }

/** Kilit alınamadığında (aynı iş başka bir süreçte/kopyada çalışıyor) iş kaydına ve ekrana yazılan neden. */
export const BASKA_CALISMA_MESAJI = 'Başka bir çalışma sürüyor; daha sonra tekrar deneyin.'

/**
 * Transaction kapsamlı danışma kilidi (`pg_try_advisory_xact_lock`) tutan işlem açar ve `fn`'i onun açık olduğu sürece çalıştırır.
 * Kilit bu işlemin bağlantısına aittir ve commit/rollback ile (süreç ölse bile bağlantı düşünce) kendiliğinden bırakılır;
 * oturum kapsamlı kilit kullanılmaz çünkü Prisma havuzunda alma/bırakma farklı bağlantıya düşebilir.
 *
 * `fn` kilit işlemini kullanmaz: işini kendi kısa işlemleriyle (global `prisma`, sözleşme başına bir işlem) yapar, böylece
 * tek uzun işlem tüm sözleşme satır kilitlerini tutmaz. Kilit tutan işlem hiçbir satırı kilitlemez ve yazmaz.
 *
 * Kilit alınamazsa `fn` hiç çalışmaz ve hemen `{ calisti: false }` döner; `fn` hata atarsa hata yayılır ve kilit bırakılır.
 */
export async function tekKopya<T>(isAdi: string, fn: () => Promise<T>): Promise<{ calisti: true; sonuc: T } | { calisti: false }> {
  return prisma.$transaction(async (kilit) => {
    const [r] = await kilit.$queryRaw<{ alindi: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${isAdi})) AS alindi`
    if (!r?.alindi) return { calisti: false as const }
    return { calisti: true as const, sonuc: await fn() }
  }, KILIT_ISLEMI)
}
