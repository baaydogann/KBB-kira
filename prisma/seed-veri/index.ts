import type { PrismaClient } from '@/generated/prisma'
import { PARAMETRELER } from './parametreler'
import { TATILLER } from './tatiller'
import { TUFE12 } from './tufe12'

const gun = (s: string) => new Date(`${s}T00:00:00.000Z`)

/**
 * İdempotent, "yoksa oluştur": mevcut kayıtlar (yönetici düzenlemeleri, onaylanmış endeksler) ezilmez, onaylı değer onay beklemeye dönmez.
 *
 * TÜFE12 değerleri varsayılan olarak onay bekleyen (`BEKLIYOR`, kaynak ELLE, EVDS değeri yok) yüklenir: değerlerin bir kısmı endeks
 * düzeylerinden yeniden hesaplanmıştır; kullanıcı TÜİK bülteniyle karşılaştırıp onaylamadan hiçbir hesapta kullanılmaz (spec §8) ve
 * H4 hatırlatmasıyla listelenir. `tufeOnayli` yalnızca testler ve e2e kurulumu içindir: değerleri onaylı yükler.
 */
export async function seedVerisiniYukle(db: PrismaClient, secenek: { tufeOnayli?: boolean } = {}): Promise<void> {
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
      create: {
        seri: 'TUFE_12AY_ORT', yil, ay, deger, kaynak: 'ELLE', evdsDegeri: null,
        ...(secenek.tufeOnayli === true ? { onayDurumu: 'ONAYLANDI' as const, onayZamani: new Date() } : { onayDurumu: 'BEKLIYOR' as const }),
      },
    })
  }
}
