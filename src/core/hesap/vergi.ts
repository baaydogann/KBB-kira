import { D, YUZ, yuvarla, type Para } from '../para'
import type { BedelTuru, VergiStatusu } from '../tipler'
import type { HesapSatiri } from './goruntu'

export type StopajParametresi = 'STOPAJ_94_5A' | 'STOPAJ_94_5B' | 'STOPAJ_KVK_15_1B'

export interface StatuKurali {
  etiket: string
  stopaj: StopajParametresi | null
  kdvli: boolean
  teyitGerekli: boolean
  muhsgkKodu: '041' | '042' | null
}

/** Spec §6.6. Çalışma zamanında parametre tablosundaki STATU_KURALI_* kayıtları esastır; bu tablo seed kaynağıdır. */
export const VARSAYILAN_STATU_KURALLARI: Readonly<Record<VergiStatusu, StatuKurali>> = {
  GMSI_GERCEK: { etiket: 'Gerçek kişi (GMSİ)', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: false, muhsgkKodu: '041' },
  SERBEST_MESLEK: { etiket: 'Serbest meslek erbabı', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: false, muhsgkKodu: '041' },
  TICARI_AKTIF: { etiket: 'Tüccar (işletme aktifinde)', stopaj: null, kdvli: true, teyitGerekli: true, muhsgkKodu: null },
  BASIT_USUL: { etiket: 'Basit usul', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: true, muhsgkKodu: '041' },
  SIRKET: { etiket: 'Şirket', stopaj: null, kdvli: true, teyitGerekli: false, muhsgkKodu: null },
  KOOPERATIF: { etiket: 'Kooperatif', stopaj: 'STOPAJ_KVK_15_1B', kdvli: false, teyitGerekli: true, muhsgkKodu: '042' },
  VAKIF_DERNEK: { etiket: 'Vakıf / dernek', stopaj: 'STOPAJ_94_5B', kdvli: false, teyitGerekli: false, muhsgkKodu: null },
  KAMU: { etiket: 'Kamu idaresi', stopaj: null, kdvli: false, teyitGerekli: true, muhsgkKodu: null },
}

export interface MalikTutariGirdi {
  tutar: Para
  bedelTuru: BedelTuru
  stopajOrani: Para
  kdvOrani: Para
}

export interface MalikTutari {
  brut: Para
  kdv: Para
  stopaj: Para
  net: Para
  satirlar: HesapSatiri[]
}

/** Malikin payı için KDV ve stopaj. NET sözleşmede brüt = round(net / (1 − s)), stopaj = brüt − net. */
export function malikTutari(g: MalikTutariGirdi): MalikTutari {
  const s = g.stopajOrani.dividedBy(YUZ)
  const k = g.kdvOrani.dividedBy(YUZ)
  const satirlar: HesapSatiri[] = []
  let brut: Para
  let stopaj: Para
  if (g.bedelTuru === 'NET' && !s.isZero()) {
    brut = yuvarla(g.tutar.dividedBy(new D(1).minus(s)))
    stopaj = brut.minus(g.tutar)
    satirlar.push({ kural: 'K4', aciklama: 'Brütleştirme (net sözleşme)', formul: `${g.tutar.toFixed(2)} / (1 − ${g.stopajOrani.toString()}/100)`, sonuc: brut.toFixed(2) })
    satirlar.push({ kural: 'K4', aciklama: 'Stopaj = brüt − net', formul: `${brut.toFixed(2)} − ${g.tutar.toFixed(2)}`, sonuc: stopaj.toFixed(2) })
  } else {
    brut = g.tutar
    stopaj = yuvarla(brut.times(s))
    satirlar.push({ kural: 'K4', aciklama: 'Stopaj', formul: `${brut.toFixed(2)} × ${g.stopajOrani.toString()}%`, sonuc: stopaj.toFixed(2) })
  }
  const kdv = yuvarla(brut.times(k))
  if (!k.isZero()) satirlar.push({ kural: 'K4', aciklama: 'KDV', formul: `${brut.toFixed(2)} × ${g.kdvOrani.toString()}%`, sonuc: kdv.toFixed(2) })
  const net = brut.plus(kdv).minus(stopaj)
  satirlar.push({ kural: 'K4', aciklama: 'Ödenecek (brüt + KDV − stopaj)', formul: `${brut.toFixed(2)} + ${kdv.toFixed(2)} − ${stopaj.toFixed(2)}`, sonuc: net.toFixed(2) })
  return { brut, kdv, stopaj, net, satirlar }
}
