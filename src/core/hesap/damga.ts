import { hisseyeDagit, type Hisse } from '../hisse'
import { D, SIFIR, enKucuk, kurusaCevir, kurustanPara, topla, yuvarla, type Para } from '../para'
import { basarili, type Sonuc } from '../sonuc'
import { odemeDonemleri } from '../takvim'
import { ayEkle, formatTarih, gunEkle, type Tarih } from '../tarih'
import type { BedelTabani, BedelTuru, KistYontemi, OdemePeriyodu } from '../tipler'
import type { HesapSatiri } from './goruntu'
import { taksitTutari } from './taksit-tutari'
import { malikTutari } from './vergi'

const BIN = new D(1000)

export interface DamgaTutariGirdisi { matrah: Para; oranBinde: Para; azami: Para }
export interface DamgaTutari { tutar: Para; azamiUygulandi: boolean; satirlar: HesapSatiri[] }

/** K5 — tutar = min(ROUND_HALF_UP(matrah × oranBinde / 1000), azami) (spec §6.7, DVK 14). */
export function damgaTutari(g: DamgaTutariGirdisi): DamgaTutari {
  const hesap = yuvarla(g.matrah.times(g.oranBinde).dividedBy(BIN))
  const azamiUygulandi = hesap.greaterThan(g.azami)
  const tutar = enKucuk(hesap, g.azami)
  const satirlar: HesapSatiri[] = [
    { kural: 'K5', aciklama: 'Damga vergisi (binde oran)', formul: `${g.matrah.toFixed(2)} × ${g.oranBinde.toString()}‰`, sonuc: hesap.toFixed(2) },
  ]
  if (azamiUygulandi) {
    satirlar.push({ kural: 'K5', aciklama: 'Azami tutar uygulandı (DVK 14)', formul: `min(${hesap.toFixed(2)}, ${g.azami.toFixed(2)})`, sonuc: tutar.toFixed(2) })
  }
  return { tutar, azamiUygulandi, satirlar }
}

export interface IlkDamgaMatrahiGirdisi {
  baslangic: Tarih
  bitis: Tarih | null
  suresizAy: number
  periyotAy: OdemePeriyodu
  kist: KistYontemi
  bedel: Para
  taban: BedelTabani
  bedelTuru: BedelTuru
  /** Yalnız NET sözleşmede brütleştirme için. */
  malikler: readonly (Hisse & { stopajOrani: Para })[]
}

/**
 * ILK olayında matrah: sözleşme süresince ilk bedelle hesaplanan toplam BRÜT kira (KDV hariç). Süresiz sözleşmede
 * [baslangic, ayEkle(baslangic, suresizAy) − 1] aralığının kirası. Dönem tutarları K1 (kıst kuralı dahil) ile bulunur; NET sözleşmede her
 * dönem tutarı hisselere bölünür ve her payın brütü K4 brütleştirmesiyle toplanır.
 */
export function ilkDamgaMatrahi(g: IlkDamgaMatrahiGirdisi): Sonuc<{ matrah: Para; donemSayisi: number; satirlar: HesapSatiri[] }> {
  const bitis = g.bitis ?? gunEkle(ayEkle(g.baslangic, g.suresizAy), -1)
  const donemler = odemeDonemleri({ baslangic: g.baslangic, bitis, periyotAy: g.periyotAy, ufuk: bitis })
  const kiraDonemleri = [{ id: 'ilk', baslangic: g.baslangic, bitis: null, bedel: g.bedel, taban: g.taban }]
  const brutler: Para[] = []
  for (const d of donemler) {
    const tt = taksitTutari({ donem: d, periyotAy: g.periyotAy, kiraAyiCapasi: g.baslangic, kiraDonemleri, kist: g.kist })
    if (!tt.ok) return tt
    if (g.bedelTuru === 'BRUT') {
      brutler.push(tt.deger.tutar)
      continue
    }
    const paylar = hisseyeDagit(kurusaCevir(tt.deger.tutar), g.malikler)
    if (!paylar.ok) return paylar
    for (const [i, p] of paylar.deger.entries()) {
      const m = g.malikler[i]!
      brutler.push(malikTutari({ tutar: kurustanPara(p.kurus), bedelTuru: 'NET', stopajOrani: m.stopajOrani, kdvOrani: SIFIR }).brut)
    }
  }
  const matrah = topla(brutler)
  const sure = g.bitis === null
    ? `süresiz: ${g.suresizAy} ay (${formatTarih(g.baslangic)} – ${formatTarih(bitis)})`
    : `${formatTarih(g.baslangic)} – ${formatTarih(bitis)}`
  return basarili({
    matrah,
    donemSayisi: donemler.length,
    satirlar: [{
      kural: 'K5',
      aciklama: g.bedelTuru === 'NET' ? 'Matrah: ilk bedelle toplam brüt kira (net bedel brütleştirildi, KDV hariç)' : 'Matrah: ilk bedelle toplam brüt kira (KDV hariç)',
      formul: `${sure}, ${donemler.length} dönem`,
      sonuc: matrah.toFixed(2),
    }],
  })
}

/** Damga tutarının malik hisselerine K3 ile bölünmesi; çıktı girdi sırasındadır. */
export function damgaPaylari(tutar: Para, malikler: readonly Hisse[]): Sonuc<{ kisiId: string; pay: number; payda: number; tutar: Para }[]> {
  const paylar = hisseyeDagit(kurusaCevir(tutar), malikler)
  if (!paylar.ok) return paylar
  return basarili(paylar.deger.map((p, i) => ({ kisiId: p.kisiId, pay: malikler[i]!.pay, payda: malikler[i]!.payda, tutar: kurustanPara(p.kurus) })))
}
