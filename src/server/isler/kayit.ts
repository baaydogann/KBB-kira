import type { IsDurumu } from '@/generated/prisma'
import { bugunIstanbul, parcala } from '@/core/tarih'
import { prisma } from '../db'
import { isKilidiniDene, isKilidiTutuluyorMu } from './tek-kopya'
import { EVDS_PENCERESI } from './zamanlama'

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

/**
 * Süreç ölümüyle (kapanış beklemesinin dolması, çökme/SIGKILL) HATALI işaretlenen kayıtların iletileri. İşin kendi başarısızlığı
 * değildir: gözetim bu kayıtlara bakıp işi geri çekmez (bkz. `isDurumuOzeti`).
 */
export const TAKILI_CALISMA_MESAJI = 'Süreç beklenmedik biçimde durdu (sonradan temizlendi).'
export const TERK_EDILEN_CALISMA_MESAJI =
  'Kapanış bekleme süresi doldu; çalışma yarıda bırakıldı (tamamlanan işlemler kayıtlı, yarım kalan işlem geri alındı).'
const SUREC_OLUMU_MESAJLARI: readonly string[] = [TAKILI_CALISMA_MESAJI, TERK_EDILEN_CALISMA_MESAJI]

/** Kapanışta bekleme süresi dolduğunda bu süreçte hâlâ yürüyen çalışmaları HATALI işaretler (açık işlem ve kilit süreç ölünce kendiliğinden düşer). */
export async function yurutulenCalismalariTerket(): Promise<number> {
  const idler = [...yurutulenler]
  if (idler.length === 0) return 0
  const r = await prisma.isCalisma.updateMany({
    where: { id: { in: idler }, durum: 'CALISIYOR' },
    data: { bitis: new Date(), durum: 'HATALI', hata: TERK_EDILEN_CALISMA_MESAJI },
  })
  return r.count
}

/** Bu süreden eski CALISIYOR kayıt "takılı olabilir" sayılır; gerçekten takılı olup olmadığına işin danışma kilidi karar verir. */
const TAKILI_CALISMA_DAKIKA = 15
const SUPURME_ISLEMI = { timeout: 10_000, maxWait: 10_000 }

/**
 * `dakika` dakikadan eski CALISIYOR kayıtları HATALI işaretler, ama yalnızca işi gerçekten kimse çalıştırmıyorsa: kilit tutan işlem
 * (`tekKopya`) 60 dakikaya dek yaşayabilir, yaş tek başına canlılığı göstermez. İş adına göre gruplanır; her grup için kısa bir işlemde
 * işin danışma kilidi denenir:
 * - alınırsa o işi hiçbir yerde (worker ya da web) çalıştıran yok demektir; satırlar aynı işlemde işaretlenir, kilit commit'te bırakılır;
 * - alınamazsa iş bir yerde canlıdır; satırlara dokunulmaz.
 * Bu süreçte şu an yürüyen çalışmaların kimlikleri (`yurutulenler`) hiç aday olmaz (henüz kilidi almamış ya da kilitsiz çalışmalar için).
 * Süreç ölünce açık işlem ve kilit bağlantıyla birlikte düştüğü için yeniden çalışmaya engel değildir; süpürme yalnızca ekranı düzeltir.
 */
export async function takiliCalismalariSupur(simdi: Date = new Date(), dakika: number = TAKILI_CALISMA_DAKIKA): Promise<number> {
  const sinir = new Date(simdi.getTime() - dakika * 60_000)
  const adaylar = await prisma.isCalisma.findMany({
    where: { durum: 'CALISIYOR', baslangic: { lt: sinir }, id: { notIn: [...yurutulenler] } },
    select: { id: true, isAdi: true },
  })
  const gruplar = new Map<string, number[]>()
  for (const a of adaylar) gruplar.set(a.isAdi, [...(gruplar.get(a.isAdi) ?? []), a.id])
  let toplam = 0
  for (const [isAdi, idler] of gruplar) {
    toplam += await prisma.$transaction(async (tx) => {
      if (!(await isKilidiniDene(tx, isAdi))) return 0
      const r = await tx.isCalisma.updateMany({
        where: { id: { in: idler }, durum: 'CALISIYOR' },
        data: { bitis: simdi, durum: 'HATALI', hata: TAKILI_CALISMA_MESAJI },
      })
      return r.count
    }, SUPURME_ISLEMI)
  }
  return toplam
}

