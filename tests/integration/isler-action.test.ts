import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// İşler ekranı action'ı doğrudan çağrılır: Next'in istek bağlamı (çerez, yönlendirme, önbellek) taklit edilir;
// oturum, veritabanı ve işler gerçektir.
const depo = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => depo, headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string): never => {
    throw new Error(`YONLENDIRME:${url}`)
  },
  unstable_rethrow: () => undefined,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { isCalistirAction } from '@/app/(uygulama)/yonetim/isler/actions'
import { BOS_FORM } from '@/app/_lib/form'
import { oturumDogrula } from '@/server/auth/oturum'
import { girisYap, sifreDegistir } from '@/server/auth/servis'
import { prisma } from '@/server/db'
import { BASKA_CALISMA_MESAJI, tekKopya } from '@/server/isler/tek-kopya'
import { kullaniciOlustur } from '@/server/kullanici/servis'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { TEST_BAGLAMI, temizle } from './yardimci'

const SIFRE = 'cok-guclu-sifre-123'

const form = (ad?: string): FormData => {
  const f = new FormData()
  if (ad !== undefined) f.set('is', ad)
  return f
}

/** Gerçek kullanıcı ve oturum; şifresi değişmiş (zorunlu değişim ekranına yönlenmez). */
async function oturumAc(): Promise<void> {
  const id = await kullaniciOlustur({ kullaniciAdi: 'ayse.yilmaz', adSoyad: 'Ayşe Yılmaz', geciciSifre: SIFRE }, TEST_BAGLAMI)
  const r = await girisYap({ kullaniciAdi: 'ayse.yilmaz', sifre: SIFRE, ip: '10.1.0.1', userAgent: null })
  if (!r.ok) throw new Error('giriş başarısız')
  const o = (await oturumDogrula(r.token))!
  await sifreDegistir({ kullaniciId: id, oturumId: o.oturumId, eski: SIFRE, yeni: 'yepyeni-sifre-456', ip: null })
  depo.get.mockReturnValue({ value: r.token })
}

beforeEach(async () => {
  depo.get.mockReset()
  vi.mocked(revalidatePath).mockClear()
  await temizle()
  await seedVerisiniYukle(prisma, { tufeOnayli: true })
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => prisma.$disconnect())

describe('isCalistirAction', () => {
  it('oturumsuz çağrı girişe yönlendirir; hiçbir iş başlatılmaz', async () => {
    depo.get.mockReturnValue(undefined)
    await expect(isCalistirAction(BOS_FORM, form('hatirlatma-uret'))).rejects.toThrow('YONLENDIRME:/giris')
    expect(await prisma.isCalisma.count()).toBe(0)
  })

  it('geçersiz ya da kapanmış oturum da girişe yönlendirir', async () => {
    depo.get.mockReturnValue({ value: 'gecersiz-belirtec' })
    await expect(isCalistirAction(BOS_FORM, form('hatirlatma-uret'))).rejects.toThrow('YONLENDIRME:/giris?oturum=kapandi')
    expect(await prisma.isCalisma.count()).toBe(0)
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'TAKVIM-GUNCELLE', 'yok', ' ', ''])(
    'bilinmeyen iş adı %j reddedilir; iş kaydı açılmaz', async (ad) => {
      await oturumAc()
      const r = await isCalistirAction(BOS_FORM, form(ad))
      expect(r).toEqual({ hata: 'Bilinmeyen iş.', alanHatalari: {}, tamam: false })
      expect(await prisma.isCalisma.count()).toBe(0)
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('iş adı hiç gönderilmemişse reddedilir', async () => {
    await oturumAc()
    expect((await isCalistirAction(BOS_FORM, form())).hata).toBe('Bilinmeyen iş.')
    expect(await prisma.isCalisma.count()).toBe(0)
  })

  it('geçerli iş çalışır, kaydı yazılır ve ekranlar yenilenir', async () => {
    await oturumAc()
    const r = await isCalistirAction(BOS_FORM, form('hatirlatma-uret'))
    expect(r).toEqual({ hata: null, alanHatalari: {}, tamam: true, mesaj: 'İş bitti: BASARILI' })
    const kayit = await prisma.isCalisma.findFirstOrThrow()
    expect([kayit.isAdi, kayit.durum]).toEqual(['hatirlatma-uret', 'BASARILI'])
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual(['/yonetim/isler', '/'])
  })

  it('başka bir çalışma sürüyorsa atlama nedeni gösterilir', async () => {
    await oturumAc()
    const r = await tekKopya('hatirlatma-uret', () => isCalistirAction(BOS_FORM, form('hatirlatma-uret')))
    expect(r).toMatchObject({ calisti: true, sonuc: { hata: BASKA_CALISMA_MESAJI, tamam: false } })
    expect(BASKA_CALISMA_MESAJI).toBe('Başka bir çalışma sürüyor; daha sonra tekrar deneyin.')
    const kayit = await prisma.isCalisma.findFirstOrThrow()
    expect([kayit.durum, kayit.ozet]).toEqual(['ATLANDI', BASKA_CALISMA_MESAJI])
  })

  it('EVDS anahtarı yoksa atlama nedeni anahtar eksikliğidir', async () => {
    await oturumAc()
    const r = await isCalistirAction(BOS_FORM, form('endeks-cek'))
    expect(r.tamam).toBe(false)
    expect(r.hata).toContain('EVDS_API_KEY tanımlı değil')
  })

  it('beklenmeyen hata form hatasına dönüşür (ham ileti sızmaz)', async () => {
    await oturumAc()
    const konsol = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(prisma.isCalisma, 'create').mockRejectedValueOnce(new Error('veritabanı bağlantı dizesi: gizli'))
    const r = await isCalistirAction(BOS_FORM, form('hatirlatma-uret'))
    expect(r.tamam).toBe(false)
    expect(r.hata).toContain('Beklenmeyen bir hata oluştu')
    expect(r.hata).not.toContain('gizli')
    expect(r.degerler).toEqual({ is: 'hatirlatma-uret' })
    expect(konsol).toHaveBeenCalled()
  })
})
