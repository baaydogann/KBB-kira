import type { Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { belgeyiBagla } from '../belge/servis'
import { prisma } from '../db'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import type { SozlesmeGirdisi } from './sema'
import { sozlesmeTaslakKaydet } from './servis'

/** Taslak kaydedildikten SONRA, belge bağlanırken fırlayan beklenmeyen hatalar (nesne kimliğiyle işaretlenir; hata değiştirilmez). */
const kayitSonrasiHatalar = new WeakSet<object>()

/** Hata, taslak kaydı tamamlandıktan sonra belge bağlama adımından mı geldi? (Çağıran "kayıt değişmedi" dememelidir.) */
export const kayitSonrasiHataMi = (e: unknown): boolean => typeof e === 'object' && e !== null && kayitSonrasiHatalar.has(e)

/**
 * Taslağı kaydeder, ardından (belge verilmişse) yüklenmiş geçici PDF'i ona bağlar. İki adım AYRI işlemlerdir:
 * bağlama başarısızsa taslak yine de kayıtlıdır (geri alınmaz) ve hata `belgeHatasi` olarak döner; çağıran bunu
 * kullanıcıya göstermelidir.
 *
 * `version`, bu çağıranın SAHİP olduğu sürümdür: güncellemede yazdığı sürüm (`version + 1`; sürüm koşullu yazma bunu
 * garanti eder), yeni kayıtta okunan sürüm (yeni kimliği o aralıkta kimse bilemez). Kayıttan sonra okunan "güncel" sürüm
 * kullanılmaz: araya giren başka bir düzenleme sürümü ilerletmişse, çağıran onu görmeden ezmesin diye bir sonraki
 * kaydetme `CakismaHatasi` almalıdır.
 *
 * Bağlamadaki iş kuralı hataları (başkasının belgesi, belge/sahip yok, çakışma) `belgeHatasi`na çevrilir;
 * beklenmeyen hatalar (veritabanı vb.) yutulmaz, olduğu gibi yeniden fırlatılır ve `kayitSonrasiHataMi` ile tanınır.
 */
export async function taslakKaydetVeBagla(
  g: SozlesmeGirdisi, baglam: IslemBaglami, id?: number, version?: number, belgeId?: number | null, bugun?: Tarih,
): Promise<{ id: number; version: number; belgeHatasi: string | null }> {
  const kayitId = await sozlesmeTaslakKaydet(g, baglam, id, version, bugun)
  // id verilmişse servis sürümsüz çağrıyı zaten reddeder (IsKuraliHatasi VERSION): burada version tanımlıdır.
  const sahipSurum = id === undefined ? (await prisma.sozlesme.findUniqueOrThrow({ where: { id: kayitId }, select: { version: true } })).version : version! + 1
  if (belgeId === undefined || belgeId === null) return { id: kayitId, version: sahipSurum, belgeHatasi: null }
  try {
    await prisma.$transaction((tx) => belgeyiBagla(tx, belgeId, 'sozlesme', kayitId, baglam))
    return { id: kayitId, version: sahipSurum, belgeHatasi: null }
  } catch (e) {
    if (e instanceof IsKuraliHatasi || e instanceof BulunamadiHatasi || e instanceof CakismaHatasi) {
      return { id: kayitId, version: sahipSurum, belgeHatasi: e.message }
    }
    if (typeof e === 'object' && e !== null) kayitSonrasiHatalar.add(e)
    throw e
  }
}
