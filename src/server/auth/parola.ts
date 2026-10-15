import { hash, verify } from '@node-rs/argon2'

export const ASGARI_SIFRE_UZUNLUGU = 12

// Algoritma kütüphane varsayılanına bırakılmaz: argon2id açıkça sabitlenir
// (@node-rs/argon2 Algorithm.Argon2id = 2; ambient `const enum` isolatedModules ile kullanılamaz).
// spec §16: 64 MiB, t=3, p=1.
const AYAR = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const

export async function sifreHashle(sifre: string): Promise<string> {
  if (!sifre.trim()) throw new Error('Şifre boş olamaz')
  return hash(sifre, AYAR)
}

export async function sifreDogrula(ozet: string, sifre: string): Promise<boolean> {
  if (!ozet || !sifre) return false
  try {
    return await verify(ozet, sifre)
  } catch (e) {
    console.error('Şifre doğrulama beklenmeyen hata verdi:', e)
    return false
  }
}
