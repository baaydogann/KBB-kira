import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { girisYap, sifreDegistir } from '@/server/auth/servis'
import { oturumDogrula } from '@/server/auth/oturum'
import { kullaniciAktiflik, kullaniciOlustur, sifreSifirla } from '@/server/kullanici/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'

const SIFRE = 'cok-guclu-sifre-123'
let ipSayac = 0
const ip = () => `10.0.0.${++ipSayac}`

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

async function kullanici(ad = 'ayse.yilmaz') {
  return kullaniciOlustur({ kullaniciAdi: ad, adSoyad: 'Ayşe Yılmaz', geciciSifre: SIFRE }, TEST_BAGLAMI)
}

describe('giriş', () => {
  it('doğru şifreyle oturum açar; ilk girişte şifre değişimi zorunlu', async () => {
    await kullanici()
    const r = await girisYap({ kullaniciAdi: 'Ayse.Yilmaz', sifre: SIFRE, ip: ip(), userAgent: 'test' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sifreDegismeli).toBe(true)
    const o = await oturumDogrula(r.token)
    expect(o?.kullaniciAdi).toBe('ayse.yilmaz')
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'GIRIS' } })).toBe(1)
  })

  it('5 hatalı denemede 15 dakika kilitler; kilit bitince açılır', async () => {
    await kullanici()
    const adres = ip()
    const simdi = new Date('2026-10-15T09:00:00Z')
    for (let i = 0; i < 4; i++) {
      expect((await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: 'yanlis', ip: adres, userAgent: null }, simdi)).ok).toBe(false)
    }
    const besinci = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: 'yanlis', ip: adres, userAgent: null }, simdi)
    expect(!besinci.ok && besinci.neden).toBe('KILITLI')
    const dogruAmaKilitli = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null }, new Date('2026-10-15T09:10:00Z'))
    expect(!dogruAmaKilitli.ok && dogruAmaKilitli.neden).toBe('KILITLI')
    const sonra = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null }, new Date('2026-10-15T09:16:00Z'))
    expect(sonra.ok).toBe(true)
  })

  it('olmayan kullanıcı ve pasif kullanıcı GECERSIZ döner', async () => {
    const id = await kullanici()
    const yok = await girisYap({ kullaniciAdi: 'yok', sifre: SIFRE, ip: ip(), userAgent: null })
    expect(!yok.ok && yok.neden).toBe('GECERSIZ')
    await kullaniciAktiflik(id, false, TEST_BAGLAMI)
    const pasif = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    expect(!pasif.ok && pasif.neden).toBe('GECERSIZ')
  })
})

describe('oturum', () => {
  it('mutlak süre dolunca geçersizdir', async () => {
    await kullanici()
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    expect(await oturumDogrula(r.token, new Date(Date.now() + 25 * 60 * 60 * 1000))).toBeNull()
  })

  it('pasifleştirilen kullanıcının açık oturumu düşer', async () => {
    const id = await kullanici()
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    await kullaniciAktiflik(id, false, TEST_BAGLAMI)
    expect(await oturumDogrula(r.token)).toBeNull()
  })
})

describe('şifre', () => {
  it('şifre değişince diğer oturumlar kapanır, mevcut oturum kalır', async () => {
    const id = await kullanici()
    const a = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    const b = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!a.ok || !b.ok) throw new Error('giriş başarısız')
    const oa = (await oturumDogrula(a.token))!
    expect((await sifreDegistir({ kullaniciId: id, oturumId: oa.oturumId, eski: 'yanlis', yeni: 'yepyeni-sifre-456', ip: null })).ok).toBe(false)
    expect((await sifreDegistir({ kullaniciId: id, oturumId: oa.oturumId, eski: SIFRE, yeni: 'kisa', ip: null })).ok).toBe(false)
    expect((await sifreDegistir({ kullaniciId: id, oturumId: oa.oturumId, eski: SIFRE, yeni: 'yepyeni-sifre-456', ip: null })).ok).toBe(true)
    expect((await oturumDogrula(a.token))?.sifreDegismeli).toBe(false)
    expect(await oturumDogrula(b.token)).toBeNull()
  })

  it('şifre sıfırlama tüm oturumları kapatır ve değişimi zorunlu kılar', async () => {
    const id = await kullanici()
    const a = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!a.ok) throw new Error('giriş başarısız')
    await sifreSifirla(id, 'gecici-sifre-7890', TEST_BAGLAMI)
    expect(await oturumDogrula(a.token)).toBeNull()
    const yeni = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: 'gecici-sifre-7890', ip: ip(), userAgent: null })
    expect(yeni.ok && yeni.sifreDegismeli).toBe(true)
  })
})

describe('kullanıcı servisi', () => {
  it('kullanıcı adı biçimi ve tekilliği', async () => {
    await kullanici()
    await expect(kullanici('ayse.yilmaz')).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(kullanici('A B')).rejects.toBeInstanceOf(IsKuraliHatasi)
  })
  it('kendi hesabını pasifleştiremez', async () => {
    const id = await kullanici()
    await expect(kullaniciAktiflik(id, false, { kullaniciId: id, ip: null })).rejects.toBeInstanceOf(IsKuraliHatasi)
  })
})
