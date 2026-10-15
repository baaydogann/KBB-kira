import type { Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { belgeyiBagla } from '../belge/servis'
import { prisma } from '../db'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import type { SozlesmeGirdisi } from './sema'
import { sozlesmeTaslakKaydet } from './servis'

/**
 * Taslağı kaydeder, ardından (belge verilmişse) yüklenmiş geçici PDF'i ona bağlar. İki adım AYRI işlemlerdir:
 * bağlama başarısızsa taslak yine de kayıtlıdır (geri alınmaz) ve hata `belgeHatasi` olarak döner; çağıran bunu
 * kullanıcıya göstermelidir. `version` hesaplanmaz, kaydedilmiş satırdan okunur: çağıran bir sonraki kaydetmede
 * (ör. bağlamayı yeniden denemek için) aynı taslağı bu sürümle günceller.
 *
 * Bağlamadaki iş kuralı hataları (başkasının belgesi, belge/sahip yok, çakışma) `belgeHatasi`na çevrilir;
 * beklenmeyen hatalar (veritabanı vb.) yutulmaz, yeniden fırlatılır.
 */
export async function taslakKaydetVeBagla(
  g: SozlesmeGirdisi, baglam: IslemBaglami, id?: number, version?: number, belgeId?: number | null, bugun?: Tarih,
): Promise<{ id: number; version: number; belgeHatasi: string | null }> {
  const kayitId = await sozlesmeTaslakKaydet(g, baglam, id, version, bugun)
  const { version: kayitliSurum } = await prisma.sozlesme.findUniqueOrThrow({ where: { id: kayitId }, select: { version: true } })
  if (belgeId === undefined || belgeId === null) return { id: kayitId, version: kayitliSurum, belgeHatasi: null }
  try {
    await prisma.$transaction((tx) => belgeyiBagla(tx, belgeId, 'sozlesme', kayitId, baglam))
    return { id: kayitId, version: kayitliSurum, belgeHatasi: null }
  } catch (e) {
    if (e instanceof IsKuraliHatasi || e instanceof BulunamadiHatasi || e instanceof CakismaHatasi) {
      return { id: kayitId, version: kayitliSurum, belgeHatasi: e.message }
    }
    throw e
  }
}
