import { z } from 'zod'

/** `.env.example` içindeki değer: kopyalanıp üretimde bırakılırsa oturum ve takvim belirteci özetleri tahmin edilebilir olur. */
const ORNEK_SESSION_SECRET = 'bunu-en-az-32-karakterlik-rastgele-bir-degerle-degistirin'
/** Açık yer tutucu işaretleri ("değiştirin", "change me", "placeholder", "buraya yazın"). */
const YER_TUTUCU = /degistir|değiştir|change[-_ ]?me|placeholder|yer[-_ ]?tutucu|buraya[-_ ]?yaz/i

const sema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET en az 32 karakter olmalı'),
  EVDS_API_KEY: z.string().default(''),
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  BELGE_DIZINI: z.string().min(1).default('./var/belgeler'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((o, ctx) => {
  if (o.NODE_ENV === 'production' && (o.SESSION_SECRET === ORNEK_SESSION_SECRET || YER_TUTUCU.test(o.SESSION_SECRET))) {
    ctx.addIssue({
      code: 'custom', path: ['SESSION_SECRET'],
      message: 'Üretimde SESSION_SECRET örnek/yer tutucu bir değer olamaz; `openssl rand -base64 48` ile üretilmiş rastgele bir değer verin.',
    })
  }
})

export type Ortam = z.infer<typeof sema>

let onbellek: Ortam | null = null

/** Ortam değişkenlerini doğrular (önbelleksiz; `ortam()` bunu `process.env` ile bir kez çağırır). */
export function ortamiDogrula(kaynak: Readonly<Record<string, string | undefined>>): Ortam {
  return sema.parse(kaynak)
}

export function ortam(): Ortam {
  onbellek ??= ortamiDogrula(process.env)
  return onbellek
}
