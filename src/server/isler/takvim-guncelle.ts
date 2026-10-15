import type { Tarih } from '@/core/tarih'
import { artislariHesapla } from '../artis/servis'
import type { Tx } from '../db'
import { CakismaHatasi, IsKuraliHatasi } from '../hata'
import { otomatikUzat } from '../sozlesme/yasam-dongusu'
import { taksitPlaniniGuncelle, type PlanOzeti } from '../taksit/servis'
import type { IsSonucu } from './kayit'
import { tekKopya } from './tek-kopya'

/**
 * Tüm planlar tek transaction'da yenilenir, bu yüzden sözleşme başına SAVEPOINT vardır (`otomatikUzat` ve `artislariHesapla` ile aynı
 * kalıp): bir sözleşmedeki CakismaHatasi ya da IsKuraliHatasi yalnızca o sözleşmenin yazılarını geri alır, hata listeye girer ve sonraki
 * sözleşmeyle devam edilir. Atlanan sözleşme ertesi çalışmada yine aday olur. `taksitPlaniniGuncelle` sözleşme satırını ilk ifade olarak
 * kilitler. Sıra kimliğe göre azalan: yenileme etkinleştirmesi önce yeni (büyük kimlik), sonra eski sözleşmeyi kilitler;
 * `artislariHesapla` da aynı sırayı izler.
 */
async function planlariGuncelle(tx: Tx, bugun: Tarih): Promise<{ sozlesme: number; toplam: PlanOzeti; hatalar: string[] }> {
  const sozlesmeler = await tx.sozlesme.findMany({
    where: { durum: { in: ['AKTIF', 'UZADI', 'FESHEDILDI'] } },
    select: { id: true, sozlesmeNo: true },
    orderBy: { id: 'desc' },
  })
  const toplam: PlanOzeti = { eklenen: 0, guncellenen: 0, iptal: 0 }
  const hatalar: string[] = []
  for (const s of sozlesmeler) {
    await tx.$executeRaw`SAVEPOINT plan_guncelle`
    try {
      const o = await taksitPlaniniGuncelle(tx, s.id, bugun)
      await tx.$executeRaw`RELEASE SAVEPOINT plan_guncelle`
      toplam.eklenen += o.eklenen
      toplam.guncellenen += o.guncellenen
      toplam.iptal += o.iptal
    } catch (e) {
      if (!(e instanceof CakismaHatasi || e instanceof IsKuraliHatasi)) throw e
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT plan_guncelle`
      await tx.$executeRaw`RELEASE SAVEPOINT plan_guncelle`
      // İş kuralı iletileri sözleşme numarasıyla başlar; çakışma iletisi başlamaz.
      hatalar.push(e.message.startsWith(s.sozlesmeNo) ? e.message : `${s.sozlesmeNo}: ${e.message}`)
    }
  }
  return { sozlesme: sozlesmeler.length, toplam, hatalar }
}

export async function takvimIsi(bugun: Tarih): Promise<IsSonucu> {
  const r = await tekKopya('takvim-guncelle', async (tx) => {
    const uzatilan = await otomatikUzat(tx, bugun)
    const plan = await planlariGuncelle(tx, bugun)
    const artis = await artislariHesapla(tx, bugun)
    const hatalar = [...plan.hatalar, ...(artis.hatalar ?? [])]
    const ozet = `uzatılan: ${uzatilan}, sözleşme: ${plan.sozlesme}, eklenen: ${plan.toplam.eklenen}, güncellenen: ${plan.toplam.guncellenen}, iptal: ${plan.toplam.iptal}, artış hesaplanan: ${artis.hesaplanan}, endeks bekleyen: ${artis.bekleyen}, hata: ${hatalar.length}`
    return hatalar.length > 0 ? { ozet, ayrinti: hatalar.join(' | ') } : { ozet }
  })
  return r.calisti ? r.sonuc : { ozet: 'Başka bir kopya çalışıyor.', atlandi: true }
}
