import { ibanGecerliMi, ibanNormalize, maskele } from '@/core/dogrulama'
import type { VergiStatusu } from '@/core/tipler'
import { Prisma } from '@/generated/prisma'
import type { IslemBaglami } from '../baglam'
import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import type { KisiGirdisi } from './sema'

export function kisiGorunenAd(k: { tip: 'GERCEK' | 'TUZEL'; ad: string | null; soyad: string | null; unvan: string | null }): string {
  return k.tip === 'GERCEK' ? `${k.ad ?? ''} ${k.soyad ?? ''}`.trim() : (k.unvan ?? '')
}

/** Güncellemede değişip değişmediği denetim satırına yazılan (ama değeri yazılmayan) kişi alanları. */
const KISI_ALANLARI = ['tip', 'tckn', 'vkn', 'ad', 'soyad', 'unvan', 'vergiDairesi', 'vergiStatusu', 'telefon', 'adres'] as const

/**
 * Denetim satırı özeti (KVKK, spec §16): TCKN/VKN maskeli; ad, soyad, telefon ve adres değerleri satıra hiç yazılmaz.
 * Unvan ve vergi dairesi tüzel kişi/kurum bilgisidir, açık yazılır. Kişi `varlikId` ile bulunur, gerçek kişi
 * alanlarında ne değiştiği `degisenAlanlar`dan okunur.
 */
function denetimOzeti(k: { tip: string; tckn: string | null; vkn: string | null; unvan: string | null; vergiDairesi: string | null; vergiStatusu: string; statuTeyitli: boolean }) {
  return {
    tip: k.tip,
    vergiStatusu: k.vergiStatusu,
    statuTeyitli: k.statuTeyitli,
    tckn: k.tckn === null ? null : maskele(k.tckn),
    vkn: k.vkn === null ? null : maskele(k.vkn),
    unvan: k.unvan,
    vergiDairesi: k.vergiDairesi,
  }
}

/** P2002'nin hangi benzersiz alandan geldiği (`meta.target`: sütun listesi veya kısıt adı); bilinmiyorsa tckn. */
function ihlalAlani(e: unknown): 'tckn' | 'vkn' {
  const hedef = e instanceof Prisma.PrismaClientKnownRequestError ? e.meta?.target : undefined
  return String(hedef ?? '').includes('vkn') ? 'vkn' : 'tckn'
}

export async function kisiKaydet(g: KisiGirdisi, baglam: IslemBaglami, id?: number, version?: number): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (id === undefined) {
        const k = await tx.kisi.create({ data: g })
        await denetimKaydi(tx, baglam, { varlik: 'kisi', varlikId: k.id, eylem: 'OLUSTUR', sonra: denetimOzeti(k) })
        return k.id
      }
      // Sürümsüz güncelleme iyimser kilidi sessizce düşürürdü.
      if (version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
      const once = await tx.kisi.findUnique({ where: { id } })
      if (!once) throw new BulunamadiHatasi('Kişi bulunamadı.')
      const statuDegisti = once.vergiStatusu !== g.vergiStatusu
      const r = await tx.kisi.updateMany({
        where: { id, version },
        data: { ...g, ...(statuDegisti ? { statuTeyitli: false } : {}), version: { increment: 1 } },
      })
      if (r.count === 0) throw new CakismaHatasi()
      await denetimKaydi(tx, baglam, {
        varlik: 'kisi',
        varlikId: id,
        eylem: 'GUNCELLE',
        once: denetimOzeti(once),
        sonra: { ...denetimOzeti({ ...g, statuTeyitli: statuDegisti ? false : once.statuTeyitli }), degisenAlanlar: KISI_ALANLARI.filter((a) => once[a] !== g[a]) },
      })
      return id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) {
      const alan = ihlalAlani(e)
      throw new IsKuraliHatasi('KIMLIK', alan === 'vkn' ? 'Bu vergi kimlik numarasıyla kayıtlı bir kişi zaten var.' : 'Bu T.C. kimlik numarasıyla kayıtlı bir kişi zaten var.', alan)
    }
    throw e
  }
}

export async function kisiListesi(arama?: string) {
  const q = arama?.trim()
  return prisma.kisi.findMany({
    where: !q ? {} : {
      OR: [
        { ad: { contains: q, mode: 'insensitive' } }, { soyad: { contains: q, mode: 'insensitive' } },
        { unvan: { contains: q, mode: 'insensitive' } }, { tckn: q }, { vkn: q },
      ],
    },
    orderBy: [{ soyad: 'asc' }, { unvan: 'asc' }],
    take: 200,
  })
}

