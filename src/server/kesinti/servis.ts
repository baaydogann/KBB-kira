import type { BorcSorgu } from '@/generated/prisma'
import { SIFIR, type Para } from '@/core/para'
import { bugunIstanbul, gunEkle, karsilastir, sonrakiIsGunu, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, paraDb, paraYaz, tarihDb } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { parametreTamsayi } from '../parametre/servis'
import { tatilKumesi } from '../tatil/servis'
import type { BorcSorguGirdisi, HacizGirdisi } from './sema'

export type { BorcSorguGirdisi, HacizGirdisi }

/** Kesinleşmiş (geri alınması paket iptali gerektiren) paket durumları. */
export const KESINLESMIS_PAKET_DURUMLARI = ['KESINLESTI', 'ODEME_EMRINDE', 'ODENDI'] as const

async function kisiVarMi(db: Tx, kisiId: number): Promise<void> {
  if (!(await db.kisi.findUnique({ where: { id: kisiId }, select: { id: true } }))) throw new BulunamadiHatasi('Kişi bulunamadı.')
}

/**
 * 6183 md. 22/A borç sorgusu. Geçerlilik bitişi sorgu tarihi + `SURE_22A_GECERLILIK_GUN`; yasal son gün tatile ya da hafta sonuna
 * denk gelirse sonraki iş gününe kayar (spec §7.2). Bağlanan belge kişinin BORC_YAZISI belgesi olmalıdır.
 * Denetim satırına vergi dairesi ve belge no gibi serbest metinler yazılmaz.
 */
