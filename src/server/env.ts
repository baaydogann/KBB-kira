import { z } from 'zod'

const sema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET en az 32 karakter olmalı'),
  EVDS_API_KEY: z.string().default(''),
  APP_URL: z.string().min(1).default('http://localhost:3000'),
  BELGE_DIZINI: z.string().min(1).default('./var/belgeler'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Ortam = z.infer<typeof sema>

let onbellek: Ortam | null = null

export function ortam(): Ortam {
  onbellek ??= sema.parse(process.env)
  return onbellek
}
