export type TasinmazTuru = 'BINA' | 'ISYERI' | 'ARSA' | 'DEPO' | 'KONUT'
export type KullanimAmaci = 'HIZMET_BINASI' | 'LOJMAN' | 'DEPO' | 'OTOPARK' | 'SOSYAL_TESIS' | 'DIGER'
export type VergiStatusu =
  | 'GMSI_GERCEK' | 'SERBEST_MESLEK' | 'TICARI_AKTIF' | 'BASIT_USUL'
  | 'SIRKET' | 'KOOPERATIF' | 'VAKIF_DERNEK' | 'KAMU'
export type BedelTabani = 'AYLIK' | 'YILLIK'
export type BedelTuru = 'BRUT' | 'NET'
export type KistYontemi = 'GERCEK_GUN' | 'OTUZ_GUN'
export type ArtisKurali = 'TUFE12' | 'YIUFE' | 'TUFE_YIUFE_ORT' | 'SABIT' | 'YOK' | 'ELLE'
export type DegisimTuru = 'ON_IKI_AY_ORT' | 'YILLIK'
export type OdemePeriyodu = 1 | 3 | 6 | 12
export type OdemeZamani = 'PESIN' | 'DONEM_SONU'
export type VadeKurali = 'DONEM_BASI_ARTI_GUN' | 'AYIN_GUNU' | 'DONEM_SONU_ARTI_GUN'

/** TBK 347 (1 yıllık uzama, 10 uzama yılı) ve 344/3 konut ve çatılı işyerlerine uygulanır; arsa hariç. */
export const TBK347_TURLERI: ReadonlySet<TasinmazTuru> = new Set<TasinmazTuru>(['BINA', 'ISYERI', 'DEPO', 'KONUT'])

export function tbk347KapsamindaMi(tur: TasinmazTuru): boolean {
  return TBK347_TURLERI.has(tur)
}
