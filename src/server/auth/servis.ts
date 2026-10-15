import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { hizSinirlayici } from './hiz-sinir'
import { kullaniciOturumlariniKapat, oturumOlustur } from './oturum'
import { ASGARI_SIFRE_UZUNLUGU, sifreDogrula, sifreHashle } from './parola'

// Bu dosya 'use server' TAŞIMAZ: export edilen her fonksiyon aksi halde oturumsuz
// çağrılabilen bir HTTP uç noktası olurdu. Form action'ları app katmanında.

export type GirisSonucu =
  | { ok: true; kullaniciId: number; token: string; bitis: Date; sifreDegismeli: boolean }
  | { ok: false; neden: 'GECERSIZ' | 'KILITLI' | 'HIZ_SINIRI'; kilitBitis?: Date }

const ipSinir = hizSinirlayici(20, 60_000)
const KILIT_ESIGI = 5
const KILIT_MS = 15 * 60_000
let sahteOzet: Promise<string> | null = null

export async function girisYap(
  g: { kullaniciAdi: string; sifre: string; ip: string | null; userAgent: string | null },
  simdi: Date = new Date(),
): Promise<GirisSonucu> {
  if (!ipSinir.dene(g.ip ?? 'bilinmiyor', simdi.getTime())) return { ok: false, neden: 'HIZ_SINIRI' }
  const ad = g.kullaniciAdi.trim().toLowerCase()
  const k = await prisma.kullanici.findUnique({ where: { kullaniciAdi: ad } })
  if (!k || !k.aktif) {
    // Kullanıcı var/yok farkı yanıt süresinden anlaşılmasın.
    sahteOzet ??= sifreHashle('zamanlama-esitleme-icin-sahte-sifre')
    await sifreDogrula(await sahteOzet, g.sifre)
    return { ok: false, neden: 'GECERSIZ' }
  }
  if (k.kilitBitis && k.kilitBitis > simdi) return { ok: false, neden: 'KILITLI', kilitBitis: k.kilitBitis }

  const baglam = { kullaniciId: k.id, ip: g.ip }
  if (!(await sifreDogrula(k.sifreHash, g.sifre))) {
    const sayi = k.hataliGirisSayisi + 1
    const kilitBitis = sayi >= KILIT_ESIGI ? new Date(simdi.getTime() + KILIT_MS) : null
    await prisma.$transaction(async (tx) => {
      await tx.kullanici.update({ where: { id: k.id }, data: { hataliGirisSayisi: kilitBitis ? 0 : sayi, kilitBitis } })
      await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: k.id, eylem: kilitBitis ? 'GIRIS_KILITLENDI' : 'GIRIS_BASARISIZ' })
    })
    return kilitBitis ? { ok: false, neden: 'KILITLI', kilitBitis } : { ok: false, neden: 'GECERSIZ' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kullanici.update({ where: { id: k.id }, data: { hataliGirisSayisi: 0, kilitBitis: null, sonGiris: simdi } })
    await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: k.id, eylem: 'GIRIS' })
  })
  const o = await oturumOlustur({ kullaniciId: k.id, ip: g.ip, userAgent: g.userAgent })
  return { ok: true, kullaniciId: k.id, token: o.token, bitis: o.bitis, sifreDegismeli: k.sifreDegismeli }
}

export async function sifreDegistir(g: { kullaniciId: number; oturumId: number; eski: string; yeni: string; ip: string | null }): Promise<{ ok: true } | { ok: false; mesaj: string }> {
  if (g.yeni.length < ASGARI_SIFRE_UZUNLUGU) return { ok: false, mesaj: `Yeni şifre en az ${ASGARI_SIFRE_UZUNLUGU} karakter olmalı.` }
  if (g.yeni === g.eski) return { ok: false, mesaj: 'Yeni şifre mevcut şifreyle aynı olamaz.' }
  const k = await prisma.kullanici.findUnique({ where: { id: g.kullaniciId } })
  if (!k || !(await sifreDogrula(k.sifreHash, g.eski))) return { ok: false, mesaj: 'Mevcut şifre hatalı.' }
  const ozet = await sifreHashle(g.yeni)
  await prisma.$transaction(async (tx) => {
    await tx.kullanici.update({ where: { id: k.id }, data: { sifreHash: ozet, sifreDegismeli: false } })
    await kullaniciOturumlariniKapat(k.id, g.oturumId, tx)
    await denetimKaydi(tx, { kullaniciId: k.id, ip: g.ip }, { varlik: 'kullanici', varlikId: k.id, eylem: 'SIFRE_DEGISTI' })
  })
  return { ok: true }
}

export function istemciIp(h: Headers): string | null {
  const ileri = h.get('x-forwarded-for')
  if (ileri) return ileri.split(',')[0]!.trim() || null
  return h.get('x-real-ip')
}
