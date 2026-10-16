import { z } from 'zod'
import { paraAyristir, type Para } from '@/core/para'
import { tarihAyristir, type Tarih } from '@/core/tarih'

const tarihAlani = z.string().trim().transform((v, ctx): Tarih => {
  const r = tarihAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const opsParaAlani = z.string().trim().nullish().transform((v, ctx): Para | null => {
  if (!v) return null
  const r = paraAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const paraAlani = opsParaAlani.refine((v): v is Para => v !== null && v.greaterThan(0), 'Sıfırdan büyük bir tutar girin.')
const opsMetin = (azami: number) => z.string().trim().max(azami).nullish().transform((v) => (v ? v : null))
const kimlik = z.number().int().positive()

export interface BorcSorguGirdisi {
  kisiId: number
  sorguTarihi: Tarih
  borcVar: boolean
  borcTutari: Para | null
  vergiDairesi: string | null
  belgeNo: string | null
  belgeId: number | null
}

/** Form alanları metin olarak gelir; borç tutarı borç yoksa yok sayılır (servis 0 yazar). */
export const borcSorguSemasi: z.ZodType<BorcSorguGirdisi, unknown> = z.object({
  kisiId: kimlik,
  sorguTarihi: tarihAlani,
  borcVar: z.boolean(),
  borcTutari: opsParaAlani,
  vergiDairesi: opsMetin(100),
  belgeNo: opsMetin(100),
  belgeId: kimlik.nullable(),
})

export interface HacizGirdisi { kisiId: number; alacakli: string; dosyaNo: string; tebligTarihi: Tarih; toplamTutar: Para }

export const hacizSemasi: z.ZodType<HacizGirdisi, unknown> = z.object({
  kisiId: kimlik,
  alacakli: z.string().trim().min(1, 'Kesintinin gönderileceği daireyi girin.').max(200),
  dosyaNo: z.string().trim().min(1, 'Dosya numarasını girin.').max(100),
  tebligTarihi: tarihAlani,
  toplamTutar: paraAlani,
})
