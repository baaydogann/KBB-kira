import type { HesapSatiri } from '@/core/hesap/goruntu'
import { formatOran, SIFIR } from '@/core/para'
import { ayAdi, formatTarih, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { denetimDosyasiBolumleri } from '../cikti/belgeler/denetim-dosyasi'
import { pdfUret } from '../cikti/pdf'
import { prisma } from '../db'
import { disaAktarimKaydi } from '../denetim'
import { paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, IsKuraliHatasi } from '../hata'
import { KESINLESMIS_PAKET_DURUMLARI } from '../kesinti/servis'
import { kisiGorunenAd } from '../kisi/servis'

export interface DenetimDosyasiVerisi {
  kunye: {
    sozlesmeNo: string; durum: string; tasinmaz: string; birim: string; ekonomikKod: string; imzaTarihi: Tarih | null; baslangic: Tarih; bitis: Tarih | null
    ilkKiraBaslangici: Tarih; bedel: string; bedelTabani: string; bedelTuru: string; odemePeriyoduAy: number; artisKurali: string; ihaleDayanagi: string
    onayBelgesiNo: string | null; onayBelgesiTarihi: Tarih | null; oncekiSozlesmeNo: string | null
  }
  malikler: { ad: string; kimlikNo: string; pay: number; payda: number; gecerlilikBaslangic: Tarih; gecerlilikBitis: Tarih | null; iban: string | null; vekil: string | null }[]
  kiraDonemleri: { baslangic: Tarih; bitis: Tarih | null; bedel: string; taban: string; kaynak: string; aciklama: string | null }[]
  artislar: {
    donemBaslangic: Tarih; referans: string; tavan: string | null; sozlesmeOrani: string | null; uygulanan: string | null; eskiBedel: string; yeniBedel: string | null
    durum: string; onaylayan: string | null; onayZamani: string | null
    endeksOnayi: { deger: string; kaynak: string; onaylayan: string | null; onayZamani: string | null } | null; satirlar: HesapSatiri[]
  }[]
  taksitler: { donem: string; vade: Tarih; tur: string; tutar: string; durum: string; odemeTarihi: Tarih | null; paket: string | null; sistemDisi: boolean; satirlar: HesapSatiri[] }[]
  /** Yalnız kesinleşmiş paketler. */
  dagilimlar: { paket: string; donem: string; malik: string; brut: string; kdv: string; stopaj: string; damga: string; haciz: string; kesinti22a: string; net: string; satirlar: HesapSatiri[] }[]
  damga: { olay: string; olayTarihi: Tarih; matrah: string; tutar: string; tahsil: string; kalan: string; makbuz: boolean; iptal: boolean }[]
  /** En yeni 500; yalnızca zaman, kullanıcı, varlık ve eylem (önce/sonra içeriği KVKK gereği alınmaz). */
  olaylar: { zaman: string; kullanici: string | null; varlik: string; eylem: string }[]
}

const AZAMI_OLAY = 500
const zaman = (d: Date) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
const satirlari = (j: unknown): HesapSatiri[] => ((j ?? {}) as { satirlar?: HesapSatiri[] }).satirlar ?? []
const oran = (x: { toString(): string } | null) => (x === null ? null : formatOran(paraDb(x)))
const donem = (bas: Date, bit: Date) => `${formatTarih(tarihDb(bas))}–${formatTarih(tarihDb(bit))}`
const paketAdi = (p: { id: number; ad: string }) => `#${p.id} ${p.ad}`

/** Spec §11: sözleşme bazında denetim dosyası verisi; taslak sözleşmenin dosyası yoktur. */
export async function denetimDosyasiVerisi(sozlesmeId: number): Promise<DenetimDosyasiVerisi> {
  const s = await prisma.sozlesme.findUnique({
    where: { id: sozlesmeId },
    include: {
      tasinmaz: { select: { kisaAd: true } }, birim: { select: { ad: true } }, oncekiSozlesme: { select: { sozlesmeNo: true } },
      malikler: { include: { kisi: true, iban: true, vekil: true }, orderBy: [{ gecerlilikBaslangic: 'asc' }, { id: 'asc' }] },
      kiraDonemleri: { orderBy: { baslangic: 'asc' } },
      artislar: { orderBy: { donemBaslangic: 'asc' } },
      taksitler: { orderBy: [{ donemBaslangic: 'asc' }, { tur: 'asc' }, { id: 'asc' }], include: { paketKayitlari: { include: { paket: { select: { id: true, ad: true } } } } } },
      damgaKayitlari: { orderBy: { id: 'asc' }, include: { paylar: { select: { kalan: true } } } },
    },
  })
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  if (s.durum === 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Taslak sözleşmenin denetim dosyası yoktur.')
  const taksitIdleri = s.taksitler.map((t) => t.id)
  const dagilimlar = await prisma.taksitDagilim.findMany({
    where: { taksitId: { in: taksitIdleri }, paket: { durum: { in: [...KESINLESMIS_PAKET_DURUMLARI] } } },
    include: { paket: { select: { id: true, ad: true } }, kisi: true }, orderBy: [{ paketId: 'asc' }, { sira: 'asc' }],
  })
  const endeksler = await prisma.endeksDegeri.findMany({
    where: { seri: 'TUFE_12AY_ORT', onayDurumu: 'ONAYLANDI', OR: s.artislar.map((a) => ({ yil: a.referansYil, ay: a.referansAy })) },
  })
  const paketIdleri = [...new Set(s.taksitler.flatMap((t) => t.paketKayitlari.map((k) => k.paketId)))]
  const olaylar = await prisma.olayGunlugu.findMany({
    where: {
      OR: [
        { varlik: 'sozlesme', varlikId: String(s.id) },
        { varlik: 'damga_kaydi', varlikId: { in: s.damgaKayitlari.map((d) => String(d.id)) } },
        { varlik: 'taksit', varlikId: { in: taksitIdleri.map(String) } },
        { varlik: 'odeme_paketi', varlikId: { in: paketIdleri.map(String) } },
      ],
    },
    select: { zaman: true, kullaniciId: true, varlik: true, eylem: true },
    orderBy: [{ zaman: 'desc' }, { id: 'desc' }], take: AZAMI_OLAY,
  })
  const kullaniciIdleri = [...new Set([
    ...olaylar.flatMap((o) => (o.kullaniciId === null ? [] : [o.kullaniciId])),
    ...s.artislar.flatMap((a) => (a.onaylayanId === null ? [] : [a.onaylayanId])),
    ...endeksler.flatMap((e) => (e.onaylayanId === null ? [] : [e.onaylayanId])),
  ])]
  const adlar = new Map((await prisma.kullanici.findMany({ where: { id: { in: kullaniciIdleri } }, select: { id: true, adSoyad: true } })).map((k) => [k.id, k.adSoyad]))
  const ad = (id: number | null) => (id === null ? null : (adlar.get(id) ?? null))
  const kimlik = (k: { tip: 'GERCEK' | 'TUZEL'; tckn: string | null; vkn: string | null }) => (k.tip === 'GERCEK' ? k.tckn : k.vkn) ?? ''

  return {
    kunye: {
      sozlesmeNo: s.sozlesmeNo, durum: s.durum, tasinmaz: s.tasinmaz.kisaAd, birim: s.birim.ad, ekonomikKod: s.ekonomikKod, imzaTarihi: tarihDbOpt(s.imzaTarihi),
      baslangic: tarihDb(s.baslangic), bitis: tarihDbOpt(s.bitis), ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici), bedel: paraYaz(paraDb(s.bedelTutari)),
      bedelTabani: s.bedelTabani, bedelTuru: s.bedelTuru, odemePeriyoduAy: s.odemePeriyoduAy, artisKurali: s.artisKurali, ihaleDayanagi: s.ihaleDayanagi,
      onayBelgesiNo: s.onayBelgesiNo, onayBelgesiTarihi: tarihDbOpt(s.onayBelgesiTarihi), oncekiSozlesmeNo: s.oncekiSozlesme?.sozlesmeNo ?? null,
    },
    malikler: s.malikler.map((m) => ({
      ad: kisiGorunenAd(m.kisi), kimlikNo: kimlik(m.kisi), pay: m.pay, payda: m.payda, gecerlilikBaslangic: tarihDb(m.gecerlilikBaslangic),
      gecerlilikBitis: tarihDbOpt(m.gecerlilikBitis), iban: m.iban?.iban ?? null, vekil: m.vekil ? kisiGorunenAd(m.vekil) : null,
    })),
    kiraDonemleri: s.kiraDonemleri.map((d) => ({
      baslangic: tarihDb(d.baslangic), bitis: tarihDbOpt(d.bitis), bedel: paraYaz(paraDb(d.bedelTutari)), taban: d.bedelTabani, kaynak: d.kaynak, aciklama: d.aciklama,
    })),
    artislar: s.artislar.map((a) => {
      const e = endeksler.find((x) => x.yil === a.referansYil && x.ay === a.referansAy)
      return {
        donemBaslangic: tarihDb(a.donemBaslangic), referans: ayAdi({ yil: a.referansYil, ay: a.referansAy }), tavan: oran(a.tavan), sozlesmeOrani: oran(a.sozlesmeOrani),
        uygulanan: oran(a.uygulananOran), eskiBedel: paraYaz(paraDb(a.eskiBedel)), yeniBedel: a.yeniBedel === null ? null : paraYaz(paraDb(a.yeniBedel)),
        durum: a.durum, onaylayan: ad(a.onaylayanId), onayZamani: a.onayZamani ? zaman(a.onayZamani) : null,
        endeksOnayi: e ? { deger: e.deger.toString(), kaynak: e.kaynak, onaylayan: ad(e.onaylayanId), onayZamani: e.onayZamani ? zaman(e.onayZamani) : null } : null,
        satirlar: satirlari(a.gerekce),
      }
    }),
    taksitler: s.taksitler.map((t) => {
      const k = t.paketKayitlari.find((x) => x.aktif) ?? null
      return {
        donem: donem(t.donemBaslangic, t.donemBitis), vade: tarihDb(t.vadeTarihi), tur: t.tur, tutar: paraYaz(paraDb(t.tutar)), durum: t.durum,
        odemeTarihi: tarihDbOpt(t.odemeTarihi), paket: k ? paketAdi(k.paket) : null, sistemDisi: t.sistemDisiOdeme, satirlar: satirlari(t.hesapGoruntusu),
      }
    }),
    dagilimlar: dagilimlar.map((d) => ({
      paket: paketAdi(d.paket), donem: donem(d.parcaBaslangic, d.parcaBitis), malik: kisiGorunenAd(d.kisi), brut: paraYaz(paraDb(d.brut)), kdv: paraYaz(paraDb(d.kdv)),
      stopaj: paraYaz(paraDb(d.stopaj)), damga: paraYaz(paraDb(d.damgaKesintisi)), haciz: paraYaz(paraDb(d.hacizKesintisi)), kesinti22a: paraYaz(paraDb(d.kesinti22a)),
      net: paraYaz(paraDb(d.net)), satirlar: satirlari(d.hesapGoruntusu),
    })),
    damga: s.damgaKayitlari.map((d) => ({
      olay: d.olay, olayTarihi: tarihDb(d.olayTarihi), matrah: paraYaz(paraDb(d.matrah)), tutar: paraYaz(paraDb(d.tutar)), tahsil: d.tahsil,
      kalan: paraYaz(d.paylar.reduce((t, p) => t.plus(paraDb(p.kalan)), SIFIR)), makbuz: d.makbuzBelgeId !== null, iptal: d.iptal,
    })),
    olaylar: olaylar.map((o) => ({ zaman: zaman(o.zaman), kullanici: ad(o.kullaniciId), varlik: o.varlik, eylem: o.eylem })),
  }
}

/** Denetim dosyası PDF'i (yatay). Dışa aktarım kaydı PDF üretildikten sonra yazılır; içinde yalnız belge türü ve taksit sayısı vardır. */
export async function denetimDosyasiPdf(sozlesmeId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }> {
  const v = await denetimDosyasiVerisi(sozlesmeId)
  const icerik = await pdfUret({ baslik: `Denetim dosyası ${v.kunye.sozlesmeNo}`, bolumler: denetimDosyasiBolumleri(v), yatay: true })
  await disaAktarimKaydi(prisma, baglam, { varlik: 'sozlesme', varlikId: sozlesmeId, belge: 'DENETIM_DOSYASI', kayitSayisi: v.taksitler.length })
  return { dosyaAdi: `denetim-dosyasi-${v.kunye.sozlesmeNo.replace(/[^A-Za-z0-9-]/g, '')}.pdf`, icerik }
}
