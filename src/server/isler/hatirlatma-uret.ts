import type { Tarih } from '@/core/tarih'
import { prisma } from '../db'
import { hatirlatmalariUretVeKaydet } from '../hatirlatma/servis'
import type { IsSonucu } from './kayit'
import { BASKA_CALISMA_MESAJI, tekKopya } from './tek-kopya'

/** Üretici tüm sözleşmelerin verisini okur ve hatırlatma satırlarını yazar; sözleşme satırını kilitlemez, tek işlemde ve tutarlı bir okumayla çalışır. */
const URETIM_ISLEMI = { timeout: 10 * 60_000, maxWait: 30_000 }

export async function hatirlatmaIsi(bugun: Tarih): Promise<IsSonucu> {
  const r = await tekKopya('hatirlatma-uret', () => prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, bugun), URETIM_ISLEMI))
  if (!r.calisti) return { ozet: BASKA_CALISMA_MESAJI, atlandi: true }
  return { ozet: `yeni: ${r.sonuc.yeni}, güncellenen: ${r.sonuc.guncellenen}, kapanan: ${r.sonuc.kapanan}` }
}
