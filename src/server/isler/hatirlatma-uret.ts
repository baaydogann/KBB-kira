import { bugunIstanbul, type Tarih } from '@/core/tarih'
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

export type TazelemeSonucu = { ozet: string } | { atlandi: true } | { hata: string }

/**
 * Hatırlatmaları hemen yeniden üretir (en iyi çaba): endeks çekimi ve kullanıcı eylemleri kendi işlemlerinde kalıcı olduktan sonra,
 * ayrı bir işlemde çağırır. Gece işiyle aynı tek kopya kilidini kullanır: o an başka bir üretim sürüyorsa atlanır (o üretim ya da
 * sonraki çalışma yakalar; satır yazımı zaten eşzamanlılığa dayanıklıdır). Hata atmaz: günlüğe `kaynak` önekiyle yazar ve iletiyi döndürür.
 */
export async function hatirlatmalariTazele(bugun: Tarih, kaynak: string): Promise<TazelemeSonucu> {
  try {
    const h = await hatirlatmaIsi(bugun)
    return h.atlandi ? { atlandi: true } : { ozet: h.ozet }
  } catch (e) {
    console.error(`[${kaynak}] hatırlatma tazeleme hatası`, e)
    return { hata: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

/** Eylem sonrası tazeleme başarısız olunca kullanıcıya gösterilen (engellemeyen) uyarı. */
export const TAZELEME_UYARISI = 'İşlem kaydedildi ancak hatırlatmalar hemen yenilenemedi; günlük iş yeniden üretecek (pano bir süre eski görünebilir).'

/** Kullanıcı eyleminden sonra: başarı ve atlama sessizdir; hata eylemi geri almaz, `TAZELEME_UYARISI` döner. */
export async function eylemSonrasiHatirlatmalariTazele(): Promise<string | undefined> {
  const r = await hatirlatmalariTazele(bugunIstanbul(), 'eylem')
  return 'hata' in r ? TAZELEME_UYARISI : undefined
}
