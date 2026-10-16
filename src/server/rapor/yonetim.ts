import type { BedelTabani, SozlesmeDurumu, VergiStatusu } from '@/generated/prisma'
import { taksitDagilimi, type DagilimMaligi } from '@/core/hesap/dagilim'
import { malikParcalari } from '@/core/paket/hesap'
import { SIFIR, type Para } from '@/core/para'
import { ayEkle, birlestir, gunFarki, icindeMi, karsilastir, type Tarih } from '@/core/tarih'
import { artisTarihleri } from '@/core/takvim'
import { artisIcinYururluk } from '../artis/servis'
import { prisma } from '../db'
import { dbTarih, paraDb, tarihDb, tarihDbOpt } from '../donustur'
import { KESINLESMIS_PAKET_DURUMLARI } from '../kesinti/servis'
import { vergiOranlari } from '../parametre/servis'
import type { RaporTablosu } from './vergi'

export interface OdenekSatiri { ekonomikKod: string; birim: string; yuk: Para; odenen: Para; kalan: Para; tahmini: boolean }

export interface GecikmisSatir {
  taksitId: number; sozlesmeId: number; sozlesmeNo: string; kisaAd: string; birim: string
  vade: Tarih; gecikmeGun: number; tutar: Para; durum: 'PLANLANDI' | 'PAKETTE' | 'ODEME_EMRINDE'; paketId: number | null
}

export interface DurumSatiri {
  sozlesmeId: number; sozlesmeNo: string; kisaAd: string; birim: string; durum: SozlesmeDurumu
  baslangic: Tarih; bitisEtkin: Tarih | null; kalanGun: number | null
  guncelBedel: Para; bedelTabani: BedelTabani; sonrakiArtis: Tarih | null; acikHatirlatma: number
}

const topla = (xs: readonly Para[]): Para => xs.reduce((a, b) => a.plus(b), SIFIR)

/**
 * Ödenek/taahhüt (spec §11): yıl içinde vadesi olan taksitlerin gideri (brüt + KDV). Kesinleşmiş pakette olan taksitte gider dağılımdan,
 * diğerlerinde bugünün oranlarıyla tahmindir (malik parçası bölünmeden, bakış günü max(vade, dönem başı)). Tahmin hata verirse (ör. hisse
 * toplamı) taksit tutarı kullanılır ve satır tahmini işaretlenir. Ödenen: ODENDI taksitlerin gideri.
 */
export async function odenekRaporu(yil: number, bugun: Tarih): Promise<OdenekSatiri[]> {
  const taksitler = await prisma.taksit.findMany({
    where: {
      vadeTarihi: { gte: dbTarih(birlestir(yil, 1, 1)), lte: dbTarih(birlestir(yil, 12, 31)) }, durum: { not: 'IPTAL' }, sozlesme: { durum: { not: 'TASLAK' } },
    },
    include: { sozlesme: { include: { birim: { select: { ad: true } }, malikler: { include: { kisi: { select: { vergiStatusu: true } } } } } } },
  })
  const dagilimlar = await prisma.taksitDagilim.groupBy({
    by: ['taksitId'], where: { taksitId: { in: taksitler.map((t) => t.id) }, paket: { durum: { in: [...KESINLESMIS_PAKET_DURUMLARI] } } },
    _sum: { brut: true, kdv: true },
  })
  const kesinlesmis = new Map(dagilimlar.map((d) => [d.taksitId, paraDb(d._sum.brut ?? 0).plus(paraDb(d._sum.kdv ?? 0))]))
  const oranlar = new Map<VergiStatusu, { stopaj: Para; kdv: Para }>()
  const oran = async (st: VergiStatusu) => {
    if (!oranlar.has(st)) oranlar.set(st, await vergiOranlari(st, bugun))
    return oranlar.get(st)!
  }

  const gruplar = new Map<string, OdenekSatiri>()
  for (const t of taksitler) {
    let gider = kesinlesmis.get(t.id)
    let tahmini = false
    if (gider === undefined) {
      const { parcalar } = malikParcalari({
        donemBaslangic: tarihDb(t.donemBaslangic), donemBitis: tarihDb(t.donemBitis), vade: tarihDb(t.vadeTarihi), bolunsun: false,
        malikDonemleri: t.sozlesme.malikler.map((m) => ({ ...m, sozlesmeMalikId: String(m.id), gecerlilikBaslangic: tarihDb(m.gecerlilikBaslangic), gecerlilikBitis: tarihDbOpt(m.gecerlilikBitis) })),
      })
      const malikler: DagilimMaligi[] = []
      for (const m of parcalar[0]?.malikler ?? []) {
        const o = await oran(m.kisi.vergiStatusu)
        malikler.push({ kisiId: String(m.kisiId), pay: m.pay, payda: m.payda, sozlesmeMalikId: m.sozlesmeMalikId, odemeKisiId: String(m.vekilKisiId ?? m.kisiId), ibanId: null, stopajOrani: o.stopaj, kdvOrani: o.kdv })
      }
      const tutar = paraDb(t.tutar)
      const d = taksitDagilimi({ tutar, bedelTuru: t.sozlesme.bedelTuru, parcalar: [{ baslangic: tarihDb(t.donemBaslangic), bitis: tarihDb(t.donemBitis), malikler }] })
      if (d.ok) gider = topla(d.deger.map((x) => x.brut.plus(x.kdv)))
      else {
        gider = tutar
        tahmini = true
      }
    }
    const anahtar = `${t.sozlesme.ekonomikKod}\u0000${t.sozlesme.birim.ad}`
    const g = gruplar.get(anahtar) ?? { ekonomikKod: t.sozlesme.ekonomikKod, birim: t.sozlesme.birim.ad, yuk: SIFIR, odenen: SIFIR, kalan: SIFIR, tahmini: false }
    const odenen = t.durum === 'ODENDI' ? gider : SIFIR
    gruplar.set(anahtar, { ...g, yuk: g.yuk.plus(gider), odenen: g.odenen.plus(odenen), kalan: g.kalan.plus(gider).minus(odenen), tahmini: g.tahmini || tahmini })
  }
  return [...gruplar.values()].sort((a, b) => (a.ekonomikKod < b.ekonomikKod ? -1 : a.ekonomikKod > b.ekonomikKod ? 1 : a.birim.localeCompare(b.birim, 'tr')))
}

