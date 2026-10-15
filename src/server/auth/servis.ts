import { isIP } from 'node:net'
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

// Kullanıcı yokken de gerçek bir argon2 doğrulaması yapılır (yanıt süresi eşitleme). Özet süreç
// başlarken ısıtılır; başarısız hesap kalıcı önbelleğe alınmaz, sonraki çağrı yeniden dener.
let sahteOzet: Promise<string> | null = null
function sahteOzetAl(): Promise<string> {
  sahteOzet ??= sifreHashle('zamanlama-esitleme-icin-sahte-sifre').catch((e: unknown) => {
    sahteOzet = null
    throw e
  })
  return sahteOzet
}
void sahteOzetAl().catch(() => undefined)

export async function girisYap(
  g: { kullaniciAdi: string; sifre: string; ip: string | null; userAgent: string | null },
  simdi: Date = new Date(),
): Promise<GirisSonucu> {
  // IP bilinmiyorsa ortak bir kova açılmaz (tek istemci herkesi engellerdi); hesap kilidi yine geçerlidir.
  if (g.ip !== null && !ipSinir.dene(g.ip, simdi.getTime())) return { ok: false, neden: 'HIZ_SINIRI' }
  const ad = g.kullaniciAdi.trim().toLowerCase()
  const k = await prisma.kullanici.findUnique({ where: { kullaniciAdi: ad } })
  if (!k || !k.aktif) {
    // Kullanıcı var/yok farkı yanıt süresinden anlaşılmasın.
    await sifreDogrula(await sahteOzetAl(), g.sifre)
    return { ok: false, neden: 'GECERSIZ' }
  }
  if (k.kilitBitis && k.kilitBitis > simdi) return { ok: false, neden: 'KILITLI', kilitBitis: k.kilitBitis }

  const baglam = { kullaniciId: k.id, ip: g.ip }
  if (!(await sifreDogrula(k.sifreHash, g.sifre))) {
    // Sayaç veritabanında atomik artırılır; doğrulama süresince okunmuş bayat değer kullanılmaz.
    // Başarısızlık yolu kilidi asla silmez (eşzamanlı bir istek koymuş olabilir).
    const kilitBitis = await prisma.$transaction(async (tx) => {
      const { hataliGirisSayisi } = await tx.kullanici.update({
        where: { id: k.id },
        data: { hataliGirisSayisi: { increment: 1 } },
        select: { hataliGirisSayisi: true },
      })
      const kilit = hataliGirisSayisi >= KILIT_ESIGI ? new Date(simdi.getTime() + KILIT_MS) : null
      if (kilit) await tx.kullanici.update({ where: { id: k.id }, data: { hataliGirisSayisi: 0, kilitBitis: kilit } })
      await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: k.id, eylem: kilit ? 'GIRIS_KILITLENDI' : 'GIRIS_BASARISIZ' })
      return kilit
    })
    return kilitBitis ? { ok: false, neden: 'KILITLI', kilitBitis } : { ok: false, neden: 'GECERSIZ' }
  }

  // Sıfırlama ve giriş yalnızca etkin kilit yoksa uygulanır; doğrulama sürerken kilit konduysa giriş reddedilir.
  const kilitli = await prisma.$transaction(async (tx) => {
    const guncel = await tx.kullanici.updateMany({
      where: { id: k.id, OR: [{ kilitBitis: null }, { kilitBitis: { lte: simdi } }] },
      data: { hataliGirisSayisi: 0, kilitBitis: null, sonGiris: simdi },
    })
    if (guncel.count === 0) {
      const mevcut = await tx.kullanici.findUnique({ where: { id: k.id }, select: { kilitBitis: true } })
      return { kilitBitis: mevcut?.kilitBitis ?? undefined }
    }
    await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: k.id, eylem: 'GIRIS' })
    return null
  })
  if (kilitli) return { ok: false, neden: 'KILITLI', kilitBitis: kilitli.kilitBitis }
  const o = await oturumOlustur({ kullaniciId: k.id, ip: g.ip, userAgent: g.userAgent })
  return { ok: true, kullaniciId: k.id, token: o.token, bitis: o.bitis, sifreDegismeli: k.sifreDegismeli }
}

export async function sifreDegistir(g: { kullaniciId: number; oturumId: number; eski: string; yeni: string; ip: string | null }): Promise<{ ok: true } | { ok: false; mesaj: string }> {
  if (!g.yeni.trim()) return { ok: false, mesaj: 'Yeni şifre boş olamaz.' }
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

/**
 * İstemci adresi: en sağdaki X-Forwarded-For girdisi (güvenilir ters vekilin eklediği; soldakiler
 * istemci tarafından uydurulabilir), yoksa X-Real-IP. Geçerli bir IP değilse null.
 * Uygulama yalnızca bir güvenilir ters vekilin arkasında çalıştırılmalıdır.
 */
export function istemciIp(h: Headers): string | null {
  const ileri = h.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).at(-1)
  const aday = ileri ?? h.get('x-real-ip')?.trim() ?? null
  return aday && isIP(aday) !== 0 ? aday : null
}
