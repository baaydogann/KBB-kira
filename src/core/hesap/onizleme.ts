import { kurusaCevir, kurustanPara, type Para } from '../para'
import { hisseyeDagit, type Hisse } from '../hisse'
import { basarili, type Sonuc } from '../sonuc'
import { odemeDonemleri, vadeTarihi } from '../takvim'
import type { Tarih } from '../tarih'
import type { BedelTuru, KistYontemi, OdemePeriyodu, OdemeZamani, VadeKurali, VergiStatusu } from '../tipler'
import { taksitTutari, type KiraDonemiGirdi } from './taksit-tutari'
import { malikTutari } from './vergi'

export interface OnizlemeGirdi {
  baslangic: Tarih
  bitis: Tarih | null
  periyotAy: OdemePeriyodu
  zaman: OdemeZamani
  vadeKurali: VadeKurali
  vadeParametresi: number
  kist: KistYontemi
  bedelTuru: BedelTuru
  kiraDonemleri: readonly KiraDonemiGirdi[]
  malikler: readonly (Hisse & { statu: VergiStatusu })[]
  oranlar: (statu: VergiStatusu) => { stopaj: Para; kdv: Para }
  ufuk: Tarih
  azamiSatir?: number
}

export interface OnizlemeSatiri {
  sira: number
  baslangic: Tarih
  bitis: Tarih
  vade: Tarih
  tutar: Para
  malikler: { kisiId: string; brut: Para; kdv: Para; stopaj: Para; net: Para }[]
}

/** Kaydetmeden önce ilk N taksitin malik bazında tahmini dökümü (gelecek artışlar hariç). */
export function sozlesmeOnizleme(g: OnizlemeGirdi): Sonuc<OnizlemeSatiri[]> {
  const donemler = odemeDonemleri({ baslangic: g.baslangic, bitis: g.bitis, periyotAy: g.periyotAy, ufuk: g.ufuk })
    .slice(0, g.azamiSatir ?? 24)
  const statuler = new Map(g.malikler.map((m) => [m.kisiId, m.statu]))
  const satirlar: OnizlemeSatiri[] = []
  for (const d of donemler) {
    const tutar = taksitTutari({ donem: d, periyotAy: g.periyotAy, kiraAyiCapasi: g.baslangic, kiraDonemleri: g.kiraDonemleri, kist: g.kist })
    if (!tutar.ok) return tutar
    const paylar = hisseyeDagit(kurusaCevir(tutar.deger.tutar), g.malikler)
    if (!paylar.ok) return paylar
    satirlar.push({
      sira: d.sira,
      baslangic: d.baslangic,
      bitis: d.bitis,
      vade: vadeTarihi(d, g.zaman, g.vadeKurali, g.vadeParametresi),
      tutar: tutar.deger.tutar,
      malikler: paylar.deger.map((p) => {
        const oran = g.oranlar(statuler.get(p.kisiId)!)
        const m = malikTutari({ tutar: kurustanPara(p.kurus), bedelTuru: g.bedelTuru, stopajOrani: oran.stopaj, kdvOrani: oran.kdv })
        return { kisiId: p.kisiId, brut: m.brut, kdv: m.kdv, stopaj: m.stopaj, net: m.net }
      }),
    })
  }
  return basarili(satirlar)
}
