import { SIFIR, enKucuk, topla, type Para } from '../para'
import { karsilastir, type Tarih } from '../tarih'
import type { HesapSatiri } from './goruntu'

export type KesintiTuru = 'DAMGA' | 'HACIZ' | 'KESINTI_22A'

/** Bir dağılım satırının kesinti öncesi ödenecek tutarı (brüt + KDV − stopaj). `anahtar` paket içinde benzersizdir. */
export interface KesintiSatiri { anahtar: string; sozlesmeId: string; kisiId: string; vade: Tarih; odenecek: Para }
/** İstihkaktan kesilecek damga vergisinin bir malike düşen kalanı; yalnız aynı sözleşmenin satırlarından kesilir. */
export interface DamgaKalani { damgaPayiId: string; sozlesmeId: string; kisiId: string; olayTarihi: Tarih; kalan: Para }
export interface HacizKalani { hacizId: string; kisiId: string; tebligTarihi: Tarih; kalan: Para }
/** Sunucu kişi başına en çok bir geçerli sorgu verir; kalanBorc = borcTutari − kesinleşmiş paketlerdeki kullanım. */
export interface GecerliSorgu { borcSorguId: string; kisiId: string; borcVar: boolean; borcTutari: Para; kalanBorc: Para }

export interface KesintiGirdisi {
  satirlar: readonly KesintiSatiri[]
  damgalar: readonly DamgaKalani[]
  hacizler: readonly HacizKalani[]
  sorgular: readonly GecerliSorgu[]
  esik22aOdeme: Para
  esik22aBorc: Para
}

export interface UygulananKesinti { satirAnahtari: string; tur: KesintiTuru; tutar: Para; kaynakId: string }
export interface SatirKesintisi { anahtar: string; damga: Para; haciz: Para; kesinti22a: Para; net: Para; satirlar: HesapSatiri[] }
/** Hak sahibi başına 22/A durumu; `odenecek` = Σ (ödenecek − damga − haciz). */
export interface Alici22a { kisiId: string; odenecek: Para; sorguGerekli: boolean; borcSorguId: string | null; kesinti: Para }
export interface KesintiHesabi { kesintiler: UygulananKesinti[]; satirlar: SatirKesintisi[]; alicilar: Alici22a[] }

const sayisal = (a: string, b: string): -1 | 1 => (BigInt(a) < BigInt(b) ? -1 : 1)

interface Durum { girdi: KesintiSatiri; damga: Para; haciz: Para; kesinti22a: Para; satirlar: HesapSatiri[] }

/** Önce eski vade; eşit vadede satır anahtarı (benzersiz). */
function siraliSatirlar(satirlar: readonly KesintiSatiri[]): KesintiSatiri[] {
  return [...satirlar].sort((a, b) => karsilastir(a.vade, b.vade) || (a.anahtar < b.anahtar ? -1 : 1))
}

const kalanTutar = (d: Durum): Para => d.girdi.odenecek.minus(d.damga).minus(d.haciz).minus(d.kesinti22a)

/**
 * Spec §6.5: her satırda sırasıyla istihkaktan damga (aynı sözleşme ve kişi; olay tarihi sırası), haciz (kişinin hacizleri; tebliğ tarihi sırası),
 * ardından hak sahibi bazında 22/A (§6.5.1, §6.5.2). Kesintiler satırlara vade sırasıyla, her satırın kalanına kadar uygulanır; damga ve haciz
 * kalanları satırlar arasında taşınır. Girdi sırası sonucu değiştirmez.
 */
