import type { PrismaClient } from '@/generated/prisma'
import { PARAMETRELER } from './parametreler'
import { TATILLER } from './tatiller'
import { TUFE12 } from './tufe12'

const gun = (s: string) => new Date(`${s}T00:00:00.000Z`)

/** İdempotent: mevcut kayıtlar (yönetici düzenlemeleri) ezilmez. */
export async function seedVerisiniYukle(db: PrismaClient): Promise<void> {
  for (const p of PARAMETRELER) {
    await db.parametre.upsert({
      where: { anahtar_yururlukBaslangic: { anahtar: p.anahtar, yururlukBaslangic: gun(p.yururlukBaslangic) } },
      update: {},
      create: {
        anahtar: p.anahtar, deger: p.deger, yururlukBaslangic: gun(p.yururlukBaslangic),
        yururlukBitis: p.yururlukBitis ? gun(p.yururlukBitis) : null,
        mevzuatDayanagi: p.mevzuatDayanagi ?? null, aciklama: p.aciklama ?? null,
      },
    })
  }
  for (const t of TATILLER) {
    await db.tatil.upsert({ where: { tarih: gun(t.tarih) }, update: {}, create: { tarih: gun(t.tarih), ad: t.ad, yarimGun: t.yarimGun ?? false } })
  }
  for (const [anahtar, deger] of Object.entries(TUFE12)) {
    const [yil, ay] = anahtar.split('-').map(Number) as [number, number]
    await db.endeksDegeri.upsert({
      where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil, ay } },
      update: {},
      create: { seri: 'TUFE_12AY_ORT', yil, ay, deger, kaynak: 'ELLE', onayDurumu: 'ONAYLANDI', onayZamani: new Date() },
    })
  }
}