/** Vadesi geçmiş, ödenmemiş taksitler (ödeme sürecindekiler paket kimliğiyle). */
export async function gecikmisOdemeler(bugun: Tarih): Promise<GecikmisSatir[]> {
  const taksitler = await prisma.taksit.findMany({
    where: { vadeTarihi: { lt: dbTarih(bugun) }, durum: { in: ['PLANLANDI', 'PAKETTE', 'ODEME_EMRINDE'] }, sozlesme: { durum: { not: 'TASLAK' } } },
    include: {
      sozlesme: { select: { sozlesmeNo: true, tasinmaz: { select: { kisaAd: true } }, birim: { select: { ad: true } } } },
      paketKayitlari: { where: { aktif: true }, select: { paketId: true } },
    },
  })
  return taksitler
    .map((t) => ({
      taksitId: t.id, sozlesmeId: t.sozlesmeId, sozlesmeNo: t.sozlesme.sozlesmeNo, kisaAd: t.sozlesme.tasinmaz.kisaAd, birim: t.sozlesme.birim.ad,
      vade: tarihDb(t.vadeTarihi), gecikmeGun: gunFarki(tarihDb(t.vadeTarihi), bugun), tutar: paraDb(t.tutar),
      durum: t.durum as GecikmisSatir['durum'], paketId: t.paketKayitlari[0]?.paketId ?? null,
    }))
    .sort((a, b) => karsilastir(a.vade, b.vade) || a.sozlesmeNo.localeCompare(b.sozlesmeNo, 'tr'))
}

/**
 * Sözleşme durumu: etkin bitiş (ileri tarihli fesih/sona erme dahil), güncel bedel (bugünü içeren dönem, yoksa son dönem), sonraki artış
 * (bugünden sonraki ilk artış tarihi; sona ermekte olan sözleşmede etkin bitişten sonrası yok) ve açık hatırlatma sayısı.
 */
export async function sozlesmeDurumRaporu(bugun: Tarih): Promise<DurumSatiri[]> {
  const sozlesmeler = await prisma.sozlesme.findMany({
    where: { durum: { not: 'TASLAK' } },
    include: { tasinmaz: { select: { kisaAd: true } }, birim: { select: { ad: true } }, kiraDonemleri: { orderBy: { baslangic: 'asc' } } },
    orderBy: { sozlesmeNo: 'asc' },
  })
  const sayilar = new Map((await prisma.hatirlatma.groupBy({
    by: ['sozlesmeId'], where: { sozlesmeId: { in: sozlesmeler.map((s) => s.id) }, durum: { in: ['ACIK', 'ERTELENDI'] } }, _count: { _all: true },
  })).map((x) => [x.sozlesmeId, x._count._all]))
  return sozlesmeler.map((s) => {
    const yururluk = artisIcinYururluk(s, bugun)
    const bitisEtkin = yururluk ? yururluk.bitisEtkin : (tarihDbOpt(s.fesihTarihi) ?? tarihDbOpt(s.bitis))
    const donem = s.kiraDonemleri.find((d) => icindeMi(bugun, { baslangic: tarihDb(d.baslangic), bitis: tarihDbOpt(d.bitis) })) ?? s.kiraDonemleri.at(-1)
    const sonraki = s.artisKurali === 'YOK' || yururluk === null ? null
      : artisTarihleri({ ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), periyotAy: s.artisPeriyoduAy, sonTarih: ayEkle(bugun, s.artisPeriyoduAy) })
        .find((d) => karsilastir(d, bugun) > 0 && (!yururluk.sonaErmekte || yururluk.bitisEtkin === null || karsilastir(d, yururluk.bitisEtkin) <= 0)) ?? null
    return {
      sozlesmeId: s.id, sozlesmeNo: s.sozlesmeNo, kisaAd: s.tasinmaz.kisaAd, birim: s.birim.ad, durum: s.durum,
      baslangic: tarihDb(s.baslangic), bitisEtkin, kalanGun: bitisEtkin === null ? null : gunFarki(bugun, bitisEtkin),
      guncelBedel: donem ? paraDb(donem.bedelTutari) : paraDb(s.bedelTutari), bedelTabani: donem ? donem.bedelTabani : s.bedelTabani,
      sonrakiArtis: sonraki, acikHatirlatma: sayilar.get(s.id) ?? 0,
    }
  })
}

