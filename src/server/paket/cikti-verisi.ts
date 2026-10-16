import type { PaketDurumu } from '@/generated/prisma'
import type { DagilimGoruntusu } from '@/core/hesap/goruntu'
import { ekBelgeler, type EkBelge } from '@/core/paket/ek-belge'
import { SIFIR, formatOran, type Para } from '@/core/para'
import { enBuyukTarih, enKucukTarih, formatTarih, parcala, type Tarih } from '@/core/tarih'
import { prisma } from '../db'
import { dbTarih, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, IsKuraliHatasi } from '../hata'
import { KESINLESMIS_PAKET_DURUMLARI } from '../kesinti/servis'
import { kisiGorunenAd } from '../kisi/servis'
import { parametreGetir } from '../parametre/servis'
import type { PaketOnKontrolKaydi } from './hesapla'

export interface AliciCiktisi {
  sira: number; kisiId: number; ad: string; kimlikNo: string; tip: 'GERCEK' | 'TUZEL'; adres: string | null
  odemeKisiAdi: string; iban: string | null
  brut: string; kdv: string; stopaj: string; damga: string; haciz: string; kesinti22a: string; net: string
  kdvli: boolean; faturalar: { no: string; tarih: Tarih }[]
  satirlar: { sozlesmeNo: string; donem: string; brut: string; kdv: string; stopaj: string; stopajOrani: string; damga: string; haciz: string; kesinti22a: string; net: string }[]
}

export interface KesintiCiktisi {
  tur: 'GV_STOPAJI' | 'DAMGA' | 'HACIZ' | 'KESINTI_22A'; altTur: string; kurum: string; dosyaNo: string | null
  kisiAdi: string; kimlikNo: string; hesabaEsas: string; oran: string | null; tutar: string
}

export interface PaketCiktiVerisi {
  paket: { id: number; ad: string; durum: PaketDurumu; hesapTarihi: Tarih; odemeEmriNo: string | null; odemeEmriTarihi: Tarih | null; odemeTarihi: Tarih | null }
  /** Durum HESAPLANDI: belgeler filigranlı basılır. */
  kesinlesmemis: boolean
  /** IDARE_VKN = 'GIRILMEDI' → null */
  idare: { ad: string; vkn: string | null }
  birim: { ad: string; kurumsalKod: string; fonksiyonelKod: string; finansKodu: string; gerceklestirmeGorevlisi: string | null; harcamaYetkilisi: string | null }
  /** Hesap tarihinin yılı. */
  butceYili: number
  /** Anahtar (kisiId, odemeKisiId, ibanId); sıra kişi adı (tr), sonra kimlik. */
  alicilar: AliciCiktisi[]
  kalemler: { sozlesmeNo: string; donem: string; tertip: string; ekonomikKod: string; gider: string }[]
  kesintiler: KesintiCiktisi[]
  toplam: { gider: string; kesinti: string; net: string }
  ekBelgeler: EkBelge[]
}

const CIKTI_DURUMLARI: readonly PaketDurumu[] = ['HESAPLANDI', 'KESINLESTI', 'ODEME_EMRINDE', 'ODENDI']
const MUHTASAR = 'Vergi dairesi (muhtasar)'
const DAMGA_OLAYI: Record<string, string> = { ILK: 'Kira sözleşmesi', YAZILI_ARTIS: 'Yazılı artış', YAZILI_UZATMA: 'Yazılı uzatma' }

const topla = (xs: readonly Para[]): Para => xs.reduce((a, b) => a.plus(b), SIFIR)
const donemMetni = (bas: Tarih, bit: Tarih) => `${formatTarih(bas)}–${formatTarih(bit)}`
const kimlikNo = (k: { tip: 'GERCEK' | 'TUZEL'; tckn: string | null; vkn: string | null }) => (k.tip === 'GERCEK' ? k.tckn : k.vkn) ?? ''
const binde = (x: Para) => `binde ${x.toFixed().replace('.', ',')}`

function grupla<T, K>(xs: readonly T[], anahtar: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of xs) {
    const k = anahtar(x)
    m.set(k, [...(m.get(k) ?? []), x])
  }
  return m
}

/**
 * Föy, ek listesi ve banka listesi için paket verisi (spec §10.2). Tutarlar `paraYaz` metnidir; belgeler biçimler. Tam kimlik numarası ve
 * IBAN yalnızca çıktılarda bulunur; bu veri günlüğe ya da denetime yazılmaz.
 */
