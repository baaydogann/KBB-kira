import { HESAP_SURUMU, type HesapSatiri, type TaksitGoruntusu } from '@/core/hesap/goruntu'
import { taksitTutari } from '@/core/hesap/taksit-tutari'
import { formatTL, type Para } from '@/core/para'
import { artisTarihleri, odemeDonemleri, vadeTarihi } from '@/core/takvim'
import { ayEkle, bugunIstanbul, enBuyukTarih, formatTarih, karsilastir, type Tarih } from '@/core/tarih'
import { tbk347KapsamindaMi, type OdemePeriyodu } from '@/core/tipler'
import type { TaksitDurumu } from '@/generated/prisma'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, jsonYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { parametreTamsayi } from '../parametre/servis'
import { kiraDonemiGirdileri } from '../sozlesme/girdi'

/** `gecmisDokunulmadi`: vadesi geçtiği için değiştirilmeyen (yeniden fiyatlanmayan, kıst/normal çevrilmeyen, iptal edilmeyen) taksit sayısı. */
export interface PlanOzeti { eklenen: number; guncellenen: number; iptal: number; gecmisDokunulmadi: number }

export const BOS_PLAN_OZETI: Readonly<PlanOzeti> = { eklenen: 0, guncellenen: 0, iptal: 0, gecmisDokunulmadi: 0 }

/**
 * Vadesi geçmiş (vade < bugün) PLANLANDI taksit tahakkuk etmiş sayılır: kişi taksiti sistem dışında ödemiş olabilir (kullanıcı bunu
 * Taksitler sekmesindeki "Sistem dışında ödendi" ile kaydeder ya da taksiti bir ödeme paketine alır). Böyle bir satır ödeme sürecindeki
 * (PAKETTE/ODEME_EMRINDE/ODENDI) satır gibi ele alınır: yeniden fiyatlanmaz, NORMAL↔KIST çevrilmez, iptal edilmez; fark FARK taksiti ya da
 * fazla ödeme hatırlatması olur. Genellemesi: `tahakkukEtmisMi`.
 */
export function vadesiGecmisMi(vade: Date, bugun: Tarih): boolean {
  return karsilastir(tarihDb(vade), bugun) < 0
}

export const ODEME_SURECI = ['PAKETTE', 'ODEME_EMRINDE', 'ODENDI'] as const satisfies readonly TaksitDurumu[]
const odemeSurecindeMi = (durum: TaksitDurumu): boolean => (ODEME_SURECI as readonly TaksitDurumu[]).includes(durum)

/** FARK taksiti tahakkuk etmiştir: ödeme sürecindeyse ya da PLANLANDI ve vadesi geçmişse (F1 `farklariIsle`'deki `tahakkukEtmemis`'in tümleyeni). */
export function farkTahakkukEtmisMi(f: { durum: TaksitDurumu; vadeTarihi: Date }, bugun: Tarih): boolean {
  return odemeSurecindeMi(f.durum) || (f.durum === 'PLANLANDI' && vadesiGecmisMi(f.vadeTarihi, bugun))
}

/**
 * Tahakkuk etmiş (dondurulmuş) taksit: ödeme sürecinde, vadesi geçmiş PLANLANDI, ya da tahakkuk etmiş bir FARK'ı olan PLANLANDI.
 * Böyle satır yeniden fiyatlanmaz, NORMAL↔KIST çevrilmez, iptal edilmez; değişiklik FARK ya da fazla ödeme hatırlatması olur.
 * Son koşul paket iptalinde çift ödemeyi önler: ana taksit eski tutarıyla PLANLANDI'ya döner, ödeme sürecindeki FARK'ı farkı karşılar.
 */
export function tahakkukEtmisMi(t: { durum: TaksitDurumu; vadeTarihi: Date; tahakkukEtmisFarkVar: boolean }, bugun: Tarih): boolean {
  if (odemeSurecindeMi(t.durum)) return true
  return t.durum === 'PLANLANDI' && (vadesiGecmisMi(t.vadeTarihi, bugun) || t.tahakkukEtmisFarkVar)
}