export async function borcSorguEkle(g: BorcSorguGirdisi, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<number> {
  if (karsilastir(g.sorguTarihi, bugun) > 0) throw new IsKuraliHatasi('TARIH', 'Sorgu tarihi bugünden sonra olamaz.', 'sorguTarihi')
  if (g.borcVar && (g.borcTutari === null || !g.borcTutari.greaterThan(0))) {
    throw new IsKuraliHatasi('TUTAR', 'Borç varsa tutarını girin.', 'borcTutari')
  }
  const borcTutari = g.borcVar ? g.borcTutari! : SIFIR
  return prisma.$transaction(async (tx) => {
    await kisiVarMi(tx, g.kisiId)
    if (g.belgeId !== null) {
      const b = await tx.belge.findUnique({ where: { id: g.belgeId }, select: { sahipTur: true, sahipId: true, belgeTuru: true } })
      if (!b || b.sahipTur !== 'kisi' || b.sahipId !== g.kisiId || b.belgeTuru !== 'BORC_YAZISI') {
        throw new IsKuraliHatasi('BELGE', "Belge bu kişinin borç yazısı (22/A) olmalı.", 'belgeId')
      }
    }
    const ham = gunEkle(g.sorguTarihi, await parametreTamsayi('SURE_22A_GECERLILIK_GUN', g.sorguTarihi, tx))
    const gecerlilikBitis = sonrakiIsGunu(ham, await tatilKumesi(ham, gunEkle(ham, 30), tx))
    const s = await tx.borcSorgu.create({
      data: {
        kisiId: g.kisiId, sorguTarihi: dbTarih(g.sorguTarihi), gecerlilikBitis: dbTarih(gecerlilikBitis), borcVar: g.borcVar,
        borcTutari: paraYaz(borcTutari), vergiDairesi: g.vergiDairesi, belgeNo: g.belgeNo, belgeId: g.belgeId, olusturanId: baglam.kullaniciId,
      },
    })
    await denetimKaydi(tx, baglam, {
      varlik: 'borc_sorgu', varlikId: s.id, eylem: 'OLUSTUR',
      sonra: { kisiId: g.kisiId, sorguTarihi: g.sorguTarihi, gecerlilikBitis, borcVar: g.borcVar, borcTutari: paraYaz(borcTutari), belgeId: g.belgeId },
    })
    return s.id
  })
}

/** `gun` için geçerli sorgu: sorguTarihi ≤ gun ≤ gecerlilikBitis; en son sorgu, eşitse en son eklenen. */
export async function gecerliSorgu(db: Tx, kisiId: number, gun: Tarih): Promise<BorcSorgu | null> {
  const d = dbTarih(gun)
  return db.borcSorgu.findFirst({
    where: { kisiId, sorguTarihi: { lte: d }, gecerlilikBitis: { gte: d } },
    orderBy: [{ sorguTarihi: 'desc' }, { id: 'desc' }],
  })
}

/** Kesinleşmiş paketlerdeki 22/A kesinti toplamı (sorgu kimliği → tutar); `haricPaketId` sayılmaz. */
export async function sorguKullanimi(db: Tx, borcSorguIdleri: readonly number[], haricPaketId?: number): Promise<Map<number, Para>> {
  if (borcSorguIdleri.length === 0) return new Map()
  const gruplar = await db.dagilimKesinti.groupBy({
    by: ['borcSorguId'],
    where: {
      tur: 'KESINTI_22A', borcSorguId: { in: [...borcSorguIdleri] }, paket: { durum: { in: [...KESINLESMIS_PAKET_DURUMLARI] } },
      ...(haricPaketId === undefined ? {} : { paketId: { not: haricPaketId } }),
    },
    _sum: { tutar: true },
  })
  return new Map(gruplar.map((x) => [x.borcSorguId!, x._sum.tutar === null ? SIFIR : paraDb(x._sum.tutar)]))
}

interface PaketJsonAlanlari { hesapParmakIzi: unknown; onKontrol: unknown }

/** Paket JSON alanlarında (parmak izi ve 22/A alıcıları) geçen sorgu kimlikleri. */
function jsondakiSorgular(p: PaketJsonAlanlari): string[] {
  const iz = p.hesapParmakIzi as { sorgular?: unknown } | null
  const ok = p.onKontrol as { alicilar22a?: unknown } | null
  const izdekiler = Array.isArray(iz?.sorgular) ? iz.sorgular.filter((x): x is string => typeof x === 'string') : []
  const alicidakiler = Array.isArray(ok?.alicilar22a)
    ? ok.alicilar22a.flatMap((a: unknown) => {
      const id = (a as { borcSorguId?: unknown } | null)?.borcSorguId
      return typeof id === 'string' ? [id] : []
    })
    : []
  return [...izdekiler, ...alicidakiler]
}

/**
 * Bir ödeme paketinde kullanılmış sorgular: kesinti satırına bağlı olanlar (iptal edilen paketler dahil) ve iptal edilmemiş bir paketin
 * hesabında değerlendirilmiş ya da 22/A alıcısı olarak geçenler (borç yok sorgusu kesinti satırı taşımaz ama ödeme emri ona dayanır).
 */
async function kullanilanSorgular(db: Tx, adaylar: readonly number[]): Promise<Set<number>> {
  if (adaylar.length === 0) return new Set()
  const kesintili = await db.dagilimKesinti.findMany({ where: { borcSorguId: { in: [...adaylar] } }, select: { borcSorguId: true }, distinct: ['borcSorguId'] })
  const paketler = await db.odemePaketi.findMany({ where: { durum: { not: 'IPTAL' } }, select: { hesapParmakIzi: true, onKontrol: true } })
  const aday = new Set(adaylar.map(String))
  const sonuc = new Set(kesintili.map((k) => k.borcSorguId!))
  for (const p of paketler) for (const id of jsondakiSorgular(p)) if (aday.has(id)) sonuc.add(Number(id))
  return sonuc
}

export async function borcSorguSil(id: number, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const s = await tx.borcSorgu.findUnique({ where: { id } })
    if (!s) throw new BulunamadiHatasi('Borç sorgusu bulunamadı.')
    if ((await kullanilanSorgular(tx, [id])).has(id)) throw new IsKuraliHatasi('KULLANILDI', 'Bu sorgu bir ödeme paketinde kullanıldı; silinemez.')
    await tx.borcSorgu.delete({ where: { id } })
    await denetimKaydi(tx, baglam, {
      varlik: 'borc_sorgu', varlikId: id, eylem: 'SIL',
      once: { kisiId: s.kisiId, sorguTarihi: tarihDb(s.sorguTarihi), borcVar: s.borcVar, borcTutari: paraYaz(paraDb(s.borcTutari)) },
    })
  })
}