/**
 * Gözetim için bir işin durumu: son başarılı çalışmanın başlangıcı; son çalışması (BASARILI/HATALI) HATALI ise onun başlangıcı;
 * ve iş şu an çalışıyor mu. "Çalışıyor": CALISIYOR kaydı var VE işin danışma kilidi tutuluyor (yaştan bağımsız: uzun süren bir iş de
 * canlıdır; kilit boşsa kayıt takılıdır ve süpürülecektir, işin yeniden çalıştırılmasına engel olmaz). Kilit salt okunur sorgulanır
 * (`isKilidiTutuluyorMu`): durum denetimi kilit almaz, işlem açmaz. Süreç ölümüyle HATALI işaretlenen
 * kayıtlar (`SUREC_OLUMU_MESAJLARI`) "son çalışma" sayılmaz: yeniden başlatma işin hatası değildir, geri çekilmeye yol açmamalı.
 */
export async function isDurumuOzeti(isAdi: string): Promise<{ sonBasari: Date | null; sonHatali: Date | null; calisiyor: boolean }> {
  const [basari, sonlar, calisan] = await Promise.all([
    prisma.isCalisma.findFirst({ where: { isAdi, durum: 'BASARILI' }, orderBy: { baslangic: 'desc' }, select: { baslangic: true } }),
    prisma.isCalisma.findMany({
      where: { isAdi, durum: { in: ['BASARILI', 'HATALI'] } }, orderBy: { baslangic: 'desc' }, take: 10, select: { durum: true, baslangic: true, hata: true },
    }),
    prisma.isCalisma.findFirst({ where: { isAdi, durum: 'CALISIYOR' }, select: { id: true } }),
  ])
  const son = sonlar.find((k) => k.durum === 'BASARILI' || !SUREC_OLUMU_MESAJLARI.includes(k.hata ?? ''))
  const calisiyor = calisan !== null && (await isKilidiTutuluyorMu(prisma, isAdi))
  return { sonBasari: basari?.baslangic ?? null, sonHatali: son?.durum === 'HATALI' ? son.baslangic : null, calisiyor }
}

export async function sonCalismalar(sayi = 50) {
  return prisma.isCalisma.findMany({ orderBy: { baslangic: 'desc' }, take: sayi })
}

const GUNLUK_ISLER = [['takvim-guncelle', 'Taksit planı ve artış hesabı'], ['hatirlatma-uret', 'Hatırlatma üretimi']] as const

const ISLER_EKRANI = 'ayrıntı İşler ekranında'

function evdsPenceresindeMi(simdi: Date): boolean {
  const { gun } = parcala(bugunIstanbul(simdi))
  return gun >= EVDS_PENCERESI.ilkGun && gun <= EVDS_PENCERESI.sonGun
}

/**
 * Pano bandı uyarı metinleri. Bant hata ya da ayrıntı metni taşımaz (Prisma/PostgreSQL iletileri, sunucu yolları içerebilir); yalnızca
 * durumu söyler ve ayrıntıyı İşler ekranına bırakır:
 * - günlük işlerden son bitenin kaydı HATALI ise hemen; son 26 saatte başarılı çalışma yoksa; başarılıysa ama bazı sözleşmeler
 *   işlenemediyse (çalışma kaydındaki ayrıntı dolu);
 * - EVDS: yalnızca ayın 3-10'u arasında (İstanbul, `EVDS_PENCERESI`) ve son çekim hatalıysa ("ulaşılamadı") ya da bazı aylar alınamadıysa
 *   (spec §8). Pencere dışında eksik değeri H4_EKSIK hatırlatması bildirir. "Son çekim", başka çalışma sürüyor diye atlanmış ya da
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
    if (biten?.durum === 'HATALI') uyarilar.push(`${etiket} (${ad}) son çalışmada hata verdi; ${ISLER_EKRANI}.`)
    if (!basari) uyarilar.push(`${etiket} son 26 saatte başarıyla çalışmadı; worker sürecini kontrol edin.`)
    else if (biten?.durum === 'BASARILI' && biten.hata) uyarilar.push(`${etiket} tamamlandı ancak bazı sözleşmeler işlenemedi; ${ISLER_EKRANI}.`)
  }
  if (evdsPenceresindeMi(simdi)) {
    const endeks = await prisma.isCalisma.findFirst({ where: { isAdi: 'endeks-cek', durum: { in: ['BASARILI', 'HATALI'] } }, orderBy: { baslangic: 'desc' } })
    if (endeks?.durum === 'HATALI') uyarilar.push(`EVDS'e ulaşılamadı ya da yanıtı alınamadı; ${ISLER_EKRANI}. Endeksler ekranından elle girin.`)
    else if (endeks?.hata) uyarilar.push(`EVDS'ten bazı endeksler alınamadı (yayımlanmamış olabilir); ${ISLER_EKRANI}. Endeksler ekranından elle girebilirsiniz.`)
  }
  return uyarilar
}