export async function paketCiktiVerisi(paketId: number): Promise<PaketCiktiVerisi> {
  const p = await prisma.odemePaketi.findUnique({
    where: { id: paketId },
    include: {
      birim: true,
      faturalar: { orderBy: [{ faturaTarihi: 'asc' }, { id: 'asc' }] },
      taksitler: { where: { aktif: true }, include: { taksit: { select: { sozlesmeId: true, tur: true, artisHesabiId: true, donemBaslangic: true, donemBitis: true } } } },
      dagilimlar: {
        orderBy: { sira: 'asc' },
        include: {
          kisi: true, odemeKisi: true, iban: true,
          taksit: { include: { sozlesme: true } },
          kesintiler: { include: { haciz: true, borcSorgu: true, damgaPayi: { include: { damgaKaydi: true } } } },
        },
      },
    },
  })
  if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  if (!CIKTI_DURUMLARI.includes(p.durum)) throw new IsKuraliHatasi('DURUM', 'Paket henüz hesaplanmadı.')
  const hesapTarihi = tarihDb(p.hesapTarihi!)
  const vkn = await parametreGetir('IDARE_VKN', hesapTarihi)
  const kayit = p.onKontrol as unknown as PaketOnKontrolKaydi

  const satirlar = p.dagilimlar.map((d) => {
    const g = d.hesapGoruntusu as unknown as Partial<DagilimGoruntusu>
    const brut = paraDb(d.brut)
    const kdv = paraDb(d.kdv)
    const stopaj = paraDb(d.stopaj)
    return {
      d, brut, kdv, stopaj, damga: paraDb(d.damgaKesintisi), haciz: paraDb(d.hacizKesintisi), kesinti22a: paraDb(d.kesinti22a), net: paraDb(d.net),
      odenecek: brut.plus(kdv).minus(stopaj), muhsgkKodu: g.muhsgkKodu ?? null,
      donem: donemMetni(tarihDb(d.parcaBaslangic), tarihDb(d.parcaBitis)),
    }
  })

  const alicilar: AliciCiktisi[] = [...grupla(satirlar, (s) => `${s.d.kisiId}:${s.d.odemeKisiId}:${s.d.ibanId ?? '-'}`).values()]
    .map((grup) => {
      const { d } = grup[0]!
      const faturalar = p.faturalar.filter((f) => f.kisiId === d.kisiId && grup.some((s) => s.d.taksitId === f.taksitId))
      return {
        sira: 0, kisiId: d.kisiId, ad: kisiGorunenAd(d.kisi), kimlikNo: kimlikNo(d.kisi), tip: d.kisi.tip, adres: d.kisi.adres,
        odemeKisiAdi: kisiGorunenAd(d.odemeKisi), iban: d.iban?.iban ?? null,
        brut: paraYaz(topla(grup.map((s) => s.brut))), kdv: paraYaz(topla(grup.map((s) => s.kdv))), stopaj: paraYaz(topla(grup.map((s) => s.stopaj))),
        damga: paraYaz(topla(grup.map((s) => s.damga))), haciz: paraYaz(topla(grup.map((s) => s.haciz))),
        kesinti22a: paraYaz(topla(grup.map((s) => s.kesinti22a))), net: paraYaz(topla(grup.map((s) => s.net))),
        kdvli: grup.some((s) => paraDb(s.d.kdvOrani).greaterThan(0)),
        faturalar: faturalar.map((f) => ({ no: f.faturaNo, tarih: tarihDb(f.faturaTarihi) })),
        satirlar: grup.map((s) => ({
          sozlesmeNo: s.d.taksit.sozlesme.sozlesmeNo, donem: s.donem, brut: paraYaz(s.brut), kdv: paraYaz(s.kdv), stopaj: paraYaz(s.stopaj),
          stopajOrani: paraYaz(paraDb(s.d.stopajOrani)), damga: paraYaz(s.damga), haciz: paraYaz(s.haciz), kesinti22a: paraYaz(s.kesinti22a), net: paraYaz(s.net),
        })),
      }
    })
    .sort((a, b) => a.ad.localeCompare(b.ad, 'tr') || a.kisiId - b.kisiId)
    .map((a, i) => ({ ...a, sira: i + 1 }))

  const b = p.birim
  const kalemler = [...grupla(satirlar, (s) => s.d.taksitId).values()].map((grup) => {
    const t = grup[0]!.d.taksit
    return {
      sozlesmeNo: t.sozlesme.sozlesmeNo, donem: donemMetni(tarihDb(t.donemBaslangic), tarihDb(t.donemBitis)),
      tertip: `${b.kurumsalKod}.${b.fonksiyonelKod}.${b.finansKodu}.${t.sozlesme.ekonomikKod}`, ekonomikKod: t.sozlesme.ekonomikKod,
      gider: paraYaz(topla(grup.map((s) => s.brut.plus(s.kdv)))),
    }
  })

  const kesintiler: KesintiCiktisi[] = []
  for (const grup of grupla(satirlar.filter((s) => s.stopaj.greaterThan(0)), (s) => `${s.d.kisiId}:${s.d.stopajOrani.toString()}`).values()) {
    const { d, muhsgkKodu } = grup[0]!
    kesintiler.push({
      tur: 'GV_STOPAJI', altTur: muhsgkKodu ?? 'Kira stopajı', kurum: MUHTASAR, dosyaNo: null, kisiAdi: kisiGorunenAd(d.kisi), kimlikNo: kimlikNo(d.kisi),
      hesabaEsas: paraYaz(topla(grup.map((s) => s.brut))), oran: formatOran(paraDb(d.stopajOrani)), tutar: paraYaz(topla(grup.map((s) => s.stopaj))),
    })
  }
  const kesintiSatirlari = satirlar.flatMap((s) => s.d.kesintiler.map((k) => ({ s, k })))
  for (const grup of grupla(kesintiSatirlari.filter((x) => x.k.tur === 'DAMGA'), (x) => `${x.k.damgaPayi!.damgaKaydiId}:${x.s.d.kisiId}`).values()) {
    const { s, k } = grup[0]!
    const dk = k.damgaPayi!.damgaKaydi
    kesintiler.push({
      tur: 'DAMGA', altTur: DAMGA_OLAYI[dk.olay] ?? dk.olay, kurum: MUHTASAR, dosyaNo: null, kisiAdi: kisiGorunenAd(s.d.kisi), kimlikNo: kimlikNo(s.d.kisi),
      hesabaEsas: paraYaz(paraDb(dk.matrah)), oran: binde(paraDb(dk.oranBinde)), tutar: paraYaz(topla(grup.map((x) => paraDb(x.k.tutar)))),
    })
  }
  for (const grup of grupla(kesintiSatirlari.filter((x) => x.k.tur === 'HACIZ'), (x) => x.k.hacizId!).values()) {
    const { s, k } = grup[0]!
    kesintiler.push({
      tur: 'HACIZ', altTur: 'İcra haczi', kurum: k.haciz!.alacakli, dosyaNo: k.haciz!.dosyaNo, kisiAdi: kisiGorunenAd(s.d.kisi), kimlikNo: kimlikNo(s.d.kisi),
      hesabaEsas: paraYaz(topla(grup.map((x) => x.s.odenecek))), oran: null, tutar: paraYaz(topla(grup.map((x) => paraDb(x.k.tutar)))),
    })
  }
  for (const grup of grupla(kesintiSatirlari.filter((x) => x.k.tur === 'KESINTI_22A'), (x) => x.k.borcSorguId!).values()) {
    const { s, k } = grup[0]!
    kesintiler.push({
      tur: 'KESINTI_22A', altTur: '6183 s. K. md. 22/A', kurum: k.borcSorgu!.vergiDairesi ?? 'Vergi dairesi', dosyaNo: k.borcSorgu!.belgeNo,
      kisiAdi: kisiGorunenAd(s.d.kisi), kimlikNo: kimlikNo(s.d.kisi),
      hesabaEsas: paraYaz(topla(grup.map((x) => x.s.odenecek))), oran: null, tutar: paraYaz(topla(grup.map((x) => paraDb(x.k.tutar)))),
    })
  }

  const gider = topla(satirlar.map((s) => s.brut.plus(s.kdv)))
  const net = topla(satirlar.map((s) => s.net))

  // İlk ödeme: sözleşmenin taksiti bu paketten önce kesinleşmiş başka bir pakette yok ve paketsiz ödenmiş (sistem dışı/göç) taksiti yok.
  const sozlesmeler = [...new Map(p.dagilimlar.map((d) => [d.taksit.sozlesmeId, d.taksit.sozlesme])).values()]
  const sozlesmeBelgeleri = []
  for (const s of sozlesmeler) {
    const oncekiPaket = await prisma.paketTaksit.count({
      where: {
        paketId: { not: paketId }, taksit: { sozlesmeId: s.id },
        paket: { durum: { in: [...KESINLESMIS_PAKET_DURUMLARI] }, ...(p.kesinlesmeZamani ? { kesinlesmeZamani: { lt: p.kesinlesmeZamani } } : {}) },
      },
    })
    const paketsizOdenen = await prisma.taksit.count({ where: { sozlesmeId: s.id, durum: 'ODENDI', paketKayitlari: { none: { aktif: true } } } })
    const kendi = p.taksitler.filter((x) => x.taksit.sozlesmeId === s.id)
    const bas = kendi.map((x) => tarihDb(x.taksit.donemBaslangic)).reduce(enKucukTarih)
    const bit = kendi.map((x) => tarihDb(x.taksit.donemBitis)).reduce(enBuyukTarih)
    const artisVar = kendi.some((x) => x.taksit.artisHesabiId !== null) || (await prisma.artisHesabi.count({
      where: { sozlesmeId: s.id, durum: 'ONAYLANDI', donemBaslangic: { gte: dbTarih(bas), lte: dbTarih(bit) } },
    })) > 0
    sozlesmeBelgeleri.push({
      sozlesmeNo: s.sozlesmeNo, ilkOdeme: oncekiPaket === 0 && paketsizOdenen === 0, onayBelgesiNo: s.onayBelgesiNo,
      onayBelgesiTarihi: tarihDbOpt(s.onayBelgesiTarihi), piyasaArastirmaTarihi: tarihDbOpt(s.piyasaArastirmaTarihi), imzaTarihi: tarihDbOpt(s.imzaTarihi), artisVar,
    })
  }
  const sorguIdleri = kayit.alicilar22a.filter((a) => a.sorguGerekli && a.borcSorguId !== null).map((a) => Number(a.borcSorguId))
  const sorgular = await prisma.borcSorgu.findMany({ where: { id: { in: sorguIdleri } }, orderBy: { id: 'asc' } })
  const hacizler = [...new Map(kesintiSatirlari.filter((x) => x.k.haciz !== null).map((x) => [x.k.haciz!.id, x.k.haciz!])).values()]

  return {
    paket: {
      id: p.id, ad: p.ad, durum: p.durum, hesapTarihi, odemeEmriNo: p.muhasebeOdemeEmriNo, odemeEmriTarihi: tarihDbOpt(p.muhasebeOdemeEmriTarihi),
      odemeTarihi: tarihDbOpt(p.odemeTarihi),
    },
    kesinlesmemis: p.durum === 'HESAPLANDI',
    idare: { ad: await parametreGetir('IDARE_ADI', hesapTarihi), vkn: vkn === 'GIRILMEDI' ? null : vkn },
    birim: { ad: b.ad, kurumsalKod: b.kurumsalKod, fonksiyonelKod: b.fonksiyonelKod, finansKodu: b.finansKodu, gerceklestirmeGorevlisi: b.gerceklestirmeGorevlisi, harcamaYetkilisi: b.harcamaYetkilisi },
    butceYili: parcala(hesapTarihi).yil,
    alicilar, kalemler, kesintiler,
    toplam: { gider: paraYaz(gider), kesinti: paraYaz(gider.minus(net)), net: paraYaz(net) },
    ekBelgeler: ekBelgeler({
      sozlesmeler: sozlesmeBelgeleri,
      alicilar: alicilar.map((a) => ({ ad: a.ad, tip: a.tip, kdvli: a.kdvli, faturalar: a.faturalar })),
      sorgular: sorgular.map((s) => ({ belgeNo: s.belgeNo, sorguTarihi: tarihDb(s.sorguTarihi), vergiDairesi: s.vergiDairesi })),
      hacizler: hacizler.map((x) => ({ dosyaNo: x.dosyaNo, tebligTarihi: tarihDb(x.tebligTarihi), alacakli: x.alacakli })),
    }),
  }
}
