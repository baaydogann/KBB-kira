import type { Para } from '../para'

export interface MuhtasarGirdisi { kisiId: string; turKodu: string | null; kimlikNo: string; soyadUnvan: string; ad: string; brut: Para; stopaj: Para }

const kodSirasi = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)
const kimlikSirasi = (a: string, b: string): number => (BigInt(a) < BigInt(b) ? -1 : 1)

/** (kisiId, turKodu) başına toplar; stopajı 0 olanları atar; sıra turKodu (null sonda), soyadUnvan (tr), kisiId. */
export function muhtasarSatirlari(g: readonly MuhtasarGirdisi[]): MuhtasarGirdisi[] {
  const gruplar = new Map<string, MuhtasarGirdisi>()
  for (const x of g) {
    const k = `${x.kisiId}:${x.turKodu ?? '-'}`
    const m = gruplar.get(k)
    gruplar.set(k, m ? { ...m, brut: m.brut.plus(x.brut), stopaj: m.stopaj.plus(x.stopaj) } : x)
  }
  return [...gruplar.values()]
    .filter((x) => !x.stopaj.isZero())
    .sort((a, b) => kodSirasi(a.turKodu, b.turKodu) || a.soyadUnvan.localeCompare(b.soyadUnvan, 'tr') || kimlikSirasi(a.kisiId, b.kisiId))
}
