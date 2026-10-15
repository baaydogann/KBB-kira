import type { IslemBaglami } from '../baglam'
import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { BulunamadiHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { kullaniciOturumlariniKapat } from '../auth/oturum'
import { ASGARI_SIFRE_UZUNLUGU, sifreHashle } from '../auth/parola'

const KULLANICI_ADI = /^[a-z0-9._-]{3,40}$/

function sifreKontrol(sifre: string, alan: string): void {
  if (!sifre.trim()) throw new IsKuraliHatasi('SIFRE', 'Şifre boş olamaz.', alan)
  if (sifre.length < ASGARI_SIFRE_UZUNLUGU) {
    throw new IsKuraliHatasi('SIFRE', `Şifre en az ${ASGARI_SIFRE_UZUNLUGU} karakter olmalı.`, alan)
  }
}

export async function kullaniciOlustur(g: { kullaniciAdi: string; adSoyad: string; geciciSifre: string }, baglam: IslemBaglami): Promise<number> {
  const ad = g.kullaniciAdi.trim().toLowerCase()
  if (!KULLANICI_ADI.test(ad)) {
    throw new IsKuraliHatasi('KULLANICI_ADI', 'Kullanıcı adı 3–40 karakter olmalı; küçük harf, rakam, nokta, tire veya alt çizgi içerebilir.', 'kullaniciAdi')
  }
  if (g.adSoyad.trim().length < 3) throw new IsKuraliHatasi('AD_SOYAD', 'Ad soyad girin.', 'adSoyad')
  sifreKontrol(g.geciciSifre, 'geciciSifre')
  const ozet = await sifreHashle(g.geciciSifre)
  try {
    return await prisma.$transaction(async (tx) => {
      const k = await tx.kullanici.create({ data: { kullaniciAdi: ad, adSoyad: g.adSoyad.trim(), sifreHash: ozet, sifreDegismeli: true } })
      await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: k.id, eylem: 'OLUSTUR', sonra: { kullaniciAdi: ad, adSoyad: k.adSoyad } })
      return k.id
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('KULLANICI_ADI', 'Bu kullanıcı adı zaten kullanılıyor.', 'kullaniciAdi')
    throw e
  }
}

export async function kullaniciListesi() {
  return prisma.kullanici.findMany({
    orderBy: { kullaniciAdi: 'asc' },
    select: { id: true, kullaniciAdi: true, adSoyad: true, aktif: true, sonGiris: true, kilitBitis: true, sifreDegismeli: true },
  })
}

export async function kullaniciAktiflik(id: number, aktif: boolean, baglam: IslemBaglami): Promise<void> {
  if (!aktif && baglam.kullaniciId === id) throw new IsKuraliHatasi('KENDI', 'Kendi hesabınızı pasifleştiremezsiniz.')
  await prisma.$transaction(async (tx) => {
    const k = await tx.kullanici.findUnique({ where: { id } })
    if (!k) throw new BulunamadiHatasi('Kullanıcı bulunamadı.')
    // Pasifleştirme takvim aboneliğini de iptal eder: yeniden aktifleştirme eski (sızmış olabilecek) adresi canlandırmaz.
    await tx.kullanici.update({ where: { id }, data: { aktif, ...(aktif ? {} : { icsTokenHash: null }) } })
    if (!aktif) await kullaniciOturumlariniKapat(id, undefined, tx)
    await denetimKaydi(tx, baglam, {
      varlik: 'kullanici', varlikId: id, eylem: aktif ? 'AKTIFLESTIR' : 'PASIFLESTIR', sonra: { degisenAlanlar: aktif ? ['aktif'] : ['aktif', 'icsTokenHash'] },
    })
  })
}

export async function sifreSifirla(id: number, geciciSifre: string, baglam: IslemBaglami): Promise<void> {
  sifreKontrol(geciciSifre, 'geciciSifre')
  const ozet = await sifreHashle(geciciSifre)
  await prisma.$transaction(async (tx) => {
    if (!(await tx.kullanici.findUnique({ where: { id }, select: { id: true } }))) throw new BulunamadiHatasi('Kullanıcı bulunamadı.')
    // Sıfırlama (hesap ele geçirilmiş olabilir) takvim aboneliğini de iptal eder; kullanıcı yeni bağlantıyı Hesabım'dan üretir.
    await tx.kullanici.update({ where: { id }, data: { sifreHash: ozet, sifreDegismeli: true, hataliGirisSayisi: 0, kilitBitis: null, icsTokenHash: null } })
    await kullaniciOturumlariniKapat(id, undefined, tx)
    await denetimKaydi(tx, baglam, {
      varlik: 'kullanici', varlikId: id, eylem: 'SIFRE_SIFIRLA',
      sonra: { degisenAlanlar: ['sifreHash', 'sifreDegismeli', 'hataliGirisSayisi', 'kilitBitis', 'icsTokenHash'] },
    })
  })
}
