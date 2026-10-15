import type { BedelTabani, KistYontemi } from '../tipler'

/** Hesap kurallarının sürümü; kural değişirse artırılır, anlık görüntüye yazılır. */
export const HESAP_SURUMU = 'F1-1'

export interface HesapSatiri {
  kural: string
  aciklama: string
  formul: string
  sonuc: string
}

export interface TaksitGoruntusu {
  surum: string
  hesapZamani: string
  donem: { baslangic: string; bitis: string }
  kiraDonemleri: { id: string; baslangic: string; bitis: string | null; bedel: string; taban: BedelTabani }[]
  kist: KistYontemi
  artisBekleniyor: boolean
  satirlar: HesapSatiri[]
}
