import type { Tarih } from '@/core/tarih'
import { hatirlatmalariUretVeKaydet } from '../hatirlatma/servis'
import type { IsSonucu } from './kayit'
import { tekKopya } from './tek-kopya'

export async function hatirlatmaIsi(bugun: Tarih): Promise<IsSonucu> {
  const r = await tekKopya('hatirlatma-uret', (tx) => hatirlatmalariUretVeKaydet(tx, bugun))
  if (!r.calisti) return { ozet: 'Başka bir kopya çalışıyor.', atlandi: true }
  return { ozet: `yeni: ${r.sonuc.yeni}, güncellenen: ${r.sonuc.guncellenen}, kapanan: ${r.sonuc.kapanan}` }
}
