import { basarili, hatali, type Sonuc } from './sonuc'

export interface Kesir { pay: number; payda: number }
/** kisiId sayısal string olmalıdır (veritabanı kimliği); eşitlik bozmada sayısal karşılaştırılır. */
export interface Hisse extends Kesir { kisiId: string }
export interface HissePayi { kisiId: string; kurus: bigint }

const AZAMI_PAYDA = 1_000_000

function ebob(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function tamsayiMi(x: number): boolean {
  return typeof x === 'number' && x % 1 === 0
}

export function kesirGecerliMi(k: Kesir): boolean {
  return tamsayiMi(k.pay) && tamsayiMi(k.payda) && k.pay > 0 && k.payda > 0 && k.pay <= k.payda && k.payda <= AZAMI_PAYDA
}

export function hisseToplami(hisseler: readonly Kesir[]): { pay: bigint; payda: bigint } {
  let pay = 0n
  let payda = 1n
  for (const h of hisseler) {
    const p = BigInt(h.pay)
    const q = BigInt(h.payda)
    pay = pay * q + p * payda
    payda = payda * q
    const g = ebob(pay, payda)
    pay /= g
    payda /= g
  }
  return { pay, payda }
}

export function hisseToplamiBirMi(hisseler: readonly Kesir[]): boolean {
  if (hisseler.length === 0 || !hisseler.every(kesirGecerliMi)) return false
  const t = hisseToplami(hisseler)
  return t.pay === t.payda
}

/** K3 — en büyük kalan (Hamilton) yöntemi. Σ sonuç = toplamKurus. */
export function hisseyeDagit(toplamKurus: bigint, hisseler: readonly Hisse[]): Sonuc<HissePayi[]> {
  if (toplamKurus < 0n) {
    return hatali({ kod: 'GECERSIZ_GIRDI', mesaj: 'Dağıtılacak tutar negatif olamaz.' })
  }
  if (!hisseToplamiBirMi(hisseler)) {
    return hatali({ kod: 'HISSE_TOPLAMI_HATALI', mesaj: 'Hisselerin toplamı tam olarak 1 olmalı.' })
  }
  const satirlar = hisseler.map((h, sira) => {
    const carpim = toplamKurus * BigInt(h.pay)
    const q = BigInt(h.payda)
    return { kisiId: h.kisiId, sira, taban: carpim / q, kalanPay: carpim % q, kalanPayda: q }
  })
  let artik = toplamKurus - satirlar.reduce((a, s) => a + s.taban, 0n)
  const sirali = [...satirlar].sort((a, b) => {
    const sol = a.kalanPay * b.kalanPayda
    const sag = b.kalanPay * a.kalanPayda
    if (sol !== sag) return sol > sag ? -1 : 1
    const ia = BigInt(a.kisiId)
    const ib = BigInt(b.kisiId)
    if (ia !== ib) return ia < ib ? -1 : 1
    return a.sira - b.sira
  })
  const ek = new Set<number>()
  for (const s of sirali) {
    if (artik === 0n) break
    ek.add(s.sira)
    artik -= 1n
  }
  return basarili(satirlar.map((s) => ({ kisiId: s.kisiId, kurus: s.taban + (ek.has(s.sira) ? 1n : 0n) })))
}
