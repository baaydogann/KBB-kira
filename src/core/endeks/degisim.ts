import { SIFIR, YUZ, yuvarla, type Para } from '../para'
import { basarili, hatali, type Sonuc } from '../sonuc'
import { ayAnahtari, ayKaydir, type Ay } from '../tarih'

export type EndeksTablosu = ReadonlyMap<string, Para>

function eksik(ay: Ay): Sonuc<never> {
  return hatali({ kod: 'ENDEKS_YOK', mesaj: `${ayAnahtari(ay)} endeks değeri yok.` })
}

/** TÜFE12: son 12 ayın endeks toplamı / önceki 12 ayın toplamı − 1, yüzde, 2 ondalık. */
export function onIkiAyOrtalamaDegisim(t: EndeksTablosu, ay: Ay): Sonuc<Para> {
  let son = SIFIR
  let onceki = SIFIR
  for (let k = 0; k < 24; k++) {
    const a = ayKaydir(ay, -k)
    const v = t.get(ayAnahtari(a))
    if (v === undefined) return eksik(a)
    if (k < 12) son = son.plus(v)
    else onceki = onceki.plus(v)
  }
  return basarili(yuvarla(son.dividedBy(onceki).minus(1).times(YUZ)))
}

export function yillikDegisim(t: EndeksTablosu, ay: Ay): Sonuc<Para> {
  const simdi = t.get(ayAnahtari(ay))
  if (simdi === undefined) return eksik(ay)
  const gecen = ayKaydir(ay, -12)
  const once = t.get(ayAnahtari(gecen))
  if (once === undefined) return eksik(gecen)
  return basarili(yuvarla(simdi.dividedBy(once).minus(1).times(YUZ)))
}
