import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db'
import { girisYap, istemciIp, sifreDegistir } from '@/server/auth/servis'
import { OTURUM_SURESI_MS, oturumDogrula, tokenOzeti } from '@/server/auth/oturum'
import { sifreDogrula, sifreHashle } from '@/server/auth/parola'
import { kullaniciAktiflik, kullaniciOlustur, sifreSifirla } from '@/server/kullanici/servis'
import { BulunamadiHatasi, IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'

// Doğrulama sürerken eşzamanlı kilit koymayı taklit edebilmek için sarmalanır; varsayılan davranış gerçek sifreDogrula'dır.
vi.mock('@/server/auth/parola', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/server/auth/parola')>()
  return { ...m, sifreDogrula: vi.fn(m.sifreDogrula) }
})

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

describe('giriş kilidi eşzamanlılığı', () => {
  it('8 paralel hatalı deneme kilidi koyar ve silmez', async () => {
    await kullanici()
    const simdi = new Date('2026-10-15T09:00:00Z')
    const sonuclar = await Promise.all(
      Array.from({ length: 8 }, () => girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: 'yanlis', ip: ip(), userAgent: null }, simdi)),
    )
    expect(sonuclar.every((r) => !r.ok)).toBe(true)
    const k = await prisma.kullanici.findUniqueOrThrow({ where: { kullaniciAdi: 'ayse.yilmaz' } })
    expect(k.kilitBitis?.toISOString()).toBe('2026-10-15T09:15:00.000Z')
  })

  it('doğrulama sürerken kilit konursa doğru şifre de KILITLI döner; oturum ve GIRIS kaydı oluşmaz', async () => {
    const id = await kullanici()
    const kilit = new Date('2026-10-15T09:15:00Z')
    vi.mocked(sifreDogrula).mockImplementationOnce(async () => {
      await prisma.kullanici.update({ where: { id }, data: { kilitBitis: kilit } })
      return true
    })
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null }, new Date('2026-10-15T09:00:00Z'))
    expect(!r.ok && r.neden).toBe('KILITLI')
    expect(!r.ok && r.kilitBitis?.toISOString()).toBe(kilit.toISOString())
    expect(await prisma.oturum.count()).toBe(0)
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'GIRIS' } })).toBe(0)
  })
})

describe('IP hız sınırı', () => {
  it('bilinmeyen IP (null) ortak kovaya düşmez; bilinen IP sınırlanır', async () => {
    await kullanici()
    const simdi = new Date('2026-10-15T09:00:00Z')
    for (let i = 0; i < 25; i++) {
      await girisYap({ kullaniciAdi: 'yok', sifre: '', ip: null, userAgent: null }, simdi)
    }
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: null, userAgent: null }, simdi)
    expect(r.ok).toBe(true)

    const adres = ip()
    const sonuclar: string[] = []
    for (let i = 0; i < 21; i++) {
      const s = await girisYap({ kullaniciAdi: 'yok', sifre: '', ip: adres, userAgent: null }, simdi)
      sonuclar.push(s.ok ? 'OK' : s.neden)
    }
    expect(sonuclar.slice(0, 20).every((n) => n === 'GECERSIZ')).toBe(true)
    expect(sonuclar[20]).toBe('HIZ_SINIRI')
  })
})

