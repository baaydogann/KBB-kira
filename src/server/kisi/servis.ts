import { ibanGecerliMi, ibanNormalize, maskele } from '@/core/dogrulama'
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
 * Denetim satırı özeti (KVKK, spec §16): TCKN/VKN maskeli, sınıflandırma alanları açık; ad, unvan, telefon ve adres
 * değerleri satıra hiç yazılmaz. Kişi `varlikId` ile bulunur, ne değiştiği `degisenAlanlar`dan okunur.
 */
function denetimOzeti(k: { tip: string; tckn: string | null; vkn: string | null; vergiStatusu: string; statuTeyitli: boolean }) {
  return {
    tip: k.tip,
    vergiStatusu: k.vergiStatusu,
    statuTeyitli: k.statuTeyitli,
    tckn: k.tckn === null ? null : maskele(k.tckn),
    vkn: k.vkn === null ? null : maskele(k.vkn),
  }
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
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('KIMLIK', 'Bu kimlik/vergi numarasıyla kayıtlı bir kişi zaten var.', 'tckn')
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
      await denetimKaydi(tx, baglam, { varlik: 'iban', varlikId: i.id, eylem: 'OLUSTUR', sonra: { kisiId, bankaAdi: g.bankaAdi } })
      return i.id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('IBAN', 'Bu IBAN bu kişide zaten kayıtlı.', 'iban')
    throw e
  }
}

export async function ibanAktiflik(ibanId: number, aktif: boolean, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await tx.iban.findUnique({ where: { id: ibanId }, select: { id: true } }))) throw new BulunamadiHatasi('IBAN bulunamadı.')
    await tx.iban.update({ where: { id: ibanId }, data: { aktif } })
    await denetimKaydi(tx, baglam, { varlik: 'iban', varlikId: ibanId, eylem: aktif ? 'AKTIFLESTIR' : 'PASIFLESTIR' })
  })
}

export async function statuTeyitEt(kisiId: number, teyitli: boolean, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await tx.kisi.findUnique({ where: { id: kisiId }, select: { id: true } }))) throw new BulunamadiHatasi('Kişi bulunamadı.')
    await tx.kisi.update({ where: { id: kisiId }, data: { statuTeyitli: teyitli, version: { increment: 1 } } })
    await denetimKaydi(tx, baglam, { varlik: 'kisi', varlikId: kisiId, eylem: teyitli ? 'STATU_TEYIT' : 'STATU_TEYIT_GERI_AL' })
  })
}
