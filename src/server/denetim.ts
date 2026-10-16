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

/** Kişisel veri içeren çıktının indirilmesi (spec §16): yalnızca belge türü ve kayıt sayısı yazılır; kimlik, IBAN ya da ad yazılmaz. */
export async function disaAktarimKaydi(db: Tx, baglam: IslemBaglami, g: { varlik: string; varlikId: string | number; belge: string; kayitSayisi: number }): Promise<void> {
  await denetimKaydi(db, baglam, { varlik: g.varlik, varlikId: g.varlikId, eylem: 'DISA_AKTAR', sonra: { belge: g.belge, kayitSayisi: g.kayitSayisi } })
}
