import type { IsDurumu } from '@/generated/prisma'
import { bugunIstanbul, parcala } from '@/core/tarih'
import { prisma } from '../db'

export interface IsSonucu {
  /** Sonuç sayıları (yeni/güncellenen/kapanan, uzatılan, hesaplanan...). Hatalı biten çalışmada da yazılır. */
  ozet: string
  atlandi?: boolean
  /** true ise çalışma HATALI kaydedilir; atılan hatadan farkı, o ana dek elde edilen sayıların `ozet`te kalmasıdır. */
  hatali?: boolean
  /**
   * Hata ya da uyarı ayrıntısı (`is_calisma.hata`): hesaplanamayan sözleşmeler, EVDS'ten alınamayan aylar. Tek tek yazılan kayıtlar
   * için iz bırakılmadığından çalışma kaydı tek iz olur; `saglikDurumu` bunu pano bandına taşır. Anahtar/kişisel veri içermemelidir.
   */
  ayrinti?: string
}

export interface IsCalismaSonucu { durum: IsDurumu; ozet: string | null; hata: string | null }

/** Bu süreçte şu an yürüyen çalışmaların kayıt kimlikleri: kapanışta bekleme süresi dolarsa yarıda kalanlar işaretlenir. */
const yurutulenler = new Set<number>()

/** Çalışma kaydı açar, işi çalıştırır, sonucu (durum, özet, ayrıntı) yazar. İşin attığı hata HATALI kayda dönüşür, dışarı çıkmaz. */
export async function isCalistirAyrintili(isAdi: string, fn: () => Promise<IsSonucu>): Promise<IsCalismaSonucu> {
  const kayit = await prisma.isCalisma.create({ data: { isAdi, baslangic: new Date(), durum: 'CALISIYOR' } })
  yurutulenler.add(kayit.id)
  try {
    const r = await fn()
    const durum: IsDurumu = r.atlandi ? 'ATLANDI' : r.hatali ? 'HATALI' : 'BASARILI'
    if (durum === 'HATALI') console.error(`[${isAdi}]`, r.ayrinti ?? r.ozet)
    const ozet = r.ozet.slice(0, 2000)
    const hata = r.ayrinti?.slice(0, 4000) ?? null
    await prisma.isCalisma.update({ where: { id: kayit.id }, data: { bitis: new Date(), durum, ozet, hata } })
    return { durum, ozet, hata }
  } catch (e) {
    const mesaj = (e instanceof Error ? e.message : String(e)).slice(0, 4000)
    console.error(`[${isAdi}]`, e)
    await prisma.isCalisma.update({ where: { id: kayit.id }, data: { bitis: new Date(), durum: 'HATALI', hata: mesaj } })
    return { durum: 'HATALI', ozet: null, hata: mesaj }
  } finally {
    yurutulenler.delete(kayit.id)
  }
}

export async function isCalistir(isAdi: string, fn: () => Promise<IsSonucu>): Promise<IsDurumu> {
  return (await isCalistirAyrintili(isAdi, fn)).durum
}

/** Kapanışta bekleme süresi dolduğunda bu süreçte hâlâ yürüyen çalışmaları HATALI işaretler (işlem ve kilit süreç ölünce kendiliğinden düşer). */
export async function yurutulenCalismalariTerket(): Promise<number> {
  const idler = [...yurutulenler]
  if (idler.length === 0) return 0
  const r = await prisma.isCalisma.updateMany({
    where: { id: { in: idler }, durum: 'CALISIYOR' },
    data: { bitis: new Date(), durum: 'HATALI', hata: 'Kapanış bekleme süresi doldu; çalışma yarıda bırakıldı (işlem geri alındı).' },
  })
  return r.count
}

const TAKILI_CALISMA_DAKIKA = 15

/**
 * Süreç ölünce (SIGKILL, elektrik kesintisi) CALISIYOR kalan kayıtlar: `dakika` dakikadan eski olanlar HATALI işaretlenir.
 * Veritabanı işlemi ve danışma kilidi bağlantıyla birlikte düştüğü için yeniden çalışmaya engel değildir; yalnızca ekranı düzeltir.
 */
export async function takiliCalismalariSupur(simdi: Date = new Date(), dakika: number = TAKILI_CALISMA_DAKIKA): Promise<number> {
  const sinir = new Date(simdi.getTime() - dakika * 60_000)
  const r = await prisma.isCalisma.updateMany({
    where: { durum: 'CALISIYOR', baslangic: { lt: sinir } },
    data: { bitis: simdi, durum: 'HATALI', hata: 'Süreç beklenmedik biçimde durdu (başlangıçta temizlendi).' },
  })
  return r.count
}

