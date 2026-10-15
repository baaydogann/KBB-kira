import { createHmac, randomBytes } from 'node:crypto'
import { prisma, type Tx } from '../db'
import { ortam } from '../env'

export const OTURUM_SURESI_MS = 8 * 60 * 60 * 1000
export const OTURUM_MUTLAK_MS = 24 * 60 * 60 * 1000

export interface OturumKullanicisi {
  id: number
  kullaniciAdi: string
  adSoyad: string
  sifreDegismeli: boolean
  oturumId: number
}

/** Token saklanmaz; SESSION_SECRET ile HMAC özeti saklanır (DB sızıntısı tek başına yetmez). */
export function tokenOzeti(token: string): string {
  return createHmac('sha256', ortam().SESSION_SECRET).update(token).digest('hex')
}

export async function oturumOlustur(g: { kullaniciId: number; ip: string | null; userAgent: string | null }): Promise<{ token: string; bitis: Date }> {
  const token = randomBytes(32).toString('base64url')
  const simdi = Date.now()
  const bitis = new Date(simdi + OTURUM_SURESI_MS)
  await prisma.oturum.create({
    data: {
      kullaniciId: g.kullaniciId, tokenHash: tokenOzeti(token), bitis,
      mutlakBitis: new Date(simdi + OTURUM_MUTLAK_MS), ip: g.ip, userAgent: g.userAgent?.slice(0, 500) ?? null,
    },
  })
  return { token, bitis }
}

export async function oturumDogrula(token: string, simdi: Date = new Date()): Promise<OturumKullanicisi | null> {
  if (!token) return null
  // sifreHash her istekte belleğe yüklenmesin diye kullanıcı alanları açıkça seçilir.
  const o = await prisma.oturum.findUnique({
    where: { tokenHash: tokenOzeti(token) },
    include: { kullanici: { select: { id: true, kullaniciAdi: true, adSoyad: true, aktif: true, sifreDegismeli: true } } },
  })
  if (!o || o.iptalZamani || o.bitis <= simdi || o.mutlakBitis <= simdi || !o.kullanici.aktif) return null
  // Kayan süre: yazma maliyeti için yalnızca sürenin çeyreği tükenince uzatılır.
  if (o.bitis.getTime() - simdi.getTime() < OTURUM_SURESI_MS * 0.75) {
    const yeni = Math.min(simdi.getTime() + OTURUM_SURESI_MS, o.mutlakBitis.getTime())
    await prisma.oturum.update({ where: { id: o.id }, data: { bitis: new Date(yeni) } })
  }
  return {
    id: o.kullanici.id, kullaniciAdi: o.kullanici.kullaniciAdi, adSoyad: o.kullanici.adSoyad,
    sifreDegismeli: o.kullanici.sifreDegismeli, oturumId: o.id,
  }
}

export async function oturumKapat(token: string): Promise<void> {
  await prisma.oturum.updateMany({ where: { tokenHash: tokenOzeti(token), iptalZamani: null }, data: { iptalZamani: new Date() } })
}

export async function kullaniciOturumlariniKapat(kullaniciId: number, haricOturumId?: number, db: Tx = prisma): Promise<void> {
  await db.oturum.updateMany({
    where: { kullaniciId, iptalZamani: null, ...(haricOturumId === undefined ? {} : { id: { not: haricOturumId } }) },
    data: { iptalZamani: new Date() },
  })
}