/** Tahakkuk etmiş satırın ödeme durumu metni (hatırlatmalarda). */
function surecMetni(t: { durum: TaksitDurumu; vadeTarihi: Date }, bugun: Tarih): string {
  return odemeSurecindeMi(t.durum) ? `ödeme sürecinde (${t.durum})` : vadesiGecmisMi(t.vadeTarihi, bugun) ? 'vadesi geçmiş (sistem dışında ödenmiş olabilir)' : 'planlı'
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

interface DonmusSatir { id: number; donemBaslangic: Date; donemBitis: Date; vadeTarihi: Date; tutar: Para; durum: TaksitDurumu }

/**
 * Plan, tahakkuk etmiş bir satırın dönemini kısaltacak (fesih, yenileme kesimi) ya da satırı iptal edecek olduğunda bunu yapmaz; ödenmişse
 * fazla ödeme çıkabileceğini bildirir. Yalnızca bedel değişikliği (aynı dönem, farklı tutar) burada bildirilmez: o fark kira dönemi
 * açılırken `farklariIsle` tarafından FARK taksiti ya da fazla ödeme hatırlatması olarak işlenir (her gece yinelenmesin, çift bildirilmesin).
 *
 * `devir`: satır yenileme sözleşmesinin dönemine düşüyorsa yeni sözleşmenin numarası; hatırlatma eki DEVIR olur (her satır için tek kayıt).
 * `yalnizFarkla`: satır yalnızca tahakkuk etmiş FARK'ı yüzünden donmuştur (kendisi planlı, vadesi gelmemiş).
 */
async function gecmisDegisikligiBildir(
  tx: Tx, s: { id: number; sozlesmeNo: string }, m: DonmusSatir, hedef: { bitis: Tarih; tutar: Para } | null, bugun: Tarih,
  devir: string | null = null, yalnizFarkla = false,
): Promise<void> {
  const bas = tarihDb(m.donemBaslangic)
  const kayitli = donemMetni(bas, tarihDb(m.donemBitis))
  const vade = formatTarih(tarihDb(m.vadeTarihi))
  const odemede = odemeSurecindeMi(m.durum)
  const sonuc = odemede ? 'Paket kesinleşmemişse iptal edin; ödendiyse' : 'Ödendiyse'
  let aciklama: string
  if (hedef === null && devir !== null) {
    aciklama = `Önceki sözleşmenin ${kayitli} taksiti (vade ${vade}) ${surecMetni(m, bugun)}; yeni sözleşmenin (${devir}) aynı dönem taksitinden `
      + 'mahsup edin ya da paket kesinleşmediyse iptal edin.'
  } else if (hedef === null) {
    const neden = odemede ? `${surecMetni(m, bugun)} olduğu için` : 'vadesi geçtiği için'
    aciklama = `${kayitli} taksiti (vade ${vade}) artık sözleşme süresinde değil, ancak ${neden} iptal edilmedi. `
      + `${sonuc} ${formatTL(m.tutar)} fazla ödenmiş olabilir; kontrol edip mahsup veya iade takibi yapın.`
  } else {
    const neden = odemede ? `${surecMetni(m, bugun)} olduğu için` : yalnizFarkla ? 'fark taksiti tahakkuk ettiği için' : 'vadesi geçtiği için'
    aciklama = `${kayitli} taksiti (vade ${vade}) yeni döneme (${donemMetni(bas, hedef.bitis)}) göre ${formatTL(hedef.tutar)} olmalı; ${neden} `
      + `${formatTL(m.tutar)} olarak bırakıldı. ${sonuc} ${formatTL(m.tutar.minus(hedef.tutar))} fazla ödenmiş olabilir; kontrol edip mahsup veya iade takibi yapın.`
  }
  await fazlaOdemeHatirlat(tx, {
    taksitId: m.id, ek: hedef !== null ? hedef.bitis : devir !== null ? 'DEVIR' : 'IPTAL', sozlesmeId: s.id,
    baslik: `Fazla ödeme kontrolü — ${s.sozlesmeNo}`, aciklama,
  }, bugun, true)
}

/**
 * Ana taksiti iptal edilen (sözleşme dışında kaldı ya da yenilemeye devredildi) ve kendisi tahakkuk etmiş FARK taksiti için fazla ödeme
 * hatırlatması; anahtar FARK taksitinin kimliğiyle kurulur. FARK satırları planın kapsamında değildir; başka hiçbir yer bildirmez.
 */
export async function farkFazlaOdemeBildir(
  tx: Tx, s: { id: number; sozlesmeNo: string }, f: { id: number; durum: TaksitDurumu; vadeTarihi: Date; tutar: { toString(): string } },
  ana: { donemBaslangic: Date; donemBitis: Date }, bugun: Tarih, devir: string | null,
): Promise<void> {
  const kayitli = donemMetni(tarihDb(ana.donemBaslangic), tarihDb(ana.donemBitis))
  const tutar = formatTL(paraDb(f.tutar))
  const aciklama = devir !== null
    ? `Önceki sözleşmenin ${kayitli} taksiti yeni sözleşmeye (${devir}) devredildi; ancak ${tutar} tutarındaki fark taksiti ${surecMetni(f, bugun)}. `
      + 'Yeni sözleşmenin aynı dönem taksitinden mahsup edin ya da paket kesinleşmediyse iptal edin.'
    : `${kayitli} taksiti artık sözleşme süresinde değil ve iptal edildi; ancak ${tutar} tutarındaki fark taksiti ${surecMetni(f, bugun)}. `
      + 'Paket kesinleşmemişse iptal edin; ödendiyse fazla ödenmiştir, mahsup veya iade takibi yapın.'
  await fazlaOdemeHatirlat(tx, {
    taksitId: f.id, ek: devir !== null ? 'DEVIR' : 'IPTAL', sozlesmeId: s.id, baslik: `Fazla ödeme kontrolü — ${s.sozlesmeNo}`, aciklama,
  }, bugun, true)
}

/**
 * Sözleşmenin NORMAL/KIST taksitlerini kira dönemlerinden yeniden üretir. İdempotenttir: yalnızca vadesi gelmemiş PLANLANDI taksitler
 * güncellenir/iptal edilir; ödeme sürecine girmiş ya da vadesi geçmiş (`vadesiGecmisMi`) taksitlere dokunulmaz.
 *
 * Plan sınırı: feshedilmiş sözleşmede fesih tarihi, diğerlerinde bitiş; belirsiz sürelide bugün + `TAKVIM_UFUK_AY`. TBK 347 kapsamındaki
 * (konut, çatılı işyeri) yürürlükteki ve feshedilmemiş sözleşme bitişte kendiliğinden uzayacağından bitiş yok sayılır: plan bitişten
 * (bitiş ufuktan uzaksa bitişten) ufka kadar son kira dönemi bedeliyle sürer, son dönem bitişte kıst kesilmez. Fesih, yenileme kesimi
 * ya da sona erme bitişi bağlayıcı yapınca sonraki planlı satırlar iptal olur (vadesi geçmişler hariç).
 */
export async function taksitPlaniniGuncelle(tx: Tx, sozlesmeId: number, bugun: Tarih): Promise<PlanOzeti> {
  const ozet: PlanOzeti = { ...BOS_PLAN_OZETI }
  // Sözleşme başına kilit: aynı sözleşmenin taksitlerini okuyup yazan her kod (F2 paket/ödeme emri kodu dahil) önce bu satırı
  // kilitlemelidir; böylece eşzamanlı iki yeniden üretim taksit_donem_tekil'e çarpmaz ve okuma-yazma arası bayat kalmaz.
  await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${sozlesmeId} FOR UPDATE`
  const s = await tx.sozlesme.findUnique({
    where: { id: sozlesmeId },
    include: {
      tasinmaz: { select: { tur: true } },
      kiraDonemleri: { orderBy: { baslangic: 'asc' } },
      sonrakiSozlesme: { select: { sozlesmeNo: true, baslangic: true, durum: true } },
      taksitler: {
        where: { tur: { not: 'FARK' }, durum: { not: 'IPTAL' } },
        include: { farkTaksitleri: { where: { durum: { not: 'IPTAL' } }, select: { id: true, durum: true, vadeTarihi: true, tutar: true } } },
      },
    },
  })
  if (!s || s.durum === 'TASLAK') return ozet
  // Satır yenileme sözleşmesinin (aktifleştirilmiş) dönemine düşüyorsa hatırlatma DEVIR olarak açılır.
  const sonraki = s.sonrakiSozlesme
  const devirNo = (bas: Tarih): string | null =>
    sonraki !== null && sonraki.durum !== 'TASLAK' && karsilastir(bas, tarihDb(sonraki.baslangic)) >= 0 ? sonraki.sozlesmeNo : null
  type Satir = (typeof s.taksitler)[number]
  const tahakkukFarklari = (m: Satir) => m.farkTaksitleri.filter((f) => farkTahakkukEtmisMi(f, bugun))
  const donmusMu = (m: Satir) => tahakkukEtmisMi({ durum: m.durum, vadeTarihi: m.vadeTarihi, tahakkukEtmisFarkVar: tahakkukFarklari(m).length > 0 }, bugun)
  /** Donmamış ana satırın tahakkuk etmemiş FARK'ları koşulsuz iptal edilir: ana satırın tutarı FARK'la çift sayılmaz (korumalı yazma). */
  const tahakkuksuzFarklariIptal = async (m: Satir): Promise<void> => {
    for (const f of m.farkTaksitleri.filter((x) => !farkTahakkukEtmisMi(x, bugun))) {
      const r = await tx.taksit.updateMany({ where: { id: f.id, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
      if (r.count === 0) throw new CakismaHatasi()
    }
  }

  const periyot = s.odemePeriyoduAy as OdemePeriyodu
  const baslangic = tarihDb(s.baslangic)
  const ufuk = ayEkle(bugun, await parametreTamsayi('TAKVIM_UFUK_AY', bugun, tx))
  const sozlesmeBitisi = tarihDbOpt(s.bitis)
  const uzayacak = tbk347KapsamindaMi(s.tasinmaz.tur) && (s.durum === 'AKTIF' || s.durum === 'UZADI') && s.fesihTarihi === null
  const bitis = s.durum === 'FESHEDILDI' && s.fesihTarihi ? tarihDb(s.fesihTarihi) : uzayacak ? null : sozlesmeBitisi
  const planUfku = uzayacak && sozlesmeBitisi !== null ? enBuyukTarih(ufuk, sozlesmeBitisi) : ufuk
  const donemler = odemeDonemleri({ baslangic, bitis, periyotAy: periyot, ufuk: planUfku })
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
    const tutar = paraDb(m.tutar)
    const donemDegisti = tarihDb(m.donemBitis) !== d.bitis || m.tur !== tur
    const fiyatDegisti = donemDegisti || !tutar.equals(sonuc.deger.tutar) || tarihDb(m.vadeTarihi) !== vade
    if (donmusMu(m)) {
      // Tahakkuk etmiş satır olduğu gibi kalır (hesap görüntüsü dahil); atlanan değişiklik (yalnız PLANLANDI satırlarda) sayılır ve dönem
      // kısalıyorsa bildirilir. Ödeme sürecindeki satırın yalnız bedel farkı burada değil `farklariIsle`'de işlenir.
      if (!fiyatDegisti) continue
      if (m.durum === 'PLANLANDI') ozet.gecmisDokunulmadi += 1
      if (donemDegisti && sonuc.deger.tutar.lessThan(tutar)) {
        const yalnizFarkla = m.durum === 'PLANLANDI' && !vadesiGecmisMi(m.vadeTarihi, bugun)
        await gecmisDegisikligiBildir(tx, s, { ...m, tutar }, { bitis: d.bitis, tutar: sonuc.deger.tutar }, bugun, null, yalnizFarkla)
      }
      continue
    }
    await tahakkuksuzFarklariIptal(m)
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

  const iptalEt = async (m: Satir): Promise<void> => {
    const r = await tx.taksit.updateMany({ where: { id: m.id, durum: 'PLANLANDI' }, data: { durum: 'IPTAL', version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    ozet.iptal += 1
  }
  for (const [bas, m] of mevcut) {
    if (gorulen.has(bas)) continue
    const devir = devirNo(bas)
    if (!donmusMu(m)) {
      await tahakkuksuzFarklariIptal(m)
      await iptalEt(m)
      continue
    }
    if (m.durum === 'PLANLANDI' && !vadesiGecmisMi(m.vadeTarihi, bugun)) {
      // Yalnızca FARK'ı yüzünden donmuş satır: kendisi tahakkuk etmemiştir, sözleşme sonrası kira ödenmesin diye iptal edilir; tahakkuk
      // etmiş FARK'ları için fazla ödeme hatırlatması açılır.
      await tahakkuksuzFarklariIptal(m)
      await iptalEt(m)
      for (const f of tahakkukFarklari(m)) await farkFazlaOdemeBildir(tx, s, f, m, bugun, devir)
      continue
    }
    if (m.durum === 'PLANLANDI') ozet.gecmisDokunulmadi += 1
    await gecmisDegisikligiBildir(tx, s, { ...m, tutar: paraDb(m.tutar) }, null, bugun, devir)
  }
  return ozet
}

/**
 * Paket dışında ödenmiş taksit (C1 dondurmasından kalan, F2 öncesi ödenen satırlar): PLANLANDI → ODENDI. Taksit aktif bir pakette olamaz.
 * Not serbest metindir (kişi adı içerebilir); denetim satırına yalnızca girildiği yazılır.
 */
export async function taksitSistemDisiOdendi(
  taksitId: number, version: number, g: { odemeTarihi: Tarih; not: string }, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul(),
): Promise<void> {
  const not = g.not.trim()
  if (not.length === 0) throw new IsKuraliHatasi('NOT', 'Ödemenin dayanağını yazın (dekont, ödeme emri no vb.).', 'not')
  if (not.length > 500) throw new IsKuraliHatasi('NOT', 'Not en çok 500 karakter olabilir.', 'not')
  if (karsilastir(g.odemeTarihi, bugun) > 0) throw new IsKuraliHatasi('TARIH', 'Ödeme tarihi bugünden sonra olamaz.', 'odemeTarihi')
  await prisma.$transaction(async (tx) => {
    const sozlesmeId = await taksitSozlesmesiniKilitle(tx, taksitId)
    const t = await tx.taksit.findUniqueOrThrow({ where: { id: taksitId }, include: { paketKayitlari: { where: { aktif: true }, select: { id: true } } } })
    if (t.paketKayitlari.length > 0) throw new IsKuraliHatasi('PAKETTE', 'Taksit bir ödeme paketinde; önce paketten çıkarın.')
    if (t.durum !== 'PLANLANDI') throw new IsKuraliHatasi('DURUM', 'Yalnızca planlanmış taksit sistem dışında ödendi olarak işaretlenebilir.')
    const r = await tx.taksit.updateMany({
      where: { id: taksitId, version, durum: 'PLANLANDI' },
      data: { durum: 'ODENDI', sistemDisiOdeme: true, odemeTarihi: dbTarih(g.odemeTarihi), odemeNotu: not, version: { increment: 1 } },
    })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, { varlik: 'taksit', varlikId: taksitId, eylem: 'SISTEM_DISI_ODENDI', sonra: { sozlesmeId, odemeTarihi: g.odemeTarihi, notGirildi: true } })
  })
}

/** Sistem dışı ödeme işaretini geri alır (ODENDI → PLANLANDI) ve planı yeniden çalıştırır; paketle ödenmiş satıra uygulanmaz. */
export async function taksitSistemDisiOdemeGeriAl(taksitId: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sozlesmeId = await taksitSozlesmesiniKilitle(tx, taksitId)
    const t = await tx.taksit.findUniqueOrThrow({ where: { id: taksitId }, select: { durum: true, sistemDisiOdeme: true } })
    if (!t.sistemDisiOdeme) {
      throw new IsKuraliHatasi('DURUM', t.durum === 'ODENDI' ? 'Paketle ödenen taksit buradan geri alınamaz.' : 'Taksit sistem dışında ödendi olarak işaretli değil.')
    }
    const r = await tx.taksit.updateMany({
      where: { id: taksitId, version, durum: 'ODENDI', sistemDisiOdeme: true },
      data: { durum: 'PLANLANDI', sistemDisiOdeme: false, odemeTarihi: null, odemeNotu: null, version: { increment: 1 } },
    })
    if (r.count === 0) throw new CakismaHatasi()
    const plan = await taksitPlaniniGuncelle(tx, sozlesmeId, bugun)
    await denetimKaydi(tx, baglam, { varlik: 'taksit', varlikId: taksitId, eylem: 'SISTEM_DISI_GERI_AL', sonra: { sozlesmeId, plan } })
  })
}

/** Taksitin sözleşme satırını kilitler (F1 kuralı: taksit okuyup yazan her işlem önce sözleşme satırını kilitler). */
async function taksitSozlesmesiniKilitle(tx: Tx, taksitId: number): Promise<number> {
  const t = await tx.taksit.findUnique({ where: { id: taksitId }, select: { sozlesmeId: true } })
  if (!t) throw new BulunamadiHatasi('Taksit bulunamadı.')
  await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${t.sozlesmeId} FOR UPDATE`
  return t.sozlesmeId
}
