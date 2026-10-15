/** Süreç içi kayan pencere. Tek web örneği çalıştığı için yeterli. */
export function hizSinirlayici(limit: number, pencereMs: number) {
  const kayitlar = new Map<string, number[]>()
  return {
    dene(anahtar: string, simdi = Date.now()): boolean {
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
  }
}
