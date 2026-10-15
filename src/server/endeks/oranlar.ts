import type { OnayliOranlar, OranSerisi } from '@/core/hesap/artis'
import type { Para } from '@/core/para'
import { ayAnahtari, type Ay } from '@/core/tarih'
import { prisma, type Tx } from '../db'
import { paraDb } from '../donustur'

/** Yalnızca ONAYLANDI endeks oranları; hesaplarda tek kaynak budur. */
export async function onayliOranlariYukle(db: Tx = prisma): Promise<OnayliOranlar & { sonOnayliTufe12: Ay | null }> {
  const satirlar = await db.endeksDegeri.findMany({ where: { onayDurumu: 'ONAYLANDI' } })
  const tablo = new Map<string, Para>()
  let son: Ay | null = null
  for (const r of satirlar) {
    tablo.set(`${r.seri}:${ayAnahtari({ yil: r.yil, ay: r.ay })}`, paraDb(r.deger))
    if (r.seri === 'TUFE_12AY_ORT' && (son === null || r.yil * 12 + r.ay > son.yil * 12 + son.ay)) son = { yil: r.yil, ay: r.ay }
  }
  return {
    oran: (seri: OranSerisi, ay: Ay) => tablo.get(`${seri}:${ayAnahtari(ay)}`) ?? null,
    sonOnayliTufe12: son,
  }
}
