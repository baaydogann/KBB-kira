import { SIFIR, type Para } from '../para'
import { parcala, type Ay, type Tarih } from '../tarih'

export interface BankaGirdiSatiri {
  kisiId: string; kimlikNo: string; odemeKisiId: string; odemeKisiAdi: string; ibanId: string; iban: string
  net: Para; sozlesmeNo: string; donemBaslangic: Tarih
}

export interface BankaSatiri { sira: number; ad: string; iban: string; tutar: Para; aciklama: string; kisiId: string; odemeKisiId: string }

const ayMetni = (a: Ay) => `${String(a.ay).padStart(2, '0')}/${a.yil}`
const ayAnahtari = (a: Ay) => a.yil * 12 + a.ay
// Aynı ad ve kimlikte iki grup (farklı IBAN ya da ödeme kişisi) sırası girdi sırasıdır; eşit kimlik karşılaştırılmaz.
const kimlikSirasi = (a: string, b: string): -1 | 1 => (BigInt(a) < BigInt(b) ? -1 : 1)

/** "<kimlikNo> – kira ödemesi – <AA/YYYY ya da AA/YYYY–AA/YYYY> – <no[, no…]>" (328 Seri No'lu GVGT). */
export function bankaAciklamasi(kimlikNo: string, aylar: readonly Ay[], sozlesmeNolari: readonly string[]): string {
  const sirali = [...aylar].sort((a, b) => ayAnahtari(a) - ayAnahtari(b))
  const ilk = sirali[0]!
  const son = sirali[sirali.length - 1]!
  const donem = ayAnahtari(ilk) === ayAnahtari(son) ? ayMetni(ilk) : `${ayMetni(ilk)}–${ayMetni(son)}`
  return `${kimlikNo} – kira ödemesi – ${donem} – ${[...new Set(sozlesmeNolari)].sort().join(', ')}`
}

/** Anahtar (kisiId, odemeKisiId, ibanId); net toplamı 0 olan grup atlanır; sıra ad (tr), sonra kisiId. */
export function bankaSatirlari(satirlar: readonly BankaGirdiSatiri[]): BankaSatiri[] {
  const gruplar = new Map<string, BankaGirdiSatiri[]>()
  for (const s of satirlar) {
    const k = `${s.kisiId}:${s.odemeKisiId}:${s.ibanId}`
    gruplar.set(k, [...(gruplar.get(k) ?? []), s])
  }
  return [...gruplar.values()]
    .map((g) => {
      const x = g[0]!
      const tutar = g.reduce((t, s) => t.plus(s.net), SIFIR)
      const aciklama = bankaAciklamasi(x.kimlikNo, g.map((s) => { const p = parcala(s.donemBaslangic); return { yil: p.yil, ay: p.ay } }), g.map((s) => s.sozlesmeNo))
      return { sira: 0, ad: x.odemeKisiAdi, iban: x.iban, tutar, aciklama, kisiId: x.kisiId, odemeKisiId: x.odemeKisiId }
    })
    .filter((s) => !s.tutar.isZero())
    .sort((a, b) => a.ad.localeCompare(b.ad, 'tr') || kimlikSirasi(a.kisiId, b.kisiId))
    .map((s, i) => ({ ...s, sira: i + 1 }))
}
