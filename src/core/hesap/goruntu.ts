import type { Tarih } from '../tarih'
import type { BedelTabani, BedelTuru, KistYontemi } from '../tipler'

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

/** Dağılım (malik payı ve kesintiler) hesabının sürümü; kural değişirse artırılır. */
export const DAGILIM_SURUMU = 'F2-1'

/** Her dağılım satırının anlık görüntüsü (spec §6.8): hangi taksit, parça, hisse, oran (parametre anahtarıyla) ve kesinti kullanıldı. */
export interface DagilimGoruntusu {
  surum: string
  hesapTarihi: Tarih
  taksit: { id: string; donem: { baslangic: Tarih; bitis: Tarih }; vade: Tarih; tutar: string; bedelTuru: BedelTuru }
  parca: { sira: number; baslangic: Tarih; bitis: Tarih }
  hisse: { pay: number; payda: number }
  oranlar: { stopaj: { anahtar: string | null; deger: string }; kdv: { anahtar: string | null; deger: string } }
  muhsgkKodu: string | null
  kesintiler: { tur: 'DAMGA' | 'HACIZ' | 'KESINTI_22A'; tutar: string; kaynakId: string }[]
  satirlar: HesapSatiri[]
}
