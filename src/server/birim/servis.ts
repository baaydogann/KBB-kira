import type { IslemBaglami } from '../baglam'
import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import type { BirimGirdisi } from './sema'

export async function birimKaydet(g: BirimGirdisi, baglam: IslemBaglami, id?: number, version?: number): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (id === undefined) {
        const b = await tx.birim.create({ data: g })
        await denetimKaydi(tx, baglam, { varlik: 'birim', varlikId: b.id, eylem: 'OLUSTUR', sonra: b })
        return b.id
      }
      // Sürümsüz güncelleme iyimser kilidi sessizce düşürürdü.
      if (version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
      const once = await tx.birim.findUnique({ where: { id } })
      if (!once) throw new BulunamadiHatasi('Birim bulunamadı.')
      const r = await tx.birim.updateMany({ where: { id, version }, data: { ...g, version: { increment: 1 } } })
      if (r.count === 0) throw new CakismaHatasi()
      await denetimKaydi(tx, baglam, { varlik: 'birim', varlikId: id, eylem: 'GUNCELLE', once, sonra: g })
      return id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('AD', 'Bu adla bir birim zaten var.', 'ad')
    throw e
  }
}

export async function birimListesi(sadeceAktif = false) {
  return prisma.birim.findMany({ where: sadeceAktif ? { aktif: true } : {}, orderBy: { ad: 'asc' } })
}
