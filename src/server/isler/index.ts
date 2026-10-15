import type { Tarih } from '@/core/tarih'
import { endeksIsi } from './endeks-cek'
import { hatirlatmaIsi } from './hatirlatma-uret'
import type { IsSonucu } from './kayit'
import { takvimIsi } from './takvim-guncelle'
import type { IsAdi } from './zamanlama'

export type { IsAdi }

export const ISLER: Record<IsAdi, (bugun: Tarih) => Promise<IsSonucu>> = {
  'takvim-guncelle': takvimIsi,
  'hatirlatma-uret': hatirlatmaIsi,
  'endeks-cek': endeksIsi,
}

/** Form/komut satırından gelen metin geçerli bir iş adı mı (prototip anahtarları `constructor`, `toString` sayılmaz). */
export function isAdiMi(ad: string): ad is IsAdi {
  return Object.hasOwn(ISLER, ad)
}

export const IS_ETIKETLERI: Record<IsAdi, string> = {
  'takvim-guncelle': 'Taksit planı, otomatik uzama, artış hesabı (her gün 05:30)',
  'hatirlatma-uret': 'Hatırlatma üretimi (her gün 06:00)',
  'endeks-cek': "EVDS endeks çekimi (ayın 3–10'u, 10:15–17:15 saatlik)",
}
