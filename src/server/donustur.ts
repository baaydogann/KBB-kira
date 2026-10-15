import type { Prisma } from '@/generated/prisma'
import { para, type Para } from '@/core/para'
import { dateToTarih, tarihToDate, type Tarih } from '@/core/tarih'

export const tarihDb = (d: Date): Tarih => dateToTarih(d)
export const tarihDbOpt = (d: Date | null): Tarih | null => (d === null ? null : dateToTarih(d))
export const dbTarih = (t: Tarih): Date => tarihToDate(t)
export const dbTarihOpt = (t: Tarih | null): Date | null => (t === null ? null : tarihToDate(t))
export const paraDb = (x: { toString(): string }): Para => para(x.toString())
export const paraDbOpt = (x: { toString(): string } | null): Para | null => (x === null ? null : para(x.toString()))
export const paraYaz = (p: Para): string => p.toFixed(2)
export const oranYaz = (p: Para): string => p.toFixed(4)

export function jsonYaz(x: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(x, (_anahtar, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
}