/** Gözetim için bir işin durumu: son başarılı çalışmanın başlangıcı ve (takılı sayılmayacak kadar yeni) çalışan kayıt var mı. */
export async function isDurumuOzeti(isAdi: string, simdi: Date = new Date()): Promise<{ sonBasari: Date | null; calisiyor: boolean }> {
  const [basari, calisan] = await Promise.all([
    prisma.isCalisma.findFirst({ where: { isAdi, durum: 'BASARILI' }, orderBy: { baslangic: 'desc' }, select: { baslangic: true } }),
    prisma.isCalisma.findFirst({
      where: { isAdi, durum: 'CALISIYOR', baslangic: { gte: new Date(simdi.getTime() - TAKILI_CALISMA_DAKIKA * 60_000) } }, select: { id: true },
    }),
  ])
  return { sonBasari: basari?.baslangic ?? null, calisiyor: calisan !== null }
}

export async function sonCalismalar(sayi = 50) {
  return prisma.isCalisma.findMany({ orderBy: { baslangic: 'desc' }, take: sayi })
}

const BANT_ENCOK_KARAKTER = 300
const kisalt = (s: string): string => (s.length > BANT_ENCOK_KARAKTER ? `${s.slice(0, BANT_ENCOK_KARAKTER - 1)}…` : s)

const GUNLUK_ISLER = [['takvim-guncelle', 'Taksit planı ve artış hesabı'], ['hatirlatma-uret', 'Hatırlatma üretimi']] as const

/** EVDS endeks çekimi ayın bu günleri arasında yapılır (worker çizelgesiyle aynı); bant yalnızca bu pencerede EVDS uyarısı verir. */
const EVDS_PENCERESI = { ilkGun: 3, sonGun: 10 }

function evdsPenceresindeMi(simdi: Date): boolean {
  const { gun } = parcala(bugunIstanbul(simdi))
  return gun >= EVDS_PENCERESI.ilkGun && gun <= EVDS_PENCERESI.sonGun
}

/**
 * Pano bandı uyarı metinleri:
 * - günlük işlerden son bitenin kaydı HATALI ise hemen; son 26 saatte başarılı çalışma yoksa; başarılıysa ama bazı sözleşmeler
 *   işlenemediyse (çalışma kaydındaki ayrıntı);
 * - EVDS: yalnızca ayın 3-10'u arasında (İstanbul) ve son çekim hatalıysa ("ulaşılamadı") ya da bazı aylar alınamadıysa (spec §8).
 *   Pencere dışında eksik değeri H4_EKSIK hatırlatması bildirir. "Son çekim", başka çalışma sürüyor diye atlanmış ya da
 *   anahtarsız (elle giriş tercihi) çalışmaları saymaz.
 */
export async function saglikDurumu(simdi: Date = new Date()): Promise<string[]> {
  const uyarilar: string[] = []
  const sinir = new Date(simdi.getTime() - 26 * 60 * 60 * 1000)
  for (const [ad, etiket] of GUNLUK_ISLER) {
    const [biten, basari] = await Promise.all([
      prisma.isCalisma.findFirst({ where: { isAdi: ad, durum: { in: ['BASARILI', 'HATALI'] } }, orderBy: { baslangic: 'desc' } }),
      prisma.isCalisma.findFirst({ where: { isAdi: ad, durum: 'BASARILI', baslangic: { gte: sinir } } }),
    ])
    if (biten?.durum === 'HATALI') uyarilar.push(`${etiket} (${ad}) son çalışmada hata verdi: ${kisalt(biten.hata ?? 'bilinmeyen hata')}`)
    if (!basari) uyarilar.push(`${etiket} son 26 saatte başarıyla çalışmadı; worker sürecini kontrol edin.`)
    else if (biten?.durum === 'BASARILI' && biten.hata) {
      uyarilar.push(`${etiket} tamamlandı ancak bazı kayıtlar işlenemedi: ${kisalt(biten.hata)} (ayrıntı: Zamanlanmış işler ekranı).`)
    }
  }
  if (evdsPenceresindeMi(simdi)) {
    const endeks = await prisma.isCalisma.findFirst({ where: { isAdi: 'endeks-cek', durum: { in: ['BASARILI', 'HATALI'] } }, orderBy: { baslangic: 'desc' } })
    if (endeks?.durum === 'HATALI') uyarilar.push(`EVDS'e ulaşılamadı (${kisalt(endeks.hata ?? 'bilinmeyen hata')}). Endeksler ekranından elle girin.`)
    else if (endeks?.hata) uyarilar.push(`EVDS'ten bazı endeksler alınamadı (${kisalt(endeks.hata)}). Yayımlanmamış olabilir; Endeksler ekranından elle girebilirsiniz.`)
  }
  return uyarilar
}
