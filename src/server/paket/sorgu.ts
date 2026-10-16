import type { PaketDurumu } from '@/generated/prisma'
import { ibanNormalize, maskele } from '@/core/dogrulama'
import type { HesapSatiri } from '@/core/hesap/goruntu'
import { malikParcalari } from '@/core/paket/hesap'
import type { PaketOnKontrolKaydi } from './hesapla'
import { bugunIstanbul, karsilastir, type Tarih } from '@/core/tarih'
import { prisma } from '../db'
import { paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { statuKurallari } from '../parametre/servis'

export interface PaketListeSatiri {
  id: number
  ad: string
  birim: string
  vadeBaslangic: Tarih
  vadeBitis: Tarih
  durum: PaketDurumu
  taksitSayisi: number
  net: string | null
}

const toplamNet = (onKontrol: unknown): string | null => {
  const net = (onKontrol as { toplam?: { net?: unknown } } | null)?.toplam?.net
  return typeof net === 'string' ? net : null
}

export async function paketListesi(f: { durum?: PaketDurumu } = {}): Promise<PaketListeSatiri[]> {
  const paketler = await prisma.odemePaketi.findMany({
    where: f.durum === undefined ? {} : { durum: f.durum },
    include: { birim: { select: { ad: true } }, _count: { select: { taksitler: { where: { aktif: true } } } } },
    orderBy: [{ id: 'desc' }],
    take: 500,
  })
  return paketler.map((p) => ({
    id: p.id, ad: p.ad, birim: p.birim.ad, vadeBaslangic: tarihDb(p.vadeBaslangic), vadeBitis: tarihDb(p.vadeBitis), durum: p.durum,
    taksitSayisi: p._count.taksitler, net: toplamNet(p.onKontrol),
  }))
}

async function paketYukle(id: number) {
  const p = await prisma.odemePaketi.findUnique({
    where: { id },
    include: {
      birim: { select: { id: true, ad: true } },
      faturalar: true,
      dagilimlar: {
        orderBy: { sira: 'asc' },
        include: {
          kisi: true, odemeKisi: true, iban: { select: { iban: true } }, taksit: { select: { sozlesme: { select: { sozlesmeNo: true } } } },
        },
      },
      taksitler: {
        where: { aktif: true },
        include: {
          taksit: { include: { sozlesme: { include: { tasinmaz: { select: { kisaAd: true } }, malikler: { include: { kisi: true } } } } } },
        },
      },
    },
  })
  if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  return p
}

/** Düz değerli paket detayı (Date/Decimal yok). Görev 9 ve 11 dağılım ve durum bilgisini ekler. */
export async function paketDetayi(id: number, bugun: Tarih = bugunIstanbul()) {
  const p = await paketYukle(id)
  const kurallar = await statuKurallari(bugun)
  const sirali = [...p.taksitler].sort((a, b) => karsilastir(tarihDb(a.taksit.vadeTarihi), tarihDb(b.taksit.vadeTarihi))
    || (a.taksit.sozlesme.sozlesmeNo < b.taksit.sozlesme.sozlesmeNo ? -1 : a.taksit.sozlesme.sozlesmeNo > b.taksit.sozlesme.sozlesmeNo ? 1 : a.taksitId - b.taksitId))
  const faturalar = new Map(p.faturalar.map((f) => [`${f.taksitId}:${f.kisiId}`, f]))
  const faturaGereken: { taksitId: number; kisiId: number; kisiAdi: string; faturaNo: string | null; faturaTarihi: Tarih | null }[] = []
  for (const pt of sirali) {
    const t = pt.taksit
    // Ön kontrol (FATURA_YOK) ile aynı küme: malikParcalari'nın parçalarındaki KDV'li malikler; ek listesi için KDV'siz tüzel kişiler de.
    const { parcalar } = malikParcalari({
      donemBaslangic: tarihDb(t.donemBaslangic), donemBitis: tarihDb(t.donemBitis), vade: tarihDb(t.vadeTarihi), bolunsun: pt.bolunsun,
      malikDonemleri: t.sozlesme.malikler.map((m) => ({
        sozlesmeMalikId: String(m.id), gecerlilikBaslangic: tarihDb(m.gecerlilikBaslangic), gecerlilikBitis: tarihDbOpt(m.gecerlilikBitis), kisi: m.kisi,
      })),
    })
    const gorulen = new Set<number>()
    for (const m of parcalar.flatMap((x) => x.malikler)) {
      if (gorulen.has(m.kisi.id) || !(kurallar[m.kisi.vergiStatusu].kdvli || m.kisi.tip === 'TUZEL')) continue
      gorulen.add(m.kisi.id)
      const f = faturalar.get(`${t.id}:${m.kisi.id}`)
      faturaGereken.push({ taksitId: t.id, kisiId: m.kisi.id, kisiAdi: kisiGorunenAd(m.kisi), faturaNo: f?.faturaNo ?? null, faturaTarihi: f ? tarihDb(f.faturaTarihi) : null })
    }
  }
  return {
    id: p.id, version: p.version, ad: p.ad, durum: p.durum, birim: p.birim,
    vadeBaslangic: tarihDb(p.vadeBaslangic), vadeBitis: tarihDb(p.vadeBitis), kalanOdenek: p.kalanOdenek === null ? null : paraYaz(paraDb(p.kalanOdenek)),
    hesapTarihi: tarihDbOpt(p.hesapTarihi), muhasebeOdemeEmriNo: p.muhasebeOdemeEmriNo, muhasebeOdemeEmriTarihi: tarihDbOpt(p.muhasebeOdemeEmriTarihi),
    odemeTarihi: tarihDbOpt(p.odemeTarihi), iptalNedeni: p.iptalNedeni,
    taksitler: sirali.map((pt) => ({
      taksitId: pt.taksitId, sozlesmeId: pt.taksit.sozlesmeId, sozlesmeNo: pt.taksit.sozlesme.sozlesmeNo, kisaAd: pt.taksit.sozlesme.tasinmaz.kisaAd,
      tur: pt.taksit.tur, donemBaslangic: tarihDb(pt.taksit.donemBaslangic), donemBitis: tarihDb(pt.taksit.donemBitis), vade: tarihDb(pt.taksit.vadeTarihi),
      tutar: paraYaz(paraDb(pt.taksit.tutar)), durum: pt.taksit.durum, bolunsun: pt.bolunsun,
      gecikmis: karsilastir(tarihDb(pt.taksit.vadeTarihi), bugun) < 0,
    })),
    faturaGereken,
    onKontrol: (p.onKontrol ?? null) as PaketOnKontrolKaydi | null,
    toplam: ((p.onKontrol ?? null) as PaketOnKontrolKaydi | null)?.toplam ?? null,
    // Dağılım tablosunda IBAN maskelidir (spec §16: listelerde maskeli); tam IBAN yalnızca çıktılarda.
    dagilim: p.dagilimlar.map((d) => ({
      id: d.id, taksitId: d.taksitId, sozlesmeNo: d.taksit.sozlesme.sozlesmeNo, kisiId: d.kisiId, kisiAdi: kisiGorunenAd(d.kisi),
      odemeKisiAdi: kisiGorunenAd(d.odemeKisi), ibanMaskeli: d.iban ? maskele(ibanNormalize(d.iban.iban)) : null,
      parca: d.parca, parcaBaslangic: tarihDb(d.parcaBaslangic), parcaBitis: tarihDb(d.parcaBitis), pay: d.pay, payda: d.payda,
      brut: paraYaz(paraDb(d.brut)), kdv: paraYaz(paraDb(d.kdv)), stopaj: paraYaz(paraDb(d.stopaj)), damga: paraYaz(paraDb(d.damgaKesintisi)),
      haciz: paraYaz(paraDb(d.hacizKesintisi)), kesinti22a: paraYaz(paraDb(d.kesinti22a)), net: paraYaz(paraDb(d.net)),
      satirlar: ((d.hesapGoruntusu ?? {}) as { satirlar?: HesapSatiri[] }).satirlar ?? [],
    })),
  }
}

export type PaketDetayi = Awaited<ReturnType<typeof paketDetayi>>

export interface OneriSatiri {
  taksitId: number
  sozlesmeId: number
  sozlesmeNo: string
  kisaAd: string
  tur: string
  donemBaslangic: Tarih
  donemBitis: Tarih
  vade: Tarih
  tutar: string
  gecikmis: boolean
}

/** Eklenebilir taksitler: paketin birimindeki, vadesi paket aralığının sonuna kadar olan ve aktif pakette olmayan PLANLANDI taksitler. */
export async function paketOnerileri(paketId: number, bugun: Tarih = bugunIstanbul()): Promise<OneriSatiri[]> {
  const p = await prisma.odemePaketi.findUnique({ where: { id: paketId }, select: { birimId: true, vadeBitis: true } })
  if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  const taksitler = await prisma.taksit.findMany({
    where: {
      durum: 'PLANLANDI', vadeTarihi: { lte: p.vadeBitis }, sozlesme: { birimId: p.birimId, durum: { not: 'TASLAK' } },
      paketKayitlari: { none: { aktif: true } },
    },
    include: { sozlesme: { select: { sozlesmeNo: true, tasinmaz: { select: { kisaAd: true } } } } },
    orderBy: [{ vadeTarihi: 'asc' }, { id: 'asc' }],
    take: 500,
  })
  return taksitler.map((x) => ({
    taksitId: x.id, sozlesmeId: x.sozlesmeId, sozlesmeNo: x.sozlesme.sozlesmeNo, kisaAd: x.sozlesme.tasinmaz.kisaAd, tur: x.tur,
    donemBaslangic: tarihDb(x.donemBaslangic), donemBitis: tarihDb(x.donemBitis), vade: tarihDb(x.vadeTarihi), tutar: paraYaz(paraDb(x.tutar)),
    gecikmis: karsilastir(tarihDb(x.vadeTarihi), bugun) < 0,
  }))
}
