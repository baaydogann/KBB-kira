import type { IslemBaglami } from './baglam'
import type { Tx } from './db'
import { jsonYaz } from './donustur'

export async function denetimKaydi(
  tx: Tx,
  baglam: IslemBaglami,
  g: { varlik: string; varlikId: string | number; eylem: string; once?: unknown; sonra?: unknown },
): Promise<void> {
  await tx.olayGunlugu.create({
    data: {
      kullaniciId: baglam.kullaniciId,
      ip: baglam.ip,
      varlik: g.varlik,
      varlikId: String(g.varlikId),
      eylem: g.eylem,
      once: g.once === undefined ? undefined : jsonYaz(g.once),
      sonra: g.sonra === undefined ? undefined : jsonYaz(g.sonra),
    },
  })
}
