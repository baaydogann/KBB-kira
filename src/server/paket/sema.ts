import { z } from 'zod'
import { paraAyristir, type Para } from '@/core/para'
import { karsilastir, tarihAyristir, type Tarih } from '@/core/tarih'

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
  if (!r.ok || r.deger.isNegative()) {
    ctx.addIssue({ code: 'custom', message: r.ok ? 'Tutar negatif olamaz.' : r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

export interface PaketGirdisi { birimId: number; ad: string; vadeBaslangic: Tarih; vadeBitis: Tarih; kalanOdenek: Para | null }

export const paketGirdisiSemasi: z.ZodType<PaketGirdisi, unknown> = z.object({
  birimId: z.number().int().positive(),
  ad: z.string().trim().min(1, 'Paket adını girin.').max(120),
  vadeBaslangic: tarihAlani,
  vadeBitis: tarihAlani,
  kalanOdenek: opsPara,
}).superRefine((p, ctx) => {
  if (karsilastir(p.vadeBitis, p.vadeBaslangic) < 0) ctx.addIssue({ code: 'custom', path: ['vadeBitis'], message: 'Vade bitişi başlangıçtan önce olamaz.' })
})

export interface FaturaGirdisi { taksitId: number; kisiId: number; faturaNo: string; faturaTarihi: Tarih }

export const faturaGirdisiSemasi: z.ZodType<FaturaGirdisi, unknown> = z.object({
  taksitId: z.number().int().positive(),
  kisiId: z.number().int().positive(),
  faturaNo: z.string().trim().min(1, 'Fatura numarasını girin.').max(50),
  faturaTarihi: tarihAlani,
})
