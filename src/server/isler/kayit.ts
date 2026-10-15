import type { IsDurumu } from '@/generated/prisma'
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

export async function isCalistir(isAdi: string, fn: () => Promise<IsSonucu>): Promise<IsDurumu> {
  const kayit = await prisma.isCalisma.create({ data: { isAdi, baslangic: new Date(), durum: 'CALISIYOR' } })
  try {
    const r = await fn()
    const durum: IsDurumu = r.atlandi ? 'ATLANDI' : r.hatali ? 'HATALI' : 'BASARILI'
    if (durum === 'HATALI') console.error(`[${isAdi}]`, r.ayrinti ?? r.ozet)
    await prisma.isCalisma.update({
      where: { id: kayit.id },
      data: { bitis: new Date(), durum, ozet: r.ozet.slice(0, 2000), hata: r.ayrinti?.slice(0, 4000) ?? null },
    })
    return durum
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e)
    console.error(`[${isAdi}]`, e)
    await prisma.isCalisma.update({ where: { id: kayit.id }, data: { bitis: new Date(), durum: 'HATALI', hata: mesaj.slice(0, 4000) } })
    return 'HATALI'
  }
}

export async function sonCalismalar(sayi = 50) {
  return prisma.isCalisma.findMany({ orderBy: { baslangic: 'desc' }, take: sayi })
}

const BANT_ENCOK_KARAKTER = 300
const kisalt = (s: string): string => (s.length > BANT_ENCOK_KARAKTER ? `${s.slice(0, BANT_ENCOK_KARAKTER - 1)}…` : s)

const GUNLUK_ISLER = [['takvim-guncelle', 'Taksit planı ve artış hesabı'], ['hatirlatma-uret', 'Hatırlatma üretimi']] as const

/**
 * Pano bandı uyarı metinleri:
 * - günlük işler son 26 saatte başarılı değilse; başarılıysa ama bazı sözleşmeler işlenemediyse (çalışma kaydındaki ayrıntı);
 * - son EVDS çekimi hatalıysa ("ulaşılamadı") ya da bazı aylar alınamadıysa (yayımlanmamış/kullanılamayan veri, spec §8).
 * EVDS için "son çekim", başka kopya çalışıyor diye atlanmış ya da anahtarsız (elle giriş tercihi) çalışmaları saymaz.
 */
export async function saglikDurumu(simdi: Date = new Date()): Promise<string[]> {
  const uyarilar: string[] = []
  const sinir = new Date(simdi.getTime() - 26 * 60 * 60 * 1000)
  for (const [ad, etiket] of GUNLUK_ISLER) {
    const son = await prisma.isCalisma.findFirst({ where: { isAdi: ad, durum: 'BASARILI', baslangic: { gte: sinir } }, orderBy: { baslangic: 'desc' } })
    if (!son) uyarilar.push(`${etiket} son 26 saatte başarıyla çalışmadı; worker sürecini kontrol edin.`)
    else if (son.hata) uyarilar.push(`${etiket} tamamlandı ancak bazı kayıtlar işlenemedi: ${kisalt(son.hata)} (ayrıntı: Zamanlanmış işler ekranı).`)
  }
  const endeks = await prisma.isCalisma.findFirst({ where: { isAdi: 'endeks-cek', durum: { in: ['BASARILI', 'HATALI'] } }, orderBy: { baslangic: 'desc' } })
  if (endeks?.durum === 'HATALI') uyarilar.push(`EVDS'e ulaşılamadı (${kisalt(endeks.hata ?? 'bilinmeyen hata')}). Endeksler ekranından elle girin.`)
  else if (endeks?.hata) uyarilar.push(`EVDS'ten bazı endeksler alınamadı (${kisalt(endeks.hata)}). Yayımlanmamış olabilir; Endeksler ekranından elle girebilirsiniz.`)
  return uyarilar
}
