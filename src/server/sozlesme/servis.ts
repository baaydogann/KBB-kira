import { hisseToplamiBirMi } from '@/core/hisse'
import { sozlesmeOnizleme, type OnizlemeSatiri } from '@/core/hesap/onizleme'
import type { KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import { SIFIR, type Para } from '@/core/para'
import { ayEkle, bugunIstanbul, enBuyukTarih, enKucukTarih, gunEkle, icindeMi, karsilastir, type Tarih } from '@/core/tarih'
import type { VergiStatusu } from '@/core/tipler'
import type { Sozlesme } from '@/generated/prisma'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, dbTarihOpt, oranYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { varsayilanEkonomikKod, vergiOranlari } from '../parametre/servis'
import { taksitPlaniniGuncelle } from '../taksit/servis'
import type { MalikGirdisi, SozlesmeGirdisi } from './sema'

function sozlesmeVerisi(g: SozlesmeGirdisi, ekonomikKod: string) {
  return {
    sozlesmeNo: g.sozlesmeNo, tasinmazId: g.tasinmazId, birimId: g.birimId, ekonomikKod,
    imzaTarihi: dbTarihOpt(g.imzaTarihi), baslangic: dbTarih(g.baslangic), bitis: dbTarihOpt(g.bitis),
    ilkKiraBaslangici: dbTarih(g.ilkKiraBaslangici ?? g.baslangic),
    bedelTutari: paraYaz(g.bedelTutari!), bedelTabani: g.bedelTabani, bedelTuru: g.bedelTuru,
    odemePeriyoduAy: g.odemePeriyoduAy, odemeZamani: g.odemeZamani, vadeKurali: g.vadeKurali, vadeParametresi: g.vadeParametresi,
    artisKurali: g.artisKurali, artisDegisimTuru: g.artisDegisimTuru,
    sabitArtisOrani: g.sabitArtisOrani === null ? null : oranYaz(g.sabitArtisOrani),
    artisPeriyoduAy: g.artisPeriyoduAy, kistYontemi: g.kistYontemi, damgaTahsil: g.damgaTahsil, ihaleDayanagi: g.ihaleDayanagi,
    onayBelgesiNo: g.onayBelgesiNo, onayBelgesiTarihi: dbTarihOpt(g.onayBelgesiTarihi),
    piyasaArastirmaTarihi: dbTarihOpt(g.piyasaArastirmaTarihi), encumenKararNo: g.encumenKararNo,
    gecisTarihi: dbTarihOpt(g.gecisTarihi), gecisBedeli: g.gecisBedeli === null ? null : paraYaz(g.gecisBedeli),
    odenmisSayilanSonTarih: dbTarihOpt(g.odenmisSayilanSonTarih), notlar: g.notlar,
  }
}

const ALANLAR = [
  'sozlesmeNo', 'tasinmazId', 'birimId', 'ekonomikKod', 'imzaTarihi', 'baslangic', 'bitis', 'ilkKiraBaslangici',
  'bedelTutari', 'bedelTabani', 'bedelTuru', 'odemePeriyoduAy', 'odemeZamani', 'vadeKurali', 'vadeParametresi',
  'artisKurali', 'artisDegisimTuru', 'sabitArtisOrani', 'artisPeriyoduAy', 'kistYontemi', 'damgaTahsil', 'ihaleDayanagi',
  'onayBelgesiNo', 'onayBelgesiTarihi', 'piyasaArastirmaTarihi', 'encumenKararNo',
  'gecisTarihi', 'gecisBedeli', 'odenmisSayilanSonTarih', 'notlar',
] as const
type Alanlar = Readonly<Record<(typeof ALANLAR)[number], unknown>>

/** Serbest metin kişi adı, telefon, adres gibi kişisel veri içerebilir; denetim satırına değeri yazılmaz, yalnız değiştiği belirtilir. */
const SERBEST_METIN_ALANLARI: ReadonlySet<string> = new Set(['notlar'])
const ACIK_ALANLAR = ALANLAR.filter((a) => !SERBEST_METIN_ALANLARI.has(a))

/** Veritabanı satırı, kayıt verisiyle aynı biçime getirilir (tutar iki, oran dört ondalıklı metin). */
function satirAlanlari(s: Sozlesme): Alanlar {
  return {
    ...s,
    bedelTutari: paraYaz(paraDb(s.bedelTutari)),
    sabitArtisOrani: s.sabitArtisOrani === null ? null : oranYaz(paraDb(s.sabitArtisOrani)),
    gecisBedeli: s.gecisBedeli === null ? null : paraYaz(paraDb(s.gecisBedeli)),
  }
}

const gorunum = (v: unknown): unknown => (v instanceof Date ? tarihDb(v) : v)

/** Maliklerin yalnızca kimlikleri ve payları: kişi adı, kimlik numarası ve IBAN değeri yazılmaz. */
function malikOzeti(malikler: readonly MalikGirdisi[]): MalikGirdisi[] {
  return malikler
    .map((m) => ({ kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId }))
    .sort((a, b) => a.kisiId - b.kisiId)
}

function denetimOzeti(a: Alanlar, malikler: readonly MalikGirdisi[]) {
  return { ...Object.fromEntries(ACIK_ALANLAR.map((ad) => [ad, gorunum(a[ad])])), malikler: malikOzeti(malikler) }
}

function degisenAlanlar(once: Alanlar, sonra: Alanlar, eskiMalikler: readonly MalikGirdisi[], yeniMalikler: readonly MalikGirdisi[]): string[] {
  const alanlar: string[] = ALANLAR.filter((ad) => JSON.stringify(gorunum(once[ad])) !== JSON.stringify(gorunum(sonra[ad])))
  if (JSON.stringify(malikOzeti(eskiMalikler)) !== JSON.stringify(malikOzeti(yeniMalikler))) alanlar.push('malikler')
  return alanlar
}

export async function sozlesmeTaslakKaydet(g: SozlesmeGirdisi, baglam: IslemBaglami, id?: number, version?: number): Promise<number> {
  // Sürümsüz güncelleme iyimser kilidi sessizce düşürürdü.
  if (id !== undefined && version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
  try {
    return await prisma.$transaction(async (tx) => {
      const tasinmaz = await tx.tasinmaz.findUnique({ where: { id: g.tasinmazId } })
      if (!tasinmaz) throw new IsKuraliHatasi('TASINMAZ', 'Taşınmaz bulunamadı.', 'tasinmazId')
      // Ekonomik kod, geçmişteki sözleşme başlangıcının değil, ileride yapılacak ödemelerin bütçe uygulama niteliğidir:
      // yıllar önce başlamış bir sözleşme göçte bugünkü sınıflandırmayla, ileri tarihli sözleşme kendi başlangıcıyla kodlanır.
      const ekonomikKod = g.ekonomikKod ?? (await varsayilanEkonomikKod(tasinmaz.tur, tasinmaz.kullanimAmaci, enBuyukTarih(g.baslangic, bugunIstanbul()), tx))
      const veri = sozlesmeVerisi(g, ekonomikKod)
      let sozlesmeId: number
      if (id === undefined) {
        sozlesmeId = (await tx.sozlesme.create({ data: veri })).id
        await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: sozlesmeId, eylem: 'OLUSTUR', sonra: denetimOzeti(veri, g.malikler) })
      } else {
        const mevcut = await tx.sozlesme.findUnique({ where: { id }, include: { malikler: true } })
        if (!mevcut) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
        if (mevcut.durum !== 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Yalnızca taslak sözleşmeler bu ekrandan düzenlenebilir.')
        const r = await tx.sozlesme.updateMany({ where: { id, version }, data: { ...veri, version: { increment: 1 } } })
        if (r.count === 0) throw new CakismaHatasi()
        await tx.sozlesmeMalik.deleteMany({ where: { sozlesmeId: id } })
        const once = satirAlanlari(mevcut)
        await denetimKaydi(tx, baglam, {
          varlik: 'sozlesme', varlikId: id, eylem: 'GUNCELLE',
          once: denetimOzeti(once, mevcut.malikler),
          sonra: { ...denetimOzeti(veri, g.malikler), degisenAlanlar: degisenAlanlar(once, veri, mevcut.malikler, g.malikler) },
        })
        sozlesmeId = id
      }
      for (const m of g.malikler) {
        await tx.sozlesmeMalik.create({
          data: { sozlesmeId, kisiId: m.kisiId, pay: m.pay, payda: m.payda, ibanId: m.ibanId, vekilKisiId: m.vekilKisiId, gecerlilikBaslangic: dbTarih(g.baslangic) },
        })
      }
      return sozlesmeId
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('SOZLESME_NO', 'Bu sözleşme numarası zaten kullanılıyor.', 'sozlesmeNo')
    throw e
  }
}

function girdiKiraDonemleri(g: SozlesmeGirdisi): KiraDonemiGirdi[] {
  const bedel = g.bedelTutari!
  if (g.gecisTarihi === null || g.gecisBedeli === null) {
    return [{ id: 'ILK', baslangic: g.baslangic, bitis: null, bedel, taban: g.bedelTabani }]
  }
  return [
    { id: 'ILK', baslangic: g.baslangic, bitis: gunEkle(g.gecisTarihi, -1), bedel, taban: g.bedelTabani },
    { id: 'GECIS', baslangic: g.gecisTarihi, bitis: null, bedel: g.gecisBedeli, taban: g.bedelTabani },
  ]
}

export type OnizlemeCiktisi =
  | { ok: true; satirlar: { baslangic: Tarih; bitis: Tarih; vade: Tarih; tutar: string; malikler: { kisiId: string; ad: string; brut: string; kdv: string; stopaj: string; net: string }[] }[] }
  | { ok: false; mesaj: string }

/** Kaydetmeden önce: geçiş tarihinden (yoksa başlangıçtan) itibaren en çok 24 taksit, bugünkü vergi oranlarıyla. */
export async function sozlesmeOnizle(g: SozlesmeGirdisi, bugun: Tarih = bugunIstanbul()): Promise<OnizlemeCiktisi> {
  const kisiler = await prisma.kisi.findMany({ where: { id: { in: g.malikler.map((m) => m.kisiId) } } })
  const kisiMap = new Map(kisiler.map((k) => [String(k.id), k]))
  const oranlar = new Map<VergiStatusu, { stopaj: Para; kdv: Para }>()
  for (const k of kisiler) {
    if (!oranlar.has(k.vergiStatusu)) {
      const o = await vergiOranlari(k.vergiStatusu, bugun)
      oranlar.set(k.vergiStatusu, { stopaj: o.stopaj, kdv: o.kdv })
    }
  }
  const ilkSatir = g.gecisTarihi ?? g.baslangic
  const sonuc = sozlesmeOnizleme({
    baslangic: g.baslangic, bitis: g.bitis, periyotAy: g.odemePeriyoduAy, zaman: g.odemeZamani,
    vadeKurali: g.vadeKurali, vadeParametresi: g.vadeParametresi, kist: g.kistYontemi, bedelTuru: g.bedelTuru,
    kiraDonemleri: girdiKiraDonemleri(g),
    malikler: g.malikler.map((m) => ({ kisiId: String(m.kisiId), pay: m.pay, payda: m.payda, statu: kisiMap.get(String(m.kisiId))?.vergiStatusu ?? 'GMSI_GERCEK' })),
    oranlar: (st) => oranlar.get(st) ?? { stopaj: SIFIR, kdv: SIFIR },
    ufuk: ayEkle(enBuyukTarih(bugun, ilkSatir), 24),
    azamiSatir: 2400,
  })
  if (!sonuc.ok) return { ok: false, mesaj: sonuc.hata.mesaj }
  const ilgili: OnizlemeSatiri[] = sonuc.deger.filter((r) => karsilastir(r.bitis, ilkSatir) >= 0).slice(0, 24)
  return {
    ok: true,
    satirlar: ilgili.map((r) => ({
      baslangic: r.baslangic, bitis: r.bitis, vade: r.vade, tutar: r.tutar.toFixed(2),
      malikler: r.malikler.map((m) => ({
        kisiId: m.kisiId, ad: kisiMap.has(m.kisiId) ? kisiGorunenAd(kisiMap.get(m.kisiId)!) : m.kisiId,
        brut: m.brut.toFixed(2), kdv: m.kdv.toFixed(2), stopaj: m.stopaj.toFixed(2), net: m.net.toFixed(2),
      })),
    })),
  }
}

/** Yenileme zincirinde önceki sözleşmeyi yeni başlangıçtan bir gün önce kapatır. */
async function oncekiSozlesmeyiKapat(tx: Tx, oncekiId: number, yeniBaslangic: Tarih, baglam: IslemBaglami, bugun: Tarih): Promise<void> {
  const o = await tx.sozlesme.findUnique({ where: { id: oncekiId } })
  if (!o || (o.durum !== 'AKTIF' && o.durum !== 'UZADI')) return
  const sinir = gunEkle(yeniBaslangic, -1)
  // sozlesme_tarih_sirasi (bitis >= baslangic) ihlali ham veritabanı hatası yerine anlaşılır bir iş kuralı hatası olsun.
  if (karsilastir(sinir, tarihDb(o.baslangic)) < 0) {
    throw new IsKuraliHatasi('YENILEME', 'Yenileme sözleşmesi, önceki sözleşmenin başlangıcından sonraki bir tarihte başlamalı.')
  }
  const eskiBitis = tarihDbOpt(o.bitis)
  const yeniBitis = eskiBitis === null ? sinir : enKucukTarih(eskiBitis, sinir)
  await tx.sozlesme.update({ where: { id: oncekiId }, data: { bitis: dbTarih(yeniBitis), version: { increment: 1 } } })
  await taksitPlaniniGuncelle(tx, oncekiId, bugun)
  await tx.sozlesme.update({ where: { id: oncekiId }, data: { durum: 'SONA_ERDI', version: { increment: 1 } } })
  await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: oncekiId, eylem: 'YENILEME_ILE_SONA_ERDI', once: { bitis: eskiBitis, durum: o.durum }, sonra: { bitis: yeniBitis, durum: 'SONA_ERDI' } })
}

export async function sozlesmeAktiflestir(id: number, version: number, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const s = await tx.sozlesme.findUnique({ where: { id }, include: { malikler: { include: { kisi: true, iban: true } } } })
    if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
    if (s.durum !== 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Yalnızca taslak sözleşmeler aktifleştirilebilir.')
    const bas = tarihDb(s.baslangic)
    const gecerli = s.malikler.filter((m) => icindeMi(bas, { baslangic: tarihDb(m.gecerlilikBaslangic), bitis: tarihDbOpt(m.gecerlilikBitis) }))
    if (!hisseToplamiBirMi(gecerli)) throw new IsKuraliHatasi('HISSE', 'Başlangıç tarihinde malik hisselerinin toplamı 1 değil.')
    for (const m of gecerli) {
      const odemeKisisi = m.vekilKisiId ?? m.kisiId
      if (!m.iban || !m.iban.aktif || m.iban.kisiId !== odemeKisisi) {
        throw new IsKuraliHatasi('IBAN', `${kisiGorunenAd(m.kisi)} için ödemenin yapılacağı kişiye ait aktif bir IBAN seçin.`)
      }
    }
    const r = await tx.sozlesme.updateMany({ where: { id, version, durum: 'TASLAK' }, data: { durum: 'AKTIF', version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    const gecis = tarihDbOpt(s.gecisTarihi)
    await tx.kiraDonemi.create({
      data: {
        sozlesmeId: id, baslangic: s.baslangic, bitis: gecis === null ? null : dbTarih(gunEkle(gecis, -1)),
        bedelTutari: s.bedelTutari, bedelTabani: s.bedelTabani, kaynak: 'ILK', olusturanId: baglam.kullaniciId,
      },
    })
    if (gecis !== null && s.gecisBedeli !== null) {
      await tx.kiraDonemi.create({
        data: {
          sozlesmeId: id, baslangic: dbTarih(gecis), bitis: null, bedelTutari: s.gecisBedeli, bedelTabani: s.bedelTabani,
          kaynak: 'ELLE', aciklama: 'Sisteme geçişte girilen güncel kira bedeli', olusturanId: baglam.kullaniciId,
        },
      })
    }
    if (s.oncekiSozlesmeId !== null) await oncekiSozlesmeyiKapat(tx, s.oncekiSozlesmeId, bas, baglam, bugun)
    await taksitPlaniniGuncelle(tx, id, bugun)
    await denetimKaydi(tx, baglam, { varlik: 'sozlesme', varlikId: id, eylem: 'AKTIFLESTIR' })
  }, { timeout: 60_000 })
}
