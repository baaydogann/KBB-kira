import { HESAP_SURUMU, type HesapSatiri, type TaksitGoruntusu } from '@/core/hesap/goruntu'
import { taksitTutari } from '@/core/hesap/taksit-tutari'
import { artisTarihleri, odemeDonemleri, vadeTarihi } from '@/core/takvim'
import { ayEkle, karsilastir, type Tarih } from '@/core/tarih'
import type { OdemePeriyodu } from '@/core/tipler'
import type { Tx } from '../db'
import { dbTarih, jsonYaz, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { CakismaHatasi, IsKuraliHatasi } from '../hata'
import { parametreTamsayi } from '../parametre/servis'
import { kiraDonemiGirdileri } from '../sozlesme/girdi'

export interface PlanOzeti { eklenen: number; guncellenen: number; iptal: number }

/**
 * Sözleşmenin NORMAL/KIST taksitlerini kira dönemlerinden yeniden üretir. İdempotenttir:
 * yalnızca PLANLANDI taksitler güncellenir/iptal edilir; ödeme sürecine girmiş taksitlere dokunulmaz.
 */
export async function taksitPlaniniGuncelle(tx: Tx, sozlesmeId: number, bugun: Tarih): Promise<PlanOzeti> {
  const ozet: PlanOzeti = { eklenen: 0, guncellenen: 0, iptal: 0 }
  // Sözleşme başına kilit: aynı sözleşmenin taksitlerini okuyup yazan her kod (F2 paket/ödeme emri kodu dahil) önce bu satırı
  // kilitlemelidir; böylece eşzamanlı iki yeniden üretim taksit_donem_tekil'e çarpmaz ve okuma-yazma arası bayat kalmaz.
  await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${sozlesmeId} FOR UPDATE`
  const s = await tx.sozlesme.findUnique({
    where: { id: sozlesmeId },
    include: {
      kiraDonemleri: { orderBy: { baslangic: 'asc' } },
      taksitler: { where: { tur: { not: 'FARK' }, durum: { not: 'IPTAL' } } },
    },
  })
  if (!s || s.durum === 'TASLAK') return ozet

  const periyot = s.odemePeriyoduAy as OdemePeriyodu
  const baslangic = tarihDb(s.baslangic)
  const ufuk = ayEkle(bugun, await parametreTamsayi('TAKVIM_UFUK_AY', bugun, tx))
  const bitis = s.durum === 'FESHEDILDI' && s.fesihTarihi ? tarihDb(s.fesihTarihi) : tarihDbOpt(s.bitis)
  const donemler = odemeDonemleri({ baslangic, bitis, periyotAy: periyot, ufuk })
  const kiraDonemleri = kiraDonemiGirdileri(s.kiraDonemleri)
  const sonKiraDonemi = kiraDonemleri.at(-1)?.baslangic ?? baslangic
  const sonrakiArtis = s.artisKurali === 'YOK'
    ? null
    : artisTarihleri({ ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), periyotAy: s.artisPeriyoduAy, sonTarih: ayEkle(ufuk, 12) })
      .find((d) => karsilastir(d, sonKiraDonemi) > 0) ?? null
  const odenmisSinir = tarihDbOpt(s.odenmisSayilanSonTarih)
  const mevcut = new Map(s.taksitler.map((x) => [tarihDb(x.donemBaslangic), x]))
  const gorulen = new Set<string>()
  const hesapZamani = new Date().toISOString()

  for (const d of donemler) {
    gorulen.add(d.baslangic)
    const sonuc = taksitTutari({ donem: d, periyotAy: periyot, kiraAyiCapasi: baslangic, kiraDonemleri, kist: s.kistYontemi })
    if (!sonuc.ok) throw new IsKuraliHatasi(sonuc.hata.kod, `${s.sozlesmeNo}: ${sonuc.hata.mesaj}`)
    const vade = vadeTarihi(d, s.odemeZamani, s.vadeKurali, s.vadeParametresi)
    const artisBekleniyor = sonrakiArtis !== null && karsilastir(sonrakiArtis, d.bitis) <= 0
    const tur = d.tam ? 'NORMAL' : 'KIST'
    const odenmis = odenmisSinir !== null && karsilastir(d.bitis, odenmisSinir) <= 0
    const satirlar: HesapSatiri[] = odenmis
      ? [...sonuc.deger.satirlar, { kural: 'GECIS', aciklama: 'Sisteme geçişte ödenmiş sayıldı', formul: `dönem bitişi ≤ ${odenmisSinir}`, sonuc: 'ODENDI' }]
      : sonuc.deger.satirlar
    const goruntu: TaksitGoruntusu = {
      surum: HESAP_SURUMU, hesapZamani, donem: { baslangic: d.baslangic, bitis: d.bitis },
      kiraDonemleri: kiraDonemleri.map((k) => ({ id: k.id, baslangic: k.baslangic, bitis: k.bitis, bedel: k.bedel.toFixed(2), taban: k.taban })),
      kist: s.kistYontemi, artisBekleniyor, satirlar,
    }
    const m = mevcut.get(d.baslangic)
    if (!m) {
      await tx.taksit.create({
        data: {
          sozlesmeId, tur, donemBaslangic: dbTarih(d.baslangic), donemBitis: dbTarih(d.bitis), vadeTarihi: dbTarih(vade),
          tutar: paraYaz(sonuc.deger.tutar), hesapGoruntusu: jsonYaz(goruntu),
          // Göçte ödenmiş sayılan satırın gerçek ödeme tarihi bilinmez; vade tarihini ödeme tarihi gibi göstermeyiz.
          durum: odenmis ? 'ODENDI' : 'PLANLANDI', odemeTarihi: null,
        },
      })
      ozet.eklenen += 1
      continue
    }
    if (m.durum !== 'PLANLANDI') continue
    const eski = m.hesapGoruntusu as unknown as Partial<TaksitGoruntusu> | null
    const degisti = m.tutar.toFixed(2) !== sonuc.deger.tutar.toFixed(2) || tarihDb(m.vadeTarihi) !== vade
      || tarihDb(m.donemBitis) !== d.bitis || m.tur !== tur || eski?.artisBekleniyor !== artisBekleniyor
    if (!degisti) continue
    // Okuma ile yazma arasında PAKETTE/ODENDI olan satır yeniden fiyatlanmaz.
    const r = await tx.taksit.updateMany({
      where: { id: m.id, durum: 'PLANLANDI' },
      data: {
        tur, donemBitis: dbTarih(d.bitis), vadeTarihi: dbTarih(vade), tutar: paraYaz(sonuc.deger.tutar),
        hesapGoruntusu: jsonYaz(goruntu), version: { increment: 1 },
      },
    })
    if (r.count === 0) throw new CakismaHatasi()
    ozet.guncellenen += 1
  }

  for (const [bas, m] of mevcut) {
    if (gorulen.has(bas) || m.durum !== 'PLANLANDI') continue
    const r = await tx.taksit.updateMany({ where: { id: m.id, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    ozet.iptal += 1
  }
  return ozet
}