export function kesintiHesabi(g: KesintiGirdisi): KesintiHesabi {
  const kesintiler: UygulananKesinti[] = []
  const durumlar: Durum[] = siraliSatirlar(g.satirlar).map((s) => ({ girdi: s, damga: SIFIR, haciz: SIFIR, kesinti22a: SIFIR, satirlar: [] }))
  const damgalar = [...g.damgalar].sort((a, b) => karsilastir(a.olayTarihi, b.olayTarihi) || sayisal(a.damgaPayiId, b.damgaPayiId))
  const hacizler = [...g.hacizler].sort((a, b) => karsilastir(a.tebligTarihi, b.tebligTarihi) || sayisal(a.hacizId, b.hacizId))
  const damgaKalani = new Map(damgalar.map((d) => [d.damgaPayiId, d.kalan]))
  const hacizKalani = new Map(hacizler.map((h) => [h.hacizId, h.kalan]))

  const uygula = (d: Durum, tur: KesintiTuru, kaynakId: string, ust: Para, aciklama: string, formul: (kullanilabilir: Para) => string): Para => {
    const kullanilabilir = kalanTutar(d)
    const tutar = enKucuk(ust, kullanilabilir)
    if (!tutar.greaterThan(0)) return SIFIR
    kesintiler.push({ satirAnahtari: d.girdi.anahtar, tur, tutar, kaynakId })
    d.satirlar.push({ kural: 'K4', aciklama, formul: formul(kullanilabilir), sonuc: tutar.toFixed(2) })
    return tutar
  }

  for (const d of durumlar) {
    for (const dp of damgalar) {
      if (dp.sozlesmeId !== d.girdi.sozlesmeId || dp.kisiId !== d.girdi.kisiId) continue
      const kalan = damgaKalani.get(dp.damgaPayiId)!
      const tutar = uygula(d, 'DAMGA', dp.damgaPayiId, kalan, 'Damga kesintisi (istihkaktan)', (k) => `min(damga kalanı ${kalan.toFixed(2)}, ${k.toFixed(2)})`)
      damgaKalani.set(dp.damgaPayiId, kalan.minus(tutar))
      d.damga = d.damga.plus(tutar)
    }
    for (const h of hacizler) {
      if (h.kisiId !== d.girdi.kisiId) continue
      const kalan = hacizKalani.get(h.hacizId)!
      const tutar = uygula(d, 'HACIZ', h.hacizId, kalan, 'Haciz kesintisi', (k) => `min(haciz kalanı ${kalan.toFixed(2)}, ${k.toFixed(2)})`)
      hacizKalani.set(h.hacizId, kalan.minus(tutar))
      d.haciz = d.haciz.plus(tutar)
    }
  }

  const kisiler = [...new Set(durumlar.map((d) => d.girdi.kisiId))].sort(sayisal)
  const alicilar: Alici22a[] = kisiler.map((kisiId) => {
    const kendi = durumlar.filter((d) => d.girdi.kisiId === kisiId)
    const odenecek = topla(kendi.map(kalanTutar))
    const sorgu = g.sorgular.find((s) => s.kisiId === kisiId)
    const sorguGerekli = odenecek.greaterThan(g.esik22aOdeme)
    let kesinti = SIFIR
    if (sorguGerekli && sorgu !== undefined && sorgu.borcVar && sorgu.borcTutari.greaterThan(g.esik22aBorc)) {
      const hedef = enKucuk(sorgu.kalanBorc, odenecek)
      for (const d of kendi) {
        const tutar = uygula(d, 'KESINTI_22A', sorgu.borcSorguId, hedef.minus(kesinti), '6183 md. 22/A kesintisi',
          (k) => `min(borç kalanı ${sorgu.kalanBorc.toFixed(2)}, alıcının ödeneceği ${odenecek.toFixed(2)}) → bu satırdan en çok ${k.toFixed(2)}`)
        d.kesinti22a = d.kesinti22a.plus(tutar)
        kesinti = kesinti.plus(tutar)
      }
    }
    return { kisiId, odenecek, sorguGerekli, borcSorguId: sorgu?.borcSorguId ?? null, kesinti }
  })

  const satirlar = durumlar.map((d) => {
    const net = kalanTutar(d)
    const izler: HesapSatiri[] = [
      ...d.satirlar,
      {
        kural: 'K4', aciklama: 'Net ödenecek (kesintiler sonrası)',
        formul: `${d.girdi.odenecek.toFixed(2)} − ${d.damga.toFixed(2)} − ${d.haciz.toFixed(2)} − ${d.kesinti22a.toFixed(2)}`, sonuc: net.toFixed(2),
      },
    ]
    return { anahtar: d.girdi.anahtar, damga: d.damga, haciz: d.haciz, kesinti22a: d.kesinti22a, net, satirlar: izler }
  })
  return { kesintiler, satirlar, alicilar }
}
