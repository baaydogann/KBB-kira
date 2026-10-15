import { prisma, type Tx } from '../db'

/**
 * Kilit tutan işlem: yalnızca danışma kilidini alır ve iş bitene dek açık kalır (satır kilidi, yazma yok). Süre dolarsa Prisma işlemi
 * sonlandırır ve kilit düşer, bu yüzden en kötü iş süresinden uzundur (gece işi dakikalar sürer). `maxWait`: havuzdan bağlantı alma süresi.
 */
const KILIT_ISLEMI = { timeout: 60 * 60_000, maxWait: 30_000 }

/** Kilit alınamadığında (aynı iş başka bir süreçte/kopyada çalışıyor) iş kaydına ve ekrana yazılan neden. */
export const BASKA_CALISMA_MESAJI = 'Başka bir çalışma sürüyor; daha sonra tekrar deneyin.'

/**
 * İşin danışma kilidini BU işlemde dener (alırsa işlem bitene dek tutar). Anahtar tek yerde tanımlıdır: `tekKopya`, takılı kayıt süpürmesi
 * ve gözetimin "çalışıyor mu" denetimi (`isKilidiTutuluyorMu`) aynı `hashtext(isAdi)` değerini kullanır, böylece biri kilidi tutuyorsa hepsi görür.
 */
export async function isKilidiniDene(tx: Tx, isAdi: string): Promise<boolean> {
  const [r] = await tx.$queryRaw<{ alindi: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${isAdi})) AS alindi`
  return r?.alindi === true
}

/**
 * İşin danışma kilidi şu an bir yerde (worker ya da web süreci) tutuluyor mu? Salt okunur: kilidi ALMAZ, işlem açmaz, `pg_locks`'a bakar;
 * bu yüzden zamanlayıcının aynı saniyedeki kendi tetiklemesiyle yarışıp onu ATLANDI yapamaz (`isKilidiniDene` yapardı).
 * `pg_try_advisory_xact_lock(bigint)` anahtarı `pg_locks`ta `classid` (üst 32 bit) ve `objid` (alt 32 bit) olarak, `objsubid = 1` ile görünür;
 * `hashtext` negatif olabilir, işaretli 64 bit birleştirme anahtarı aynen geri verir.
 */
export async function isKilidiTutuluyorMu(db: Tx, isAdi: string): Promise<boolean> {
  const [r] = await db.$queryRaw<{ tutuluyor: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 1 AND granted
        AND ((classid::bigint << 32) | objid::bigint) = hashtext(${isAdi})::bigint
    ) AS tutuluyor`
  return r?.tutuluyor === true
}

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
    if (!(await isKilidiniDene(kilit, isAdi))) return { calisti: false as const }
    return { calisti: true as const, sonuc: await fn() }
  }, KILIT_ISLEMI)
}
