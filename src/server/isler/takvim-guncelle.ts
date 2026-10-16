import type { Tarih } from '@/core/tarih'
import { SISTEM_BAGLAMI } from '../baglam'
import { artislariHesapla } from '../artis/servis'
import { prisma } from '../db'
import { dbTarih } from '../donustur'
import { CakismaHatasi, IsKuraliHatasi } from '../hata'
import { otomatikUzat } from '../sozlesme/yasam-dongusu'
import { BOS_PLAN_OZETI, taksitPlaniniGuncelle, type PlanOzeti } from '../taksit/servis'
import type { IsSonucu } from './kayit'
import { BASKA_CALISMA_MESAJI, tekKopya } from './tek-kopya'

/** Sözleşme başına işlem süresi (uzatma + plan + artış tek sözleşmenin birkaç yüz satırıdır). */
const SOZLESME_ISLEMI = { timeout: 60_000, maxWait: 30_000 }
/** Özete/ayrıntıya yazılan tek bir hata iletisinin üst sınırı (Prisma hataları uzun olabilir). */
const ILETI_ENCOK_KARAKTER = 300

interface Aday { id: number; sozlesmeNo: string; durum: string; artisKurali: string }

interface SozlesmeSonucu { uzatilan: number; plan: PlanOzeti; hesaplanan: number; bekleyen: number; hatalar: string[] }

const kuralHatasiMi = (e: unknown): e is CakismaHatasi | IsKuraliHatasi => e instanceof CakismaHatasi || e instanceof IsKuraliHatasi

const iletiOlustur = (a: Aday, e: unknown): string => {
  const ileti = e instanceof Error ? e.message : String(e)
  // İş kuralı iletileri sözleşme numarasıyla başlar; çakışma ve beklenmeyen hata iletileri başlamaz.
  const tam = ileti.startsWith(a.sozlesmeNo) ? ileti : `${a.sozlesmeNo}: ${ileti}`
  return tam.length > ILETI_ENCOK_KARAKTER ? `${tam.slice(0, ILETI_ENCOK_KARAKTER - 1)}…` : tam
}

/**
 * Bir sözleşmenin gece işi, kendi kısa işleminde ve hep aynı sırayla: satır kilidi (işlemin ilk ifadesi) → otomatik uzama → taksit planı →
 * artış hesabı. Beklenmeyen bir hata işlemin tamamını geri alır (sözleşme ya hep ya hiç); iş kuralı hataları (CakismaHatasi/IsKuraliHatasi)
 * yalnızca ilgili adımın yazılarını geri alır ve işlem tamamlanır: `otomatikUzat` UZAMA_HATA, `artislariHesapla` ARTIS_HESAP_HATA
 * hatırlatmasını kendisi yazar, plan hatası özette görünür.
 */
async function sozlesmeyiIsle(a: Aday, bugun: Tarih): Promise<SozlesmeSonucu> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${a.id} FOR UPDATE`
    const s: SozlesmeSonucu = { uzatilan: 0, plan: { ...BOS_PLAN_OZETI }, hesaplanan: 0, bekleyen: 0, hatalar: [] }
    s.uzatilan = await otomatikUzat(tx, bugun, SISTEM_BAGLAMI, a.id)

    await tx.$executeRaw`SAVEPOINT takvim_plan`
    try {
      s.plan = await taksitPlaniniGuncelle(tx, a.id, bugun)
      await tx.$executeRaw`RELEASE SAVEPOINT takvim_plan`
    } catch (e) {
      if (!kuralHatasiMi(e)) throw e
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT takvim_plan`
      await tx.$executeRaw`RELEASE SAVEPOINT takvim_plan`
      s.hatalar.push(iletiOlustur(a, e))
    }

    // Yürürlük (ileri tarihli fesih/sona erme dahil) artislariHesapla içinde, kilitten sonra denetlenir.
    if (a.artisKurali !== 'YOK') {
      try {
        const artis = await artislariHesapla(tx, bugun, a.id)
        s.hesaplanan = artis.hesaplanan
        s.bekleyen = artis.bekleyen
      } catch (e) {
        // artislariHesapla kendi savepoint'ine döndü (ve iş kuralı hatasında ARTIS_HESAP_HATA yazdı); işlem sürer.
        if (!kuralHatasiMi(e)) throw e
        s.hatalar.push(iletiOlustur(a, e))
      }
    }
    return s
  }, SOZLESME_ISLEMI)
}

/**
 * Beklenmeyen hata (iş kuralı dışı): sözleşmenin işlemi geri alınmıştır; kullanıcı müdahalesi ister ve pano bandına bağımlı kalmasın diye
 * kalıcı KRITIK hatırlatma yazılır (kendi küçük işleminde). Satır varsa (kullanıcı kapatmış ya da ertelemiş olabilir) yalnızca iletisi
 * güncellenir. Açıklamada kişisel veri, hata metni ya da yığın izi yoktur; yalnızca hata sınıfının adı.
 */
