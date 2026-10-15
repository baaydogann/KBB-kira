import { z } from 'zod'
import { tcknGecerliMi, vknGecerliMi } from '@/core/dogrulama'

const opsiyonel = z.string().trim().max(300).optional().transform((v) => (v ? v : null))

export const kisiSemasi = z.object({
  tip: z.enum(['GERCEK', 'TUZEL']),
  tckn: opsiyonel,
  vkn: opsiyonel,
  ad: opsiyonel,
  soyad: opsiyonel,
  unvan: opsiyonel,
  vergiDairesi: opsiyonel,
  vergiStatusu: z.enum(['GMSI_GERCEK', 'SERBEST_MESLEK', 'TICARI_AKTIF', 'BASIT_USUL', 'SIRKET', 'KOOPERATIF', 'VAKIF_DERNEK', 'KAMU']),
  telefon: opsiyonel,
  adres: opsiyonel,
}).superRefine((k, ctx) => {
  if (k.tip === 'GERCEK') {
    if (!k.tckn) ctx.addIssue({ code: 'custom', path: ['tckn'], message: 'Geçerli bir T.C. kimlik numarası girin.' })
    if (!k.ad) ctx.addIssue({ code: 'custom', path: ['ad'], message: 'Ad girin.' })
    if (!k.soyad) ctx.addIssue({ code: 'custom', path: ['soyad'], message: 'Soyad girin.' })
  } else {
    if (!k.vkn) ctx.addIssue({ code: 'custom', path: ['vkn'], message: 'Vergi kimlik numarası girin.' })
    if (!k.unvan) ctx.addIssue({ code: 'custom', path: ['unvan'], message: 'Unvan girin.' })
  }
  // Dolu geldiği her durumda (tüzel kişide de) kimlik numaraları doğrulanır; geçersiz değer sessizce saklanmaz.
  if (k.tckn && !tcknGecerliMi(k.tckn)) ctx.addIssue({ code: 'custom', path: ['tckn'], message: 'Geçerli bir T.C. kimlik numarası girin.' })
  if (k.vkn && !vknGecerliMi(k.vkn)) ctx.addIssue({ code: 'custom', path: ['vkn'], message: 'Geçerli bir vergi kimlik numarası girin.' })
})

export type KisiGirdisi = z.infer<typeof kisiSemasi>
