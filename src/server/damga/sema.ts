import { z } from 'zod'
import { paraAyristir, type Para } from '@/core/para'
import { tarihAyristir, type Tarih } from '@/core/tarih'
import type { DamgaKaydiGirdisi } from './servis'

const tarihAlani = z.string().trim().transform((v, ctx): Tarih => {
  const r = tarihAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const opsPara = z.string().trim().nullish().transform((v, ctx): Para | null => {
  if (!v) return null
  const r = paraAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

/** Damga sekmesindeki ekleme formu; ILK olayında matrah boş bırakılır (otomatik hesaplanır). */
export const damgaKaydiSemasi: z.ZodType<DamgaKaydiGirdisi, unknown> = z.object({
  sozlesmeId: z.number().int().positive(),
  olay: z.enum(['ILK', 'YAZILI_ARTIS', 'YAZILI_UZATMA']),
  olayTarihi: tarihAlani,
  matrah: opsPara,
  tahsil: z.enum(['ISTIHKAKTAN', 'MALIK_BEYAN']),
})