async function takvimHatasiniBildir(a: Aday, e: unknown, bugun: Tarih): Promise<void> {
  const sinif = e instanceof Error ? (e.constructor.name || e.name) : 'Bilinmiyor'
  const aciklama = `Gece işi bu sözleşmenin uzama, taksit planı ya da kira artışı adımında beklenmeyen bir hata aldı; sözleşmede değişiklik yapılmadı. `
    + `İş ertesi çalışmada yeniden dener; sürerse sistem yöneticisine bildirin (ayrıntı: Zamanlanmış işler ekranı). Hata türü: ${sinif}.`
  const anahtar = `TAKVIM_HATA:sozlesme:${a.id}`
  try {
    await prisma.hatirlatma.upsert({
      where: { anahtar },
      create: {
        anahtar, kural: 'TAKVIM_HATA', iliskiliTur: 'sozlesme', iliskiliId: String(a.id), sozlesmeId: a.id,
        baslik: `Gece işi bu sözleşmede hata verdi — ${a.sozlesmeNo}`, aciklama,
        hedefTarih: dbTarih(bugun), gorunurTarih: dbTarih(bugun), oncelik: 'KRITIK', kararGerekli: true,
      },
      update: { aciklama },
    })
  } catch (hata) {
    console.error(`[takvim-guncelle] sözleşme #${a.id} için hata hatırlatması yazılamadı:`, hata)
  }
}

/**
 * Gece işi: aday sözleşmeler kilitsiz listelenir, her biri kendi işleminde çalışır (`sozlesmeyiIsle`). Bir sözleşmenin herhangi bir hatası
 * yalnızca o sözleşmeyi etkiler: özete `<no>: <ileti>` olarak yazılır, günlüğe yalnızca sözleşme kimliğiyle düşer, ertesi çalışmada yeniden denenir.
 * Kimliğe göre azalan sıra: yenileme etkinleştirmesi önce yeni (büyük kimlik), sonra eski sözleşmeyi kilitler. Tek uzun işlem ve toplu
 * satır kilidi yoktur; `tekKopya` yalnızca ikinci bir kopyanın aynı anda çalışmasını engeller.
 */
export async function takvimIsi(bugun: Tarih): Promise<IsSonucu> {
  const r = await tekKopya('takvim-guncelle', async () => {
    const adaylar: Aday[] = await prisma.sozlesme.findMany({
      // Bitişi gelmemiş sona ermiş sözleşme (yenileme kesimi) de aday: bitişine kadarki artışı hesaplanır.
      where: { OR: [{ durum: { in: ['AKTIF', 'UZADI', 'FESHEDILDI'] } }, { durum: 'SONA_ERDI', bitis: { gte: dbTarih(bugun) } }] },
      select: { id: true, sozlesmeNo: true, durum: true, artisKurali: true },
      orderBy: { id: 'desc' },
    })
    const toplam = { uzatilan: 0, eklenen: 0, guncellenen: 0, iptal: 0, hesaplanan: 0, bekleyen: 0 }
    const hatalar: string[] = []
    let beklenmeyen = 0
    for (const a of adaylar) {
      try {
        const s = await sozlesmeyiIsle(a, bugun)
        toplam.uzatilan += s.uzatilan
        toplam.eklenen += s.plan.eklenen
        toplam.guncellenen += s.plan.guncellenen
        toplam.iptal += s.plan.iptal
        toplam.hesaplanan += s.hesaplanan
        toplam.bekleyen += s.bekleyen
        hatalar.push(...s.hatalar)
      } catch (e) {
        console.error(`[takvim-guncelle] sözleşme #${a.id} işlenemedi:`, e)
        hatalar.push(iletiOlustur(a, e))
        if (!kuralHatasiMi(e)) {
          beklenmeyen += 1
          await takvimHatasiniBildir(a, e, bugun)
        }
      }
    }
    const ozet = `uzatılan: ${toplam.uzatilan}, sözleşme: ${adaylar.length}, eklenen: ${toplam.eklenen}, güncellenen: ${toplam.guncellenen}, iptal: ${toplam.iptal}, artış hesaplanan: ${toplam.hesaplanan}, endeks bekleyen: ${toplam.bekleyen}, hata: ${hatalar.length}`
    // Denenen her sözleşme beklenmeyen hatayla düştüyse sorun tek sözleşmede değil sistemdedir (veritabanı, şema, kod hatası): çalışma HATALI biter,
    // sayılar özette kalır. İş kuralı hataları (işlemi tamamlanan sözleşmeler) bunu tetiklemez.
    const sistemik = adaylar.length > 0 && beklenmeyen === adaylar.length
    return { ozet, ...(hatalar.length > 0 ? { ayrinti: hatalar.join(' | ') } : {}), ...(sistemik ? { hatali: true } : {}) }
  })
  return r.calisti ? r.sonuc : { ozet: BASKA_CALISMA_MESAJI, atlandi: true }
}
