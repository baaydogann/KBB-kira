import { z } from 'zod'
import { paraAyristir } from '@/core/para'

const opsiyonel = z.string().trim().max(500).optional().transform((v) => (v ? v : null))

/** PostgreSQL INTEGER üst sınırı; form kimlikleri bunun üstünde olamaz. */
const KIMLIK_UST_SINIR = 2_147_483_647
/** `m2` NUMERIC(12,2): en çok 10 tam basamak. */
const M2_UST_SINIR = '10000000000'

export const tasinmazSemasi = z.object({
  tur: z.enum(['BINA', 'ISYERI', 'ARSA', 'DEPO', 'KONUT']),
  kisaAd: z.string().trim().min(2, 'Kısa ad girin.').max(100),
  adres: z.string().trim().min(3, 'Adres girin.').max(500),
  il: z.string().trim().optional().transform((v) => v || 'Konya'),
  ilce: z.string().trim().min(2, 'İlçe girin.'),
  mahalle: opsiyonel,
  ada: opsiyonel,
  parsel: opsiyonel,
  bagimsizBolum: opsiyonel,
  tapuBilgisi: opsiyonel,
  m2: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null
    const r = paraAyristir(v)
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: 'Alanı 1.250,50 biçiminde girin.' })
      return z.NEVER
    }
    if (r.deger.lessThanOrEqualTo(0) || r.deger.greaterThanOrEqualTo(M2_UST_SINIR)) {
      ctx.addIssue({ code: 'custom', message: 'Alan sıfırdan büyük ve 10.000.000.000 m²’den küçük olmalı.' })
      return z.NEVER
    }
    return r.deger
  }),
  // Form kimliği ham Number(...) ile değil, katı ayrıştırmayla alınır; "1e3", "0x10", " 7 " kimlik sayılmaz.
  kullananBirimId: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null
    const n = /^\d+$/.test(v) ? Number(v) : Number.NaN
    if (!Number.isSafeInteger(n) || n < 1 || n > KIMLIK_UST_SINIR) {
      ctx.addIssue({ code: 'custom', message: 'Geçerli bir birim seçin.' })
      return z.NEVER
    }
    return n
  }),
  kullanimAmaci: z.enum(['HIZMET_BINASI', 'LOJMAN', 'DEPO', 'OTOPARK', 'SOSYAL_TESIS', 'DIGER']),
  notlar: opsiyonel,
})

export type TasinmazGirdisi = z.infer<typeof tasinmazSemasi>