describe('istemciIp', () => {
  const basliklar = (o: Record<string, string>) => new Headers(o)

  it('X-Forwarded-For içinde en sağdaki (güvenilir vekilin eklediği) girdiyi alır', () => {
    expect(istemciIp(basliklar({ 'x-forwarded-for': '1.2.3.4, 10.0.0.5' }))).toBe('10.0.0.5')
    expect(istemciIp(basliklar({ 'x-forwarded-for': '1.2.3.4, ' }))).toBe('1.2.3.4')
    expect(istemciIp(basliklar({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1')
  })

  it('geçersiz değeri null yapar', () => {
    expect(istemciIp(basliklar({ 'x-forwarded-for': 'garbage' }))).toBeNull()
    expect(istemciIp(basliklar({ 'x-forwarded-for': '1.2.3.4, <script>' }))).toBeNull()
    expect(istemciIp(basliklar({ 'x-forwarded-for': '1.2.3.4:8080' }))).toBeNull()
    expect(istemciIp(basliklar({ 'x-real-ip': 'nope' }))).toBeNull()
  })

  it('X-Forwarded-For yoksa X-Real-IP, o da yoksa null', () => {
    expect(istemciIp(basliklar({ 'x-real-ip': ' 192.168.1.9 ' }))).toBe('192.168.1.9')
    expect(istemciIp(basliklar({ 'x-forwarded-for': ' ', 'x-real-ip': '192.168.1.9' }))).toBe('192.168.1.9')
    expect(istemciIp(basliklar({}))).toBeNull()
  })
})

describe('parola', () => {
  it('argon2id, 64 MiB, t=3, p=1 ile hashler', async () => {
    expect(await sifreHashle('x'.repeat(12))).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/)
  })
})

describe('oturum', () => {
  it('mutlak süre dolunca geçersizdir', async () => {
    await kullanici()
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    expect(await oturumDogrula(r.token, new Date(Date.now() + 25 * 60 * 60 * 1000))).toBeNull()
  })

  it('kayan süre mutlak süreyi aşmaz: +7s, +14s, +21s uzatır; +25s kapanır', async () => {
    await kullanici()
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    const satir = () => prisma.oturum.findUniqueOrThrow({ where: { tokenHash: tokenOzeti(r.token) } })
    const ilk = await satir()
    const baslangic = ilk.bitis.getTime() - OTURUM_SURESI_MS
    const saat = 60 * 60 * 1000
    let onceki = ilk.bitis.getTime()
    for (const h of [7, 14, 21]) {
      expect(await oturumDogrula(r.token, new Date(baslangic + h * saat))).not.toBeNull()
      const o = await satir()
      expect(o.bitis.getTime()).toBeGreaterThan(onceki)
      expect(o.bitis.getTime()).toBeLessThanOrEqual(o.mutlakBitis.getTime())
      onceki = o.bitis.getTime()
    }
    const son = await satir()
    expect(son.bitis.getTime()).toBe(son.mutlakBitis.getTime())
    expect(await oturumDogrula(r.token, new Date(baslangic + 25 * saat))).toBeNull()
  })

  it('bitiş gelecekte olsa da mutlak süresi dolmuş oturum geçersizdir', async () => {
    await kullanici()
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    await prisma.oturum.updateMany({ data: { bitis: new Date(Date.now() + 10 * 60 * 60 * 1000), mutlakBitis: new Date(Date.now() - 60_000) } })
    expect(await oturumDogrula(r.token)).toBeNull()
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
  it('yalnızca boşluktan oluşan şifre doğrulama hatasıdır (500 değil)', async () => {
    const bosluk = ' '.repeat(12)
    await expect(
      kullaniciOlustur({ kullaniciAdi: 'bosluk.sifre', adSoyad: 'Ayşe Yılmaz', geciciSifre: bosluk }, TEST_BAGLAMI),
    ).rejects.toBeInstanceOf(IsKuraliHatasi)
    const id = await kullanici()
    await expect(sifreSifirla(id, bosluk, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: ip(), userAgent: null })
    if (!r.ok) throw new Error('giriş başarısız')
    const o = (await oturumDogrula(r.token))!
    expect((await sifreDegistir({ kullaniciId: id, oturumId: o.oturumId, eski: SIFRE, yeni: bosluk, ip: null })).ok).toBe(false)
  })
  it('olmayan kullanıcının şifresi sıfırlanamaz', async () => {
    await expect(sifreSifirla(987_654, 'gecici-sifre-7890', TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
  })
  it('kendi hesabını pasifleştiremez', async () => {
    const id = await kullanici()
    await expect(kullaniciAktiflik(id, false, { kullaniciId: id, ip: null })).rejects.toBeInstanceOf(IsKuraliHatasi)
  })
})