/** Tam eşleşmeyle TCKN/VKN'den kişi kimliği; arama kutusu kimlik numarasını URL'e yazmadan bu yolla bulur. */
export async function kisiKimlikIleBul(kimlik: string): Promise<number | null> {
  const k = await prisma.kisi.findFirst({ where: { OR: [{ tckn: kimlik }, { vkn: kimlik }] }, select: { id: true } })
  return k?.id ?? null
}

/**
 * Tam eşleşmeyle IBAN'dan kişi kimliği (genel arama kutusu, IBAN'ı URL'e yazmadan bu yolla bulur). Girdi normalleştirilir
 * (boşluksuz, büyük harf). Aynı IBAN birden çok kişide kayıtlıysa (ortak hesap) en küçük kişi kimliği döner.
 */
export async function kisiIbanIleBul(iban: string): Promise<number | null> {
  const i = await prisma.iban.findFirst({ where: { iban: ibanNormalize(iban) }, orderBy: { kisiId: 'asc' }, select: { kisiId: true } })
  return i?.kisiId ?? null
}

export async function kisiDetayi(id: number) {
  const k = await prisma.kisi.findUnique({
    where: { id },
    include: {
      ibanlar: { orderBy: { olusturmaZamani: 'asc' } },
      malikKayitlari: { include: { sozlesme: { include: { tasinmaz: true } } }, orderBy: { gecerlilikBaslangic: 'desc' } },
    },
  })
  if (!k) throw new BulunamadiHatasi('Kişi bulunamadı.')
  return k
}

export async function ibanEkle(kisiId: number, g: { iban: string; bankaAdi: string | null }, baglam: IslemBaglami): Promise<number> {
  const iban = ibanNormalize(g.iban)
  if (!ibanGecerliMi(iban)) throw new IsKuraliHatasi('IBAN', 'Geçerli bir TR IBAN girin (kontrol hanesi tutmuyor).', 'iban')
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await tx.kisi.findUnique({ where: { id: kisiId }, select: { id: true } }))) throw new BulunamadiHatasi('Kişi bulunamadı.')
      const i = await tx.iban.create({ data: { kisiId, iban, bankaAdi: g.bankaAdi } })
      await denetimKaydi(tx, baglam, { varlik: 'iban', varlikId: i.id, eylem: 'OLUSTUR', sonra: { kisiId, bankaAdi: g.bankaAdi, iban: maskele(iban) } })
      return i.id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('IBAN', 'Bu IBAN bu kişide zaten kayıtlı.', 'iban')
    throw e
  }
}

export async function ibanAktiflik(ibanId: number, aktif: boolean, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const once = await tx.iban.findUnique({ where: { id: ibanId } })
    if (!once) throw new BulunamadiHatasi('IBAN bulunamadı.')
    await tx.iban.update({ where: { id: ibanId }, data: { aktif } })
    const iban = maskele(once.iban)
    await denetimKaydi(tx, baglam, {
      varlik: 'iban', varlikId: ibanId, eylem: aktif ? 'AKTIFLESTIR' : 'PASIFLESTIR',
      once: { kisiId: once.kisiId, iban, aktif: once.aktif }, sonra: { kisiId: once.kisiId, iban, aktif },
    })
  })
}

/**
 * Mali müşavir teyidi, ekranda görülen sürüm ve statü üzerine verilir: kayıt arada değiştiyse (başka bir düzenleme,
 * statü değişimi) reddedilir; teyit görülmemiş bir statüye uygulanmaz.
 */
export async function statuTeyitEt(kisiId: number, teyitli: boolean, beklenen: { version: number; vergiStatusu: VergiStatusu }, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const r = await tx.kisi.updateMany({
      where: { id: kisiId, version: beklenen.version, vergiStatusu: beklenen.vergiStatusu },
      data: { statuTeyitli: teyitli, version: { increment: 1 } },
    })
    if (r.count === 0) {
      if (!(await tx.kisi.findUnique({ where: { id: kisiId }, select: { id: true } }))) throw new BulunamadiHatasi('Kişi bulunamadı.')
      throw new CakismaHatasi()
    }
    await denetimKaydi(tx, baglam, {
      varlik: 'kisi', varlikId: kisiId, eylem: teyitli ? 'STATU_TEYIT' : 'STATU_TEYIT_GERI_AL',
      sonra: { vergiStatusu: beklenen.vergiStatusu, statuTeyitli: teyitli },
    })
  })
}
