import { HESAP_SURUMU, type HesapSatiri, type TaksitGoruntusu } from '@/core/hesap/goruntu'
import { taksitTutari } from '@/core/hesap/taksit-tutari'
import { formatTL, type Para } from '@/core/para'
import { artisTarihleri, odemeDonemleri, vadeTarihi } from '@/core/takvim'
import { ayEkle, formatTarih, karsilastir, type Tarih } from '@/core/tarih'
import type { OdemePeriyodu } from '@/core/tipler'
import type { Tx } from '../db'
import { dbTarih, jsonYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { CakismaHatasi, IsKuraliHatasi } from '../hata'
import { parametreTamsayi } from '../parametre/servis'
import { kiraDonemiGirdileri } from '../sozlesme/girdi'

/** `gecmisDokunulmadi`: vadesi geçtiği için değiştirilmeyen (yeniden fiyatlanmayan, kıst/normal çevrilmeyen, iptal edilmeyen) taksit sayısı. */
export interface PlanOzeti { eklenen: number; guncellenen: number; iptal: number; gecmisDokunulmadi: number }

export const BOS_PLAN_OZETI: Readonly<PlanOzeti> = { eklenen: 0, guncellenen: 0, iptal: 0, gecmisDokunulmadi: 0 }

/**
 * Vadesi geçmiş (vade < bugün) PLANLANDI taksit tahakkuk etmiş sayılır: F1 ödeme kaydetmez, kişi taksiti sistem dışında ödemiş
 * olabilir (F2'ye kadar kullanıcının "ödendi" işareti H1'i tamamlamaktır). Böyle bir satır ödeme sürecindeki (PAKETTE/ODEME_EMRINDE/ODENDI)
 * satır gibi ele alınır: yeniden fiyatlanmaz, NORMAL↔KIST çevrilmez, iptal edilmez; fark FARK taksiti ya da fazla ödeme hatırlatması olur.
 */
export function vadesiGecmisMi(vade: Date, bugun: Tarih): boolean {
  return karsilastir(tarihDb(vade), bugun) < 0
}

/**
 * Kalıcı, karar gerektiren KRITIK fazla ödeme hatırlatması (`H5_FAZLA_ODEME`; üretici kapatmaz, kullanıcı tamamlayana kadar açık kalır).
 * Anahtar `H5_FAZLA:taksit:<taksit>:<ek>`: `ek` olayı ayırt eder (fark işlemede kira dönemi, plan atlamasında hedef dönem bitişi ya da IPTAL).
 * `icerikGuncelle`: satır varsa yalnızca başlık ve açıklama yazılır (her gece çalışan plan hedef tarihi kaydırmasın); aksi halde tüm alanlar.
 * Durum hiçbir zaman yazılmaz: tamamlanmış kayıt yeniden açılmaz.
 */
export async function fazlaOdemeHatirlat(
  tx: Tx, g: { taksitId: number; ek: string; sozlesmeId: number; baslik: string; aciklama: string }, bugun: Tarih, icerikGuncelle = false,
): Promise<void> {
  const anahtar = `H5_FAZLA:taksit:${g.taksitId}:${g.ek}`
  const veri = {
    kural: 'H5_FAZLA_ODEME', iliskiliTur: 'taksit', iliskiliId: String(g.taksitId), sozlesmeId: g.sozlesmeId,
    baslik: g.baslik, aciklama: g.aciklama, hedefTarih: dbTarih(bugun), gorunurTarih: dbTarih(bugun), oncelik: 'KRITIK' as const, kararGerekli: true,
  }
  await tx.hatirlatma.upsert({ where: { anahtar }, create: { anahtar, ...veri }, update: icerikGuncelle ? { baslik: g.baslik, aciklama: g.aciklama } : veri })
}

const donemMetni = (bas: Tarih, bit: Tarih) => `${formatTarih(bas)} – ${formatTarih(bit)}`

/**
 * Plan, vadesi geçmiş bir satırın dönemini kısaltacak (fesih, yenileme kesimi) ya da satırı iptal edecek olduğunda bunu yapmaz; ödenmişse
 * fazla ödeme çıkabileceğini bildirir. Yalnızca bedel değişikliği (aynı dönem, farklı tutar) burada bildirilmez: o fark kira dönemi
 * açılırken `farklariIsle` tarafından FARK taksiti ya da fazla ödeme hatırlatması olarak işlenir (her gece yinelenmesin, çift bildirilmesin).
 */
async function gecmisDegisikligiBildir(
  tx: Tx, s: { id: number; sozlesmeNo: string }, m: { id: number; donemBaslangic: Date; donemBitis: Date; vadeTarihi: Date; tutar: Para },
  hedef: { bitis: Tarih; tutar: Para } | null, bugun: Tarih,
): Promise<void> {
  const bas = tarihDb(m.donemBaslangic)
  const kayitli = donemMetni(bas, tarihDb(m.donemBitis))
  const vade = formatTarih(tarihDb(m.vadeTarihi))
  const aciklama = hedef === null
    ? `${kayitli} taksiti (vade ${vade}) artık sözleşme süresinde değil, ancak vadesi geçtiği için iptal edilmedi. `
      + `Ödendiyse ${formatTL(m.tutar)} fazla ödenmiş olabilir; kontrol edip mahsup veya iade takibi yapın.`
    : `${kayitli} taksiti (vade ${vade}) yeni döneme (${donemMetni(bas, hedef.bitis)}) göre ${formatTL(hedef.tutar)} olmalı; vadesi geçtiği için `
      + `${formatTL(m.tutar)} olarak bırakıldı. Ödendiyse ${formatTL(m.tutar.minus(hedef.tutar))} fazla ödenmiş olabilir; kontrol edip mahsup veya iade takibi yapın.`
  await fazlaOdemeHatirlat(tx, {
    taksitId: m.id, ek: hedef === null ? 'IPTAL' : hedef.bitis, sozlesmeId: s.id, baslik: `Fazla ödeme kontrolü — ${s.sozlesmeNo}`, aciklama,
  }, bugun, true)
}

/**
 * Sözleşmenin NORMAL/KIST taksitlerini kira dönemlerinden yeniden üretir. İdempotenttir: yalnızca vadesi gelmemiş PLANLANDI taksitler
 * güncellenir/iptal edilir; ödeme sürecine girmiş ya da vadesi geçmiş (`vadesiGecmisMi`) taksitlere dokunulmaz.
 */
export async function taksitPlaniniGuncelle(tx: Tx, sozlesmeId: number, bugun: Tarih): Promise<PlanOzeti> {
  const ozet: PlanOzeti = { ...BOS_PLAN_OZETI }
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
    const tutar = paraDb(m.tutar)
    const donemDegisti = tarihDb(m.donemBitis) !== d.bitis || m.tur !== tur
    const fiyatDegisti = donemDegisti || !tutar.equals(sonuc.deger.tutar) || tarihDb(m.vadeTarihi) !== vade
    if (vadesiGecmisMi(m.vadeTarihi, bugun)) {
      // Tahakkuk etmiş satır olduğu gibi kalır (hesap görüntüsü dahil); yalnızca atlanan değişiklik sayılır ve gerekiyorsa bildirilir.
      if (!fiyatDegisti) continue
      ozet.gecmisDokunulmadi += 1
      if (donemDegisti && sonuc.deger.tutar.lessThan(tutar)) {
        await gecmisDegisikligiBildir(tx, s, { ...m, tutar }, { bitis: d.bitis, tutar: sonuc.deger.tutar }, bugun)
      }
      continue
    }
    const eski = m.hesapGoruntusu as unknown as Partial<TaksitGoruntusu> | null
    if (!fiyatDegisti && eski?.artisBekleniyor === artisBekleniyor) continue
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
    if (vadesiGecmisMi(m.vadeTarihi, bugun)) {
      ozet.gecmisDokunulmadi += 1
      await gecmisDegisikligiBildir(tx, s, { ...m, tutar: paraDb(m.tutar) }, null, bugun)
      continue
    }
    const r = await tx.taksit.updateMany({ where: { id: m.id, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    ozet.iptal += 1
  }
  return ozet
}
