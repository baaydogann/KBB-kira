/** Bu kadar anahtar birikince süresi dolmuş olanlar silinir; bellek görülen tüm adreslerle büyümesin. */
const TEMIZLIK_ESIGI = 10_000

/** Süreç içi kayan pencere. Tek web örneği çalıştığı için yeterli. */
export function hizSinirlayici(limit: number, pencereMs: number) {
  const kayitlar = new Map<string, number[]>()
  let sonTemizlik = Number.NEGATIVE_INFINITY

  // Eşik aşıldığında en fazla pencere başına bir kez taranır (her çağrıda O(n) olmasın).
  function bayatlariSil(simdi: number): void {
    if (kayitlar.size <= TEMIZLIK_ESIGI || simdi - sonTemizlik < pencereMs) return
    sonTemizlik = simdi
    for (const [anahtar, zamanlar] of kayitlar) {
      if (Math.max(...zamanlar) <= simdi - pencereMs) kayitlar.delete(anahtar)
    }
  }

  return {
    dene(anahtar: string, simdi = Date.now()): boolean {
      bayatlariSil(simdi)
      const taze = (kayitlar.get(anahtar) ?? []).filter((t) => t > simdi - pencereMs)
      if (taze.length >= limit) {
        kayitlar.set(anahtar, taze)
        return false
      }
      taze.push(simdi)
      kayitlar.set(anahtar, taze)
      return true
    },
    sifirla(anahtar: string): void {
      kayitlar.delete(anahtar)
    },
    /** Tutulan anahtar sayısı (bellek sınırının testi için). */
    boyut(): number {
      return kayitlar.size
    },
  }
}
