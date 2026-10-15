import Decimal from 'decimal.js'
import { basarili, hatali, type Sonuc } from './sonuc'

/** Projedeki tek Decimal sınıfı: 40 anlamlı basamak, varsayılan yarım yukarı. */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
})

export type Para = Decimal
export type Yuvarlama = 'YARIM_YUKARI' | 'ASAGI'

const MOD: Record<Yuvarlama, Decimal.Rounding> = {
  YARIM_YUKARI: Decimal.ROUND_HALF_UP,
  ASAGI: Decimal.ROUND_DOWN,
}

export const SIFIR: Para = new D(0)
export const YUZ: Para = new D(100)

/**
 * Programcı kontrolündeki değerleri (DB, sabit) Decimal'e çevirir.
 * Kullanıcı girdisi için `paraAyristir` kullanın.
 */
export function para(deger: string | { toString(): string }): Para {
  const metin = typeof deger === 'string' ? deger : deger.toString()
  const x = new D(metin.trim())
  if (!x.isFinite()) throw new Error(`Sonlu olmayan sayı: ${metin}`)
  return x
}

export function yuvarla(x: Para, mod: Yuvarlama = 'YARIM_YUKARI'): Para {
  return x.toDecimalPlaces(2, MOD[mod])
}

export function topla(xs: readonly Para[]): Para {
  return xs.reduce<Para>((a, b) => a.plus(b), SIFIR)
}

export function enKucuk(a: Para, b: Para): Para {
  return a.lessThanOrEqualTo(b) ? a : b
}

export function enBuyuk(a: Para, b: Para): Para {
  return a.greaterThanOrEqualTo(b) ? a : b
}

export function kurusaCevir(x: Para): bigint {
  if (x.decimalPlaces() > 2) throw new Error(`Kuruştan küçük kesir içeren tutar: ${x.toString()}`)
  return BigInt(x.times(100).toFixed(0))
}

export function kurustanPara(k: bigint): Para {
  return new D(k.toString()).dividedBy(100)
}

export function formatTL(x: Para | string, sembol = true): string {
  const d = typeof x === 'string' ? new D(x) : x
  const metin = yuvarla(d).toFixed(2)
  const negatif = metin.startsWith('-')
  const [tam = '0', kesir = '00'] = (negatif ? metin.slice(1) : metin).split('.')
  const gruplu = tam.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negatif ? '-' : ''}${gruplu},${kesir}${sembol ? ' ₺' : ''}`
}

export function formatOran(x: Para): string {
  const metin = x.decimalPlaces() <= 2 ? x.toFixed(2) : x.toDecimalPlaces(4).toFixed()
  return `%${metin.replace('.', ',')}`
}

const TL_GRUPLU = /^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/
const TL_DUZ = /^-?\d+(,\d{1,2})?$/

/** Türk biçimli tutar: "1.234,56", "1234,56", "1.234" (binlik). "1234.56" reddedilir. */
export function paraAyristir(girdi: string): Sonuc<Para> {
  const temiz = girdi.replace(/\s+/g, '').replace(/(₺|TL)$/i, '')
  if (!TL_GRUPLU.test(temiz) && !TL_DUZ.test(temiz)) {
    return hatali({ kod: 'TUTAR_GECERSIZ', mesaj: 'Tutarı 1.234,56 biçiminde girin (ondalık ayracı virgül).' })
  }
  return basarili(yuvarla(new D(temiz.replace(/\./g, '').replace(',', '.'))))
}

const ORAN = /^-?\d+(,\d{1,4})?$/

/** Yüzde oranı: "31,49" veya "%31,49". En çok dört ondalık. */
export function oranAyristir(girdi: string): Sonuc<Para> {
  const temiz = girdi.replace(/\s+/g, '').replace(/^%/, '')
  if (!ORAN.test(temiz)) {
    return hatali({ kod: 'TUTAR_GECERSIZ', mesaj: 'Oranı 31,49 biçiminde girin (en çok 4 ondalık).' })
  }
  return basarili(new D(temiz.replace(',', '.')))
}
