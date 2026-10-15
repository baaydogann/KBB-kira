import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Next'in istek bağlamına (cookies/headers/redirect) bağlı katman: depo ve yönlendirme taklit edilir,
// oturum ve veritabanı gerçektir.
const depo = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn(), get: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: async () => depo,
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string): never => {
    throw new Error(`YONLENDIRME:${url}`)
  },
}))
vi.mock('@/server/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/server/env')>()
  return { ...m, ortam: vi.fn(m.ortam) }
})

import { prisma } from '@/server/db'
import { ortam } from '@/server/env'
import { cerezYaz } from '@/server/auth/cerez'
import { islemBaglami, kullaniciGerekli, kullaniciGetir } from '@/server/auth/gerekli'
import { oturumDogrula } from '@/server/auth/oturum'
import { girisYap, sifreDegistir } from '@/server/auth/servis'
import { kullaniciOlustur } from '@/server/kullanici/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'

const SIFRE = 'cok-guclu-sifre-123'

beforeEach(async () => {
  depo.set.mockReset()
  depo.delete.mockReset()
  depo.get.mockReset()
  await temizle()
})
afterAll(() => prisma.$disconnect())

async function oturumAc(): Promise<{ id: number; token: string }> {
  const id = await kullaniciOlustur({ kullaniciAdi: 'ayse.yilmaz', adSoyad: 'Ayşe Yılmaz', geciciSifre: SIFRE }, TEST_BAGLAMI)
  const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: '10.1.0.1', userAgent: null })
  if (!r.ok) throw new Error('giriş başarısız')
  return { id, token: r.token }
}

describe('çerez', () => {
  it('httpOnly, lax, mutlak ömür kadar maxAge; secure APP_URL https ise', async () => {
    await cerezYaz('belirtec')
    expect(depo.set).toHaveBeenCalledWith('kbbkira_oturum', 'belirtec', {
      httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60,
    })

    depo.set.mockReset()
    vi.mocked(ortam).mockReturnValueOnce({ ...ortam(), APP_URL: 'https://kira.example.gov.tr' })
    await cerezYaz('belirtec')
    expect(depo.set).toHaveBeenCalledWith('kbbkira_oturum', 'belirtec', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60,
    })
  })
})

describe('kullaniciGetir / kullaniciGerekli', () => {
  it('şifre değişimi bekleyen kullanıcı için kullaniciGetir null, serbest bayrakla kullanıcıdır', async () => {
    const { token } = await oturumAc()
    depo.get.mockReturnValue({ value: token })
    expect(await kullaniciGetir()).toBeNull()
    expect((await kullaniciGetir({ sifreDegisimiSerbest: true }))?.kullaniciAdi).toBe('ayse.yilmaz')
    await expect(kullaniciGerekli()).rejects.toThrow('YONLENDIRME:/sifre-degistir')
    expect((await kullaniciGerekli({ sifreDegisimiSerbest: true })).kullaniciAdi).toBe('ayse.yilmaz')
  })

  it('şifresini değiştirmiş kullanıcıyı ikisi de verir', async () => {
    const { id, token } = await oturumAc()
    const o = (await oturumDogrula(token))!
    expect((await sifreDegistir({ kullaniciId: id, oturumId: o.oturumId, eski: SIFRE, yeni: 'yepyeni-sifre-456', ip: null })).ok).toBe(true)
    depo.get.mockReturnValue({ value: token })
    expect((await kullaniciGetir())?.kullaniciAdi).toBe('ayse.yilmaz')
    expect((await kullaniciGerekli()).kullaniciAdi).toBe('ayse.yilmaz')
  })

  it('çerez yoksa /giris, geçersiz çerezde /giris?oturum=kapandi', async () => {
    depo.get.mockReturnValue(undefined)
    expect(await kullaniciGetir()).toBeNull()
    await expect(kullaniciGerekli()).rejects.toThrow('YONLENDIRME:/giris')
    depo.get.mockReturnValue({ value: 'gecersiz-belirtec' })
    expect(await kullaniciGetir()).toBeNull()
    await expect(kullaniciGerekli()).rejects.toThrow('YONLENDIRME:/giris?oturum=kapandi')
  })

  it('islemBaglami kullanıcıyı ve istemci IP’sini taşır', async () => {
    const { id, token } = await oturumAc()
    const o = (await oturumDogrula(token))!
    expect(await islemBaglami(o)).toEqual({ kullaniciId: id, ip: '203.0.113.7' })
  })
})
