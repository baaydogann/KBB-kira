import type { IslemBaglami } from '../baglam'
import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { paraYaz } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import type { TasinmazGirdisi } from './sema'

function veri(g: TasinmazGirdisi) {
  return { ...g, m2: g.m2 === null ? null : paraYaz(g.m2) }
}

export async function tasinmazKaydet(g: TasinmazGirdisi, baglam: IslemBaglami, id?: number, version?: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    if (id === undefined) {
      const t = await tx.tasinmaz.create({ data: veri(g) })
      await denetimKaydi(tx, baglam, { varlik: 'tasinmaz', varlikId: t.id, eylem: 'OLUSTUR', sonra: t })
      return t.id
    }
    // Sürümsüz güncelleme iyimser kilidi sessizce düşürürdü.
    if (version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
    const once = await tx.tasinmaz.findUnique({ where: { id } })
    if (!once) throw new BulunamadiHatasi('Taşınmaz bulunamadı.')
    const r = await tx.tasinmaz.updateMany({ where: { id, version }, data: { ...veri(g), version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, { varlik: 'tasinmaz', varlikId: id, eylem: 'GUNCELLE', once, sonra: veri(g) })
    return id
  })
}

/** Arama: kısa ad, adres, ilçe veya "ada/parsel". */
export async function tasinmazListesi(arama?: string) {
  const q = arama?.trim()
  const adaParsel = q ? /^(\d+)\s*\/\s*(\d+)$/.exec(q) : null
  return prisma.tasinmaz.findMany({
    where: !q ? {} : adaParsel
      ? { ada: adaParsel[1], parsel: adaParsel[2] }
      : { OR: [{ kisaAd: { contains: q, mode: 'insensitive' } }, { adres: { contains: q, mode: 'insensitive' } }, { ilce: { contains: q, mode: 'insensitive' } }] },
    include: { kullananBirim: true },
    orderBy: { kisaAd: 'asc' },
    take: 200,
  })
}

export async function tasinmazGetir(id: number) {
  const t = await prisma.tasinmaz.findUnique({ where: { id }, include: { sozlesmeler: { orderBy: { baslangic: 'desc' } } } })
  if (!t) throw new BulunamadiHatasi('Taşınmaz bulunamadı.')
  return t
}
