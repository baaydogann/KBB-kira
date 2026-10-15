export interface MalikSatiri { kisiId: number; pay: number; payda: number; ibanId: number | null; vekilKisiId: number | null }

export interface SihirbazVerisi {
  sozlesmeNo: string; tasinmazId: number; birimId: number; ekonomikKod: string | null
  imzaTarihi: string; baslangic: string; bitis: string; ilkKiraBaslangici: string
  bedelTutari: string; bedelTabani: 'AYLIK' | 'YILLIK'; bedelTuru: 'BRUT' | 'NET'
  odemePeriyoduAy: 1 | 3 | 6 | 12; odemeZamani: 'PESIN' | 'DONEM_SONU'
  vadeKurali: 'DONEM_BASI_ARTI_GUN' | 'AYIN_GUNU' | 'DONEM_SONU_ARTI_GUN'; vadeParametresi: number
  artisKurali: 'TUFE12' | 'YIUFE' | 'TUFE_YIUFE_ORT' | 'SABIT' | 'YOK' | 'ELLE'; artisDegisimTuru: 'ON_IKI_AY_ORT' | 'YILLIK'
  sabitArtisOrani: string; artisPeriyoduAy: number; kistYontemi: 'GERCEK_GUN' | 'OTUZ_GUN'
  damgaTahsil: 'ISTIHKAKTAN' | 'MALIK_BEYAN'; ihaleDayanagi: 'DT_4734_22E' | 'PZ_2886_51L' | 'DIGER'
  onayBelgesiNo: string; onayBelgesiTarihi: string; piyasaArastirmaTarihi: string; encumenKararNo: string
  gecisTarihi: string; gecisBedeli: string; odenmisSayilanSonTarih: string; notlar: string
  malikler: MalikSatiri[]
}

export const BOS_SIHIRBAZ: SihirbazVerisi = {
  sozlesmeNo: '', tasinmazId: 0, birimId: 0, ekonomikKod: null, imzaTarihi: '', baslangic: '', bitis: '', ilkKiraBaslangici: '',
  bedelTutari: '', bedelTabani: 'AYLIK', bedelTuru: 'BRUT', odemePeriyoduAy: 1, odemeZamani: 'PESIN',
  vadeKurali: 'DONEM_BASI_ARTI_GUN', vadeParametresi: 0, artisKurali: 'TUFE12', artisDegisimTuru: 'ON_IKI_AY_ORT',
  sabitArtisOrani: '', artisPeriyoduAy: 12, kistYontemi: 'GERCEK_GUN', damgaTahsil: 'ISTIHKAKTAN', ihaleDayanagi: 'DT_4734_22E',
  onayBelgesiNo: '', onayBelgesiTarihi: '', piyasaArastirmaTarihi: '', encumenKararNo: '',
  gecisTarihi: '', gecisBedeli: '', odenmisSayilanSonTarih: '', notlar: '', malikler: [],
}

export type Kisiler = { id: number; ad: string; statu: string; ibanlar: { id: number; etiket: string }[] }[]
