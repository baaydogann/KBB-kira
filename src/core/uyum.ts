import type { ArtisKurali, KullanimAmaci, OdemeZamani } from './tipler'

export interface UyumUyarisi {
  kod: 'GENELGE_ODEME_PERIYODU' | 'GENELGE_DONEM_SONU' | 'ARTIS_PERIYODU_KISA' | 'TASARRUF_GENELGESI'
  mesaj: string
}

/** Spec §6.9 — bloke etmeyen uyum uyarıları. */
export function uyumUyarilari(s: {
  odemePeriyoduAy: number
  odemeZamani: OdemeZamani
  artisPeriyoduAy: number
  artisKurali: ArtisKurali
  kullanimAmaci: KullanimAmaci
  taslak: boolean
  tasarrufGenelgesiYururlukte: boolean
}): UyumUyarisi[] {
  const u: UyumUyarisi[] = []
  if (s.odemePeriyoduAy > 3) {
    u.push({ kod: 'GENELGE_ODEME_PERIYODU', mesaj: '2019 HMB kamu taşınmaz kiralama genelgesi md. 3: kira en fazla 3 aylık taksitlerle ödenir.' })
  }
  if (s.odemeZamani === 'DONEM_SONU') {
    u.push({ kod: 'GENELGE_DONEM_SONU', mesaj: '2019 HMB genelgesi md. 3: taksitler dönem başında ödenir.' })
  }
  if (s.artisKurali !== 'YOK' && s.artisPeriyoduAy < 12) {
    u.push({ kod: 'ARTIS_PERIYODU_KISA', mesaj: 'TBK 344 ve 2019 genelgesi md. 2: artış kira yılı esasına göre yapılır; 12 aydan kısa artış periyodu tavanı aşabilir.' })
  }
  if (s.taslak && s.tasarrufGenelgesiYururlukte && (s.kullanimAmaci === 'HIZMET_BINASI' || s.kullanimAmaci === 'LOJMAN')) {
    u.push({ kod: 'TASARRUF_GENELGESI', mesaj: 'Tasarruf Genelgesi 2024/7: yeni hizmet binası/lojman kiralaması için izin alınmış olmalı.' })
  }
  return u
}
