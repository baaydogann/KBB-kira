import type { Tarih } from '@/core/tarih'
import { prisma } from '../db'
import { endeksVerisiniGetir, endeksYaz } from '../endeks/servis'
import { ortam } from '../env'
import { hatirlatmaIsi } from './hatirlatma-uret'
import type { IsSonucu } from './kayit'
import { BASKA_CALISMA_MESAJI, tekKopya } from './tek-kopya'

/** Yazma adımı birkaç yüz satırı geçmez; tek, kısa işlem. */
const YAZMA_ISLEMI = { timeout: 60_000, maxWait: 30_000 }

/**
 * Yeni/güncellenen bekleyen endeks "onay bekliyor" hatırlatmasını hemen doğurur. EVDS verisi bu noktada yazılmış (commit edilmiş)
 * olduğundan buradaki bir hata çekimi hatalı yapmaz: özete yazılır, günlük hatırlatma işi kendi hatasını kendi kaydında bildirir.
 */
async function hatirlatmalariTazele(bugun: Tarih): Promise<string> {
  try {
    const h = await hatirlatmaIsi(bugun)
    return h.atlandi ? ', hatırlatma: atlandı (başka bir çalışma sürüyor)' : `, hatırlatma ${h.ozet}`
  } catch (e) {
    console.error('[endeks-cek] hatırlatma tazeleme hatası', e)
    return `, hatırlatma: hata (${(e instanceof Error ? e.message : String(e)).slice(0, 200)})`
  }
}

/**
 * `hatalar` (EVDS'e ulaşılamadı, anahtar/biçim/parametre sorunu): çalışma HATALI kaydedilir ve pano bandı uyarır (spec §8).
 * `atlanan` (henüz yayımlanmamış ya da makul olmayan veri): çalışma BASARILI kalır, ayrıntı çalışma kaydına yazılır ve
 * `saglikDurumu` aracılığıyla bantta görünür. Anahtar hiçbir ileti, özet ya da günlüğe girmez (EVDS katmanı iletilerde maskeler).
 */
export async function endeksIsi(bugun: Tarih): Promise<IsSonucu> {
  const anahtar = ortam().EVDS_API_KEY.trim()
  if (!anahtar) return { ozet: 'EVDS_API_KEY tanımlı değil; endeksleri elle girin.', atlandi: true }
  // EVDS çağrıları (en kötü ~2 dk) hiçbir veritabanı işlemi açıkken yapılmaz; yalnızca yazma + denetim satırları tek kısa işlemdedir.
  const r = await tekKopya('endeks-cek', async () => {
    const veri = await endeksVerisiniGetir(prisma, bugun, { apiAnahtari: anahtar })
    return prisma.$transaction((tx) => endeksYaz(tx, veri), YAZMA_ISLEMI)
  })
  if (!r.calisti) return { ozet: BASKA_CALISMA_MESAJI, atlandi: true }
  const { olusturulan, guncellenen, atlanan, hatalar } = r.sonuc
  let ozet = `oluşturulan: ${olusturulan}, güncellenen: ${guncellenen}, atlanan: ${atlanan.length}, hata: ${hatalar.length}`
  if (olusturulan + guncellenen > 0) ozet += await hatirlatmalariTazele(bugun)
  const ayrinti = [...hatalar, ...atlanan].join(' | ')
  return { ozet, ...(ayrinti === '' ? {} : { ayrinti }), ...(hatalar.length > 0 ? { hatali: true } : {}) }
}
