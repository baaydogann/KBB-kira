import { maskele } from '@/core/dogrulama'
import { formatTL, para } from '@/core/para'
import { bugunIstanbul, gunFarki, icindeMi, isGunuMu, type Tarih } from '@/core/tarih'
import { uyumUyarilari, type UyumUyarisi } from '@/core/uyum'
import type { Prisma, SozlesmeDurumu } from '@/generated/prisma'
import { belgeListesi } from '../belge/servis'
import { prisma } from '../db'
import { tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { parametreOpsiyonel } from '../parametre/servis'
import { tatilKumesi } from '../tatil/servis'

function guncelBedel(kd: { baslangic: Date; bitis: Date | null; bedelTutari: { toFixed(n: number): string } }[], bugun: Tarih, varsayilan: { toFixed(n: number): string }): string {
  const k = kd.find((x) => icindeMi(bugun, { baslangic: tarihDb(x.baslangic), bitis: tarihDbOpt(x.bitis) })) ?? kd.at(-1)
  return (k?.bedelTutari ?? varsayilan).toFixed(2)
}

export async function sozlesmeListesi(f: { durum?: SozlesmeDurumu; q?: string }, bugun: Tarih = bugunIstanbul()) {
  const q = f.q?.trim()
  const where: Prisma.SozlesmeWhereInput = {
    ...(f.durum ? { durum: f.durum } : {}),
    ...(q ? { OR: [{ sozlesmeNo: { contains: q, mode: 'insensitive' } }, { tasinmaz: { kisaAd: { contains: q, mode: 'insensitive' } } }] } : {}),
  }
  const liste = await prisma.sozlesme.findMany({
    where, include: { tasinmaz: true, birim: true, kiraDonemleri: { orderBy: { baslangic: 'asc' } } },
    orderBy: [{ durum: 'asc' }, { bitis: 'asc' }, { id: 'asc' }], take: 500,
  })
  return liste.map((s) => {
    const bitis = tarihDbOpt(s.bitis)
    return {
      id: s.id, sozlesmeNo: s.sozlesmeNo, durum: s.durum, tasinmaz: s.tasinmaz.kisaAd, birim: s.birim.ad,
      baslangic: tarihDb(s.baslangic), bitis, kalanGun: bitis === null ? null : gunFarki(bugun, bitis),
      guncelBedel: guncelBedel(s.kiraDonemleri, bugun, s.bedelTutari), bedelTabani: s.bedelTabani,
    }
  })
}

export async function sozlesmeDetayi(id: number, bugun: Tarih = bugunIstanbul()) {
  const s = await prisma.sozlesme.findUnique({
    where: { id },
    include: {
      tasinmaz: true, birim: true, oncekiSozlesme: true, sonrakiSozlesme: true,
      malikler: { include: { kisi: true, iban: true, vekil: true }, orderBy: [{ gecerlilikBaslangic: 'desc' }, { id: 'asc' }] },
      kiraDonemleri: { orderBy: { baslangic: 'asc' } },
      artislar: { orderBy: { donemBaslangic: 'desc' } },
      taksitler: { orderBy: [{ donemBaslangic: 'asc' }, { tur: 'asc' }] },
    },
  })
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  const vadeler = s.taksitler.map((x) => tarihDb(x.vadeTarihi)).sort()
  const [belgeler, olaylar, tasarruf, tatiller] = await Promise.all([
    belgeListesi('sozlesme', id),
    prisma.olayGunlugu.findMany({ where: { varlik: 'sozlesme', varlikId: String(id) }, orderBy: [{ zaman: 'desc' }, { id: 'desc' }], take: 200 }),
    parametreOpsiyonel('TASARRUF_GENELGESI_2024_7', bugun),
    vadeler.length === 0 ? new Set<string>() : tatilKumesi(vadeler[0]!, vadeler.at(-1)!),
  ])
  const uyarilar: UyumUyarisi[] = uyumUyarilari({
    odemePeriyoduAy: s.odemePeriyoduAy, odemeZamani: s.odemeZamani, artisPeriyoduAy: s.artisPeriyoduAy, artisKurali: s.artisKurali,
    kullanimAmaci: s.tasinmaz.kullanimAmaci, taslak: s.durum === 'TASLAK', tasarrufGenelgesiYururlukte: tasarruf !== null,
  })
  return {
    ...s,
    guncelBedel: guncelBedel(s.kiraDonemleri, bugun, s.bedelTutari),
    kalanGun: s.bitis === null ? null : gunFarki(bugun, tarihDb(s.bitis)),
    // Kişi ve IBAN satırları (TCKN/VKN, tam IBAN, telefon, adres) çıktıya girmez: sekmeler yalnızca ad ve maskeli IBAN görür.
    malikler: s.malikler.map(({ kisi, iban, vekil, ...m }) => ({
      ...m, kisiAdi: kisiGorunenAd(kisi), vekilAdi: vekil ? kisiGorunenAd(vekil) : null, ibanMaskeli: iban ? maskele(iban.iban) : null,
    })),
    belgeler, olaylar, uyarilar,
    // Vadesi iş günü olmayan taksitler: sözleşmesel vade kaydırılmaz, "tatile denk geliyor" etiketiyle gösterilir (spec §7.2).
    tatileDenkTaksitIdleri: s.taksitler.filter((x) => !isGunuMu(tarihDb(x.vadeTarihi), tatiller)).map((x) => x.id),
  }
}

export type SozlesmeDetayi = Awaited<ReturnType<typeof sozlesmeDetayi>>

export async function sihirbazSecenekleri() {
  const [tasinmazlar, birimler, kisiler] = await Promise.all([
    prisma.tasinmaz.findMany({ orderBy: { kisaAd: 'asc' }, select: { id: true, kisaAd: true, tur: true, kullanimAmaci: true } }),
    prisma.birim.findMany({ where: { aktif: true }, orderBy: { ad: 'asc' }, select: { id: true, ad: true } }),
    prisma.kisi.findMany({ include: { ibanlar: { where: { aktif: true } } }, orderBy: [{ soyad: 'asc' }, { unvan: 'asc' }, { id: 'asc' }] }),
  ])
  return {
    tasinmazlar, birimler,
    kisiler: kisiler.map((k) => ({ id: k.id, ad: kisiGorunenAd(k), statu: k.vergiStatusu, ibanlar: k.ibanlar.map((i) => ({ id: i.id, etiket: `${maskele(i.iban)}${i.bankaAdi ? ` (${i.bankaAdi})` : ''}` })) })),
  }
}

export type SihirbazSecenekleri = Awaited<ReturnType<typeof sihirbazSecenekleri>>

const metin = (x: { toString(): string } | null) => (x === null ? '' : formatTL(para(x.toString()), false))
const oranMetni = (x: { toString(): string } | null) => (x === null ? '' : x.toString().replace('.', ','))

export async function sozlesmeTaslakFormu(id: number) {
  const s = await prisma.sozlesme.findUnique({ where: { id }, include: { malikler: { orderBy: { id: 'asc' } } } })
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  const tarihMetni = (d: Date | null) => tarihDbOpt(d) ?? ''
  return {
    id: s.id, version: s.version, durum: s.durum,
    veri: {
      sozlesmeNo: s.sozlesmeNo, tasinmazId: s.tasinmazId, birimId: s.birimId, ekonomikKod: s.ekonomikKod,
      imzaTarihi: tarihMetni(s.imzaTarihi), baslangic: tarihMetni(s.baslangic), bitis: tarihMetni(s.bitis), ilkKiraBaslangici: tarihMetni(s.ilkKiraBaslangici),
      bedelTutari: metin(s.bedelTutari), bedelTabani: s.bedelTabani, bedelTuru: s.bedelTuru, odemePeriyoduAy: s.odemePeriyoduAy as 1 | 3 | 6 | 12,
      odemeZamani: s.odemeZamani, vadeKurali: s.vadeKurali, vadeParametresi: s.vadeParametresi, artisKurali: s.artisKurali,
      artisDegisimTuru: s.artisDegisimTuru, sabitArtisOrani: oranMetni(s.sabitArtisOrani), artisPeriyoduAy: s.artisPeriyoduAy,
      kistYontemi: s.kistYontemi, damgaTahsil: s.damgaTahsil, ihaleDayanagi: s.ihaleDayanagi, onayBelgesiNo: s.onayBelgesiNo ?? '',
      onayBelgesiTarihi: tarihMetni(s.onayBelgesiTarihi), piyasaArastirmaTarihi: tarihMetni(s.piyasaArastirmaTarihi), encumenKararNo: s.encumenKararNo ?? '',
      gecisTarihi: tarihMetni(s.gecisTarihi), gecisBedeli: metin(s.gecisBedeli), odenmisSayilanSonTarih: tarihMetni(s.odenmisSayilanSonTarih), notlar: s.notlar ?? '',
      malikler: s.malikler.map((m) => ({ kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId })),
    },
  }
}
