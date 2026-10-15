export type HataKodu =
  | 'GECERSIZ_GIRDI'
  | 'HISSE_TOPLAMI_HATALI'
  | 'ENDEKS_YOK'
  | 'DONEM_DISI'
  | 'TARIH_GECERSIZ'
  | 'TUTAR_GECERSIZ'

export interface HesapHatasi {
  kod: HataKodu
  mesaj: string
  ayrinti?: Record<string, unknown>
}

export type Sonuc<T, H = HesapHatasi> = { ok: true; deger: T } | { ok: false; hata: H }

export function basarili<T>(deger: T): { ok: true; deger: T } {
  return { ok: true, deger }
}

export function hatali<H = HesapHatasi>(hata: H): { ok: false; hata: H } {
  return { ok: false, hata }
}
