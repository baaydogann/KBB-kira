import { Prisma } from '@/generated/prisma'

export class IsKuraliHatasi extends Error {
  constructor(public readonly kod: string, mesaj: string, public readonly alan?: string) {
    super(mesaj)
    this.name = 'IsKuraliHatasi'
  }
}

export class CakismaHatasi extends Error {
  constructor(mesaj = 'Kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.') {
    super(mesaj)
    this.name = 'CakismaHatasi'
  }
}

export class BulunamadiHatasi extends Error {
  constructor(mesaj = 'Kayıt bulunamadı.') {
    super(mesaj)
    this.name = 'BulunamadiHatasi'
  }
}

export function benzersizIhlaliMi(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/** Veritabanı kısıt adına göre (CHECK, EXCLUDE, trigger mesajı) ihlal tespiti. */
export function kisitIhlaliMi(e: unknown, kisitAdi: string): boolean {
  return e instanceof Error && e.message.includes(kisitAdi)
}
