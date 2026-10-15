function rakamlar(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) - 48)
}

/** T.C. kimlik no: 11 hane, ilk hane 0 değil, 10. ve 11. hane kontrol haneleri. */
export function tcknGecerliMi(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  const d = rakamlar(s)
  const tek = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const cift = d[1]! + d[3]! + d[5]! + d[7]!
  const onuncu = (((tek * 7 - cift) % 10) + 10) % 10
  const onbirinci = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10
  return d[9] === onuncu && d[10] === onbirinci
}

/** Vergi kimlik no: 10 hane, GİB kontrol algoritması. */
export function vknGecerliMi(s: string): boolean {
  if (!/^\d{10}$/.test(s)) return false
  const d = rakamlar(s)
  let toplam = 0
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i]! + 10 - (i + 1)) % 10
    toplam += tmp === 9 ? 9 : (tmp * 2 ** (10 - (i + 1))) % 9
  }
  return d[9] === (10 - (toplam % 10)) % 10
}

export function ibanNormalize(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}

/** Türk IBAN'ı: TR + 24 hane, ISO 13616 mod-97 = 1. */
export function ibanGecerliMi(s: string): boolean {
  const x = ibanNormalize(s)
  if (!/^TR\d{24}$/.test(x)) return false
  const yeniden = x.slice(4) + x.slice(0, 4)
  let kalan = 0
  for (const c of yeniden) {
    const deger = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c
    for (const r of deger) kalan = (kalan * 10 + (r.charCodeAt(0) - 48)) % 97
  }
  return kalan === 1
}

export function ibanBicimle(s: string): string {
  return ibanNormalize(s).replace(/(.{4})(?=.)/g, '$1 ')
}

export function maskele(s: string, gorunen = 4): string {
  const g = gorunen > 0 ? gorunen : 0
  if (s.length <= g) return s
  return '*'.repeat(s.length - g) + s.slice(s.length - g)
}
