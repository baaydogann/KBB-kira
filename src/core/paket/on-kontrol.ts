/** Kesinleştirmeyi engelleyen ön kontrol bulguları (spec §10.1-2). */
export type HataKoduPaket = 'BOS_PAKET' | 'TAKSIT_DURUMU' | 'MALIK_YOK' | 'HISSE_TOPLAMI' | 'HESAP_HATASI'
  | 'IBAN_YOK' | 'ARTIS_BEKLIYOR' | 'FATURA_YOK' | 'SORGU_22A_YOK'

/** Engellemeyen uyarılar. */
export type UyariKoduPaket = 'MALIK_DEGISIKLIGI' | 'STATU_TEYIT' | 'MUHSGK_KODU_YOK' | 'ODENEK_YETERSIZ' | 'UYUM' | 'IDARE_VKN_YOK'
  | 'DAMGA_KESINTISI'

export interface Bulgu {
  kod: HataKoduPaket | UyariKoduPaket
  mesaj: string
  taksitId?: string
  kisiId?: string
  sozlesmeId?: string
}

export interface OnKontrolSonucu { hatalar: Bulgu[]; uyarilar: Bulgu[] }
