import { PrismaClient } from '@/generated/prisma'

const kuresel = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = kuresel.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') kuresel.prisma = prisma

/** Etkileşimli transaction içindeki istemci. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