export async function hacizEkle(g: HacizGirdisi, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<number> {
  if (karsilastir(g.tebligTarihi, bugun) > 0) throw new IsKuraliHatasi('TARIH', 'Tebliğ tarihi bugünden sonra olamaz.', 'tebligTarihi')
  if (!g.toplamTutar.greaterThan(0)) throw new IsKuraliHatasi('TUTAR', 'Haciz tutarı sıfırdan büyük olmalı.', 'toplamTutar')
  return prisma.$transaction(async (tx) => {
    await kisiVarMi(tx, g.kisiId)
    const tutar = paraYaz(g.toplamTutar)
    const x = await tx.haciz.create({
      data: { kisiId: g.kisiId, alacakli: g.alacakli, dosyaNo: g.dosyaNo, tebligTarihi: dbTarih(g.tebligTarihi), toplamTutar: tutar, kalanTutar: tutar },
    })
    await denetimKaydi(tx, baglam, {
      varlik: 'haciz', varlikId: x.id, eylem: 'OLUSTUR',
      sonra: { kisiId: g.kisiId, tebligTarihi: g.tebligTarihi, toplamTutar: tutar },
    })
    return x.id
  })
}

/** Kapanış nedeni serbest metindir (kişi adı içerebilir); denetim satırına yalnız girildiği yazılır. */
export async function hacizKapat(id: number, version: number, neden: string, baglam: IslemBaglami): Promise<void> {
  const metin = neden.trim()
  if (metin.length === 0) throw new IsKuraliHatasi('NEDEN', 'Kapanış nedenini yazın.', 'neden')
  if (metin.length > 500) throw new IsKuraliHatasi('NEDEN', 'Kapanış nedeni en çok 500 karakter olabilir.', 'neden')
  await prisma.$transaction(async (tx) => {
    const r = await tx.haciz.updateMany({
      where: { id, version, durum: 'AKTIF' }, data: { durum: 'KAPANDI', kapanisNedeni: metin, version: { increment: 1 } },
    })
    if (r.count === 0) {
      const x = await tx.haciz.findUnique({ where: { id }, select: { durum: true } })
      if (!x) throw new BulunamadiHatasi('Haciz bulunamadı.')
      if (x.durum === 'KAPANDI') throw new IsKuraliHatasi('DURUM', 'Haciz zaten kapalı.')
      throw new CakismaHatasi()
    }
    await denetimKaydi(tx, baglam, { varlik: 'haciz', varlikId: id, eylem: 'KAPAT', sonra: { durum: 'KAPANDI', nedenGirildi: true } })
  })
}

export interface SorguGorunumu {
  id: number
  sorguTarihi: Tarih
  gecerlilikBitis: Tarih
  gecerli: boolean
  borcVar: boolean
  borcTutari: string
  vergiDairesi: string | null
  belgeNo: string | null
  belgeId: number | null
  kullanildi: boolean
}

export interface HacizGorunumu {
  id: number
  version: number
  alacakli: string
  dosyaNo: string
  tebligTarihi: Tarih
  toplamTutar: string
  kalanTutar: string
  durum: 'AKTIF' | 'KAPANDI'
  kapanisNedeni: string | null
}

/** Kişi sayfası için: sorgular en yeni önce; hacizler tebliğ sırasıyla. */
export async function kisiKesintileri(kisiId: number, bugun: Tarih = bugunIstanbul()): Promise<{ sorgular: SorguGorunumu[]; hacizler: HacizGorunumu[] }> {
  const [sorgular, hacizler] = await Promise.all([
    prisma.borcSorgu.findMany({ where: { kisiId }, orderBy: [{ sorguTarihi: 'desc' }, { id: 'desc' }] }),
    prisma.haciz.findMany({ where: { kisiId }, orderBy: [{ tebligTarihi: 'asc' }, { id: 'asc' }] }),
  ])
  const kullanilan = await kullanilanSorgular(prisma, sorgular.map((s) => s.id))
  return {
    sorgular: sorgular.map((s) => {
      const bas = tarihDb(s.sorguTarihi)
      const bit = tarihDb(s.gecerlilikBitis)
      return {
        id: s.id, sorguTarihi: bas, gecerlilikBitis: bit, gecerli: karsilastir(bas, bugun) <= 0 && karsilastir(bugun, bit) <= 0,
        borcVar: s.borcVar, borcTutari: paraYaz(paraDb(s.borcTutari)), vergiDairesi: s.vergiDairesi, belgeNo: s.belgeNo, belgeId: s.belgeId,
        kullanildi: kullanilan.has(s.id),
      }
    }),
    hacizler: hacizler.map((x) => ({
      id: x.id, version: x.version, alacakli: x.alacakli, dosyaNo: x.dosyaNo, tebligTarihi: tarihDb(x.tebligTarihi),
      toplamTutar: paraYaz(paraDb(x.toplamTutar)), kalanTutar: paraYaz(paraDb(x.kalanTutar)), durum: x.durum, kapanisNedeni: x.kapanisNedeni,
    })),
  }
}
