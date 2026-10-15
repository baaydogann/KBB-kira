import { D, SIFIR, YUZ, enKucuk, yuvarla, type Para } from '../para'
import { basarili, hatali, type Sonuc } from '../sonuc'
import { ayAdi, ayEkle, ayKaydir, karsilastir, tarihinAyi, type Ay, type Tarih } from '../tarih'
import type { ArtisKurali, DegisimTuru, TasinmazTuru } from '../tipler'
import type { HesapSatiri } from './goruntu'

export type OranSerisi = 'TUFE_12AY_ORT' | 'TUFE_YILLIK' | 'YIUFE_12AY_ORT' | 'YIUFE_YILLIK'

/** Yalnızca ONAYLANMIŞ oranları döndürür; yoksa null. */
export interface OnayliOranlar {
  oran(seri: OranSerisi, ay: Ay): Para | null
}

/** 6217 geçici 2: kamu kiracının işyeri kiralarındaki TBK 344 ertelemesi bu gün bitti. */
export const KAMU_ISYERI_ERTELEME_BITIS = '2020-07-01' as Tarih

export interface ArtisGirdi {
  donemBaslangic: Tarih
  ilkKiraBaslangici: Tarih
  oncekiBedel: Para
  kural: ArtisKurali
  degisimTuru: DegisimTuru
  sabitOran: Para | null
  elleOran: Para | null
  tasinmazTuru: TasinmazTuru
  /** Dönem başlangıcında yürürlükteki TBK344_KONUT_SINIR parametresi (yoksa null). */
  konutSiniri: Para | null
  oranlar: OnayliOranlar
}

export type ArtisSonucu =
  | { durum: 'BEKLEMEDE'; referansAy: Ay; neden: 'ENDEKS_YOK' | 'ELLE_ORAN_YOK'; eksikSeriler: OranSerisi[]; satirlar: HesapSatiri[] }
  | { durum: 'HESAPLANDI'; referansAy: Ay; tavan: Para | null; sozlesmeOrani: Para; uygulananOran: Para; yeniBedel: Para; satirlar: HesapSatiri[] }

/** K2 — TBK 344 + 2019 HMB genelgesi. */
export function artisHesapla(g: ArtisGirdi): Sonuc<ArtisSonucu> {
  if (g.oncekiBedel.isNegative()) return hatali({ kod: 'GECERSIZ_GIRDI', mesaj: 'Önceki kira bedeli negatif olamaz.' })
  const referansAy = ayKaydir(tarihinAyi(g.donemBaslangic), -1)
  const satirlar: HesapSatiri[] = [{
    kural: 'K2', aciklama: `Referans ay: ${ayAdi(referansAy)} (dönem başlangıcından bir önceki ay)`, formul: g.donemBaslangic, sonuc: ayAdi(referansAy),
  }]

  const ilkYilDolmadi = karsilastir(g.donemBaslangic, ayEkle(g.ilkKiraBaslangici, 12)) < 0
  if (g.kural === 'YOK' || ilkYilDolmadi) {
    satirlar.push({
      kural: 'K2',
      aciklama: g.kural === 'YOK' ? 'Sözleşmede artış hükmü yok' : 'İlk kira yılı dolmadan artış yapılmaz (2019 HMB genelgesi md. 2)',
      formul: 'oran = 0',
      sonuc: g.oncekiBedel.toFixed(2),
    })
    return basarili({ durum: 'HESAPLANDI', referansAy, tavan: null, sozlesmeOrani: SIFIR, uygulananOran: SIFIR, yeniBedel: g.oncekiBedel, satirlar })
  }

  const eksik: OranSerisi[] = []
  const al = (seri: OranSerisi): Para | null => {
    const v = g.oranlar.oran(seri, referansAy)
    if (v === null && !eksik.includes(seri)) eksik.push(seri)
    return v
  }

  const tavanGerekli = g.tasinmazTuru === 'KONUT' || karsilastir(g.donemBaslangic, KAMU_ISYERI_ERTELEME_BITIS) >= 0
  let tavan: Para | null = null
  if (tavanGerekli) {
    const tufe12 = al('TUFE_12AY_ORT')
    if (tufe12 !== null) {
      tavan = g.tasinmazTuru === 'KONUT' && g.konutSiniri !== null ? enKucuk(tufe12, g.konutSiniri) : tufe12
    }
  }

  let sozlesmeOrani: Para | null = null
  const yillikMi = g.degisimTuru === 'YILLIK'
  switch (g.kural) {
    case 'TUFE12':
      sozlesmeOrani = al(yillikMi ? 'TUFE_YILLIK' : 'TUFE_12AY_ORT')
      break
    case 'YIUFE':
      sozlesmeOrani = al(yillikMi ? 'YIUFE_YILLIK' : 'YIUFE_12AY_ORT')
      break
    case 'TUFE_YIUFE_ORT': {
      const tufe = al(yillikMi ? 'TUFE_YILLIK' : 'TUFE_12AY_ORT')
      const yiufe = al(yillikMi ? 'YIUFE_YILLIK' : 'YIUFE_12AY_ORT')
      if (tufe !== null && yiufe !== null) sozlesmeOrani = tufe.plus(yiufe).dividedBy(2).toDecimalPlaces(4, D.ROUND_HALF_UP)
      break
    }
    case 'SABIT':
      if (g.sabitOran === null) return hatali({ kod: 'GECERSIZ_GIRDI', mesaj: 'Sabit artış oranı tanımlı değil.' })
      sozlesmeOrani = g.sabitOran
      break
    case 'ELLE':
      if (g.elleOran === null) {
        return basarili({ durum: 'BEKLEMEDE', referansAy, neden: 'ELLE_ORAN_YOK', eksikSeriler: eksik, satirlar })
      }
      sozlesmeOrani = g.elleOran
      break
  }

  if (eksik.length > 0 || sozlesmeOrani === null) {
    return basarili({ durum: 'BEKLEMEDE', referansAy, neden: 'ENDEKS_YOK', eksikSeriler: eksik, satirlar })
  }

  satirlar.push({ kural: 'K2', aciklama: 'Sözleşme oranı', formul: g.kural, sonuc: sozlesmeOrani.toString() })
  satirlar.push({
    kural: 'K2',
    aciklama: tavan === null ? 'Tavan uygulanmaz (01.07.2020 öncesi kamu işyeri dönemi)' : 'Yasal tavan: TÜFE 12 aylık ortalama değişim (TBK 344)',
    formul: tavan === null ? '-' : 'TUFE_12AY_ORT',
    sonuc: tavan === null ? '-' : tavan.toString(),
  })
  const sinirli = tavan === null ? sozlesmeOrani : enKucuk(sozlesmeOrani, tavan)
  const uygulananOran = sinirli.isNegative() ? SIFIR : sinirli
  satirlar.push({ kural: 'K2', aciklama: 'Uygulanan oran = max(0, min(sözleşme, tavan))', formul: `${sozlesmeOrani.toString()} / ${tavan?.toString() ?? '-'}`, sonuc: uygulananOran.toString() })
  const yeniBedel = yuvarla(g.oncekiBedel.times(new D(1).plus(uygulananOran.dividedBy(YUZ))), 'ASAGI')
  satirlar.push({ kural: 'K2', aciklama: 'Yeni kira bedeli (kuruşa aşağı)', formul: `${g.oncekiBedel.toFixed(2)} × (1 + ${uygulananOran.toString()} / 100)`, sonuc: yeniBedel.toFixed(2) })
  return basarili({ durum: 'HESAPLANDI', referansAy, tavan, sozlesmeOrani, uygulananOran, yeniBedel, satirlar })
}
