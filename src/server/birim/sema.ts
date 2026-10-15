import { z } from 'zod'

const opsiyonel = z.string().trim().max(200).optional().transform((v) => (v ? v : null))

export const birimSemasi = z.object({
  ad: z.string().trim().min(2, 'Birim adını girin.').max(200),
  kurumsalKod: z.string().trim().regex(/^[\d.]+$/, 'Kurumsal kod yalnızca rakam ve nokta içerir.'),
  fonksiyonelKod: z.string().trim().regex(/^[\d.]+$/, 'Fonksiyonel kod yalnızca rakam ve nokta içerir.'),
  finansKodu: z.string().trim().regex(/^\d+$/).optional().default('5'),
  gerceklestirmeGorevlisi: opsiyonel,
  harcamaYetkilisi: opsiyonel,
})

export type BirimGirdisi = z.infer<typeof birimSemasi>
