import { birlestir, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, tarihDb } from '../donustur'
import { BulunamadiHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'

/** İş günü hesabında kullanılan tam gün tatiller (yarım gün arifeler iş günü sayılır). */
export async function tatilKumesi(bas: Tarih, bit: Tarih, db: Tx = prisma): Promise<Set<string>> {
  const kayitlar = await db.tatil.findMany({ where: { tarih: { gte: dbTarih(bas), lte: dbTarih(bit) }, yarimGun: false } })
  return new Set(kayitlar.map((k) => tarihDb(k.tarih)))
}

export async function tatilListesi(yil: number) {
  const kayitlar = await prisma.tatil.findMany({
    where: { tarih: { gte: dbTarih(birlestir(yil, 1, 1)), lte: dbTarih(birlestir(yil, 12, 31)) } },
    orderBy: { tarih: 'asc' },
  })
  return kayitlar.map((k) => ({ id: k.id, tarih: tarihDb(k.tarih), ad: k.ad, yarimGun: k.yarimGun }))
}

export async function tatilEkle(g: { tarih: Tarih; ad: string; yarimGun: boolean }, baglam: IslemBaglami): Promise<number> {
  if (g.ad.trim().length < 2) throw new IsKuraliHatasi('AD', 'Tatil adını girin.', 'ad')
  try {
    return await prisma.$transaction(async (tx) => {
      const k = await tx.tatil.create({ data: { tarih: dbTarih(g.tarih), ad: g.ad.trim(), yarimGun: g.yarimGun } })
      await denetimKaydi(tx, baglam, { varlik: 'tatil', varlikId: k.id, eylem: 'EKLE', sonra: k })
      return k.id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('TARIH', 'Bu tarih için zaten tatil kaydı var.', 'tarih')
    throw e
  }
}

export async function tatilSil(id: number, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const k = await tx.tatil.findUnique({ where: { id } })
    if (!k) throw new BulunamadiHatasi()
    await tx.tatil.delete({ where: { id } })
    await denetimKaydi(tx, baglam, { varlik: 'tatil', varlikId: id, eylem: 'SIL', once: k })
  })
}