const DURUM_ADI: Record<SozlesmeDurumu, string> = { TASLAK: 'Taslak', AKTIF: 'Aktif', UZADI: 'Uzadı', FESHEDILDI: 'Feshedildi', SONA_ERDI: 'Sona erdi' }

export async function odenekTablosu(yil: number, bugun: Tarih): Promise<RaporTablosu> {
  const r = await odenekRaporu(yil, bugun)
  return {
    baslik: `Ödenek ${yil}`,
    sutunlar: [
      { baslik: 'Ekonomik kod', tur: 'metin', genislik: 14 }, { baslik: 'Birim', tur: 'metin', genislik: 30 }, { baslik: 'Yıllık yük', tur: 'para' },
      { baslik: 'Ödenen', tur: 'para' }, { baslik: 'Kalan', tur: 'para' }, { baslik: 'Tahmini', tur: 'metin', genislik: 8 },
    ],
    satirlar: r.map((x) => [x.ekonomikKod, x.birim, x.yuk, x.odenen, x.kalan, x.tahmini ? 'Evet' : '']),
    uyarilar: r.some((x) => x.tahmini) ? ['Tahmini satırlarda bazı taksitlerin gideri hisse hatası nedeniyle taksit tutarıyla yazıldı.'] : [],
  }
}

export async function gecikmisTablosu(bugun: Tarih): Promise<RaporTablosu> {
  const r = await gecikmisOdemeler(bugun)
  return {
    baslik: 'Gecikmiş ödemeler',
    sutunlar: [
      { baslik: 'Sözleşme no', tur: 'metin', genislik: 16 }, { baslik: 'Taşınmaz', tur: 'metin', genislik: 24 }, { baslik: 'Birim', tur: 'metin', genislik: 24 },
      { baslik: 'Vade', tur: 'tarih' }, { baslik: 'Gecikme (gün)', tur: 'tamsayi' }, { baslik: 'Tutar', tur: 'para' },
      { baslik: 'Durum', tur: 'metin', genislik: 14 }, { baslik: 'Paket', tur: 'tamsayi' },
    ],
    satirlar: r.map((x) => [x.sozlesmeNo, x.kisaAd, x.birim, x.vade, x.gecikmeGun, x.tutar, x.durum, x.paketId]),
    uyarilar: [],
  }
}

export async function durumTablosu(bugun: Tarih): Promise<RaporTablosu> {
  const r = await sozlesmeDurumRaporu(bugun)
  return {
    baslik: 'Sözleşme durumu',
    sutunlar: [
      { baslik: 'Sözleşme no', tur: 'metin', genislik: 16 }, { baslik: 'Taşınmaz', tur: 'metin', genislik: 24 }, { baslik: 'Birim', tur: 'metin', genislik: 24 },
      { baslik: 'Durum', tur: 'metin', genislik: 12 }, { baslik: 'Başlangıç', tur: 'tarih' }, { baslik: 'Etkin bitiş', tur: 'tarih' },
      { baslik: 'Kalan gün', tur: 'tamsayi' }, { baslik: 'Güncel bedel', tur: 'para' }, { baslik: 'Taban', tur: 'metin', genislik: 8 },
      { baslik: 'Sonraki artış', tur: 'tarih' }, { baslik: 'Açık hatırlatma', tur: 'tamsayi' },
    ],
    satirlar: r.map((x) => [x.sozlesmeNo, x.kisaAd, x.birim, DURUM_ADI[x.durum] ?? x.durum, x.baslangic, x.bitisEtkin, x.kalanGun, x.guncelBedel, x.bedelTabani, x.sonrakiArtis, x.acikHatirlatma]),
    uyarilar: [],
  }
}
