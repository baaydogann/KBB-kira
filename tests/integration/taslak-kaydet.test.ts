import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Oturum ve önbellek taklit edilir (action'ı doğrudan çağırmak için); belge bağlama varsayılan olarak gerçektir,
// yalnızca "beklenmeyen hata" sınamasında araya hata sokulur. Veritabanı ve servisler gerçektir.
const taklit = vi.hoisted(() => ({ baglaHatasi: null as Error | null }))
vi.mock('@/server/auth/gerekli', () => ({
  kullaniciGerekli: async () => ({ id: 1 }),
  islemBaglami: async (k: { id: number }) => ({ kullaniciId: k.id, ip: null }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/belge/servis', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/server/belge/servis')>()
  return {
    ...m,
    belgeyiBagla: async (...a: Parameters<typeof m.belgeyiBagla>) => {
      if (taklit.baglaHatasi) throw taklit.baglaHatasi
      return m.belgeyiBagla(...a)
    },
  }
})

import { sozlesmeKaydetAction } from '@/app/(uygulama)/sozlesmeler/actions'
import { prisma } from '@/server/db'
import { CakismaHatasi } from '@/server/hata'
import { kayitSonrasiHataMi, taslakKaydetVeBagla } from '@/server/sozlesme/kaydet'
import { temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

const BAGLAM = { kullaniciId: 1, ip: null }

let h: Hazirlik
beforeEach(async () => {
  taklit.baglaHatasi = null
  await temizle()
  h = await hazirlik()
  await prisma.kullanici.create({ data: { id: 1, kullaniciAdi: 'test', adSoyad: 'Test', sifreHash: 'x' } })
  await prisma.kullanici.create({ data: { id: 2, kullaniciAdi: 'diger', adSoyad: 'Diğer', sifreHash: 'x' } })
})
afterAll(() => prisma.$disconnect())

/** Yükleme uç noktasının bıraktığı durum: sahibi yükleyen kullanıcı olan geçici belge (dosya içeriği bu sınamada gerekmez). */
async function geciciBelge(kullaniciId: number): Promise<number> {
  const b = await prisma.belge.create({
    data: { sahipTur: 'gecici', sahipId: kullaniciId, belgeTuru: 'SOZLESME', dosyaAdi: 'sozlesme.pdf', sha256: 'a'.repeat(64), boyut: 10, mime: 'application/pdf', yukleyenId: kullaniciId },
  })
  return b.id
}

const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version

describe('taslak kaydet ve belge bağla', () => {
  it('yeni taslağı kaydeder, geçici belgeyi ona bağlar; sürüm veritabanındaki sürümdür', async () => {
    const belgeId = await geciciBelge(1)
    const r = await taslakKaydetVeBagla(girdi(h), BAGLAM, undefined, undefined, belgeId)
    expect(r.belgeHatasi).toBeNull()
    expect(r.version).toBe(await surum(r.id))
    const b = await prisma.belge.findUniqueOrThrow({ where: { id: belgeId } })
    expect([b.sahipTur, b.sahipId]).toEqual(['sozlesme', r.id])
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'belge', varlikId: String(belgeId), eylem: 'BAGLA' } })).toBe(1)
  })

  it('belge verilmezse yalnızca kaydeder', async () => {
    const r = await taslakKaydetVeBagla(girdi(h), BAGLAM)
    expect(r).toEqual({ id: r.id, version: 0, belgeHatasi: null })
    expect(await prisma.sozlesme.count()).toBe(1)
  })

  it('bağlama başarısızsa taslak kalır, hata iletisi döner ve sürüm veritabanındakiyle aynıdır', async () => {
    const baskasininBelgesi = await geciciBelge(2)
    const r = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-1' }), BAGLAM, undefined, undefined, baskasininBelgesi)
    expect(r.belgeHatasi).toContain('Belge bağlanamadı')
    expect(await prisma.sozlesme.count()).toBe(1)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: r.id } })).sozlesmeNo).toBe('BAG-1')
    expect(r.version).toBe(await surum(r.id))
    const b = await prisma.belge.findUniqueOrThrow({ where: { id: baskasininBelgesi } })
    expect([b.sahipTur, b.sahipId]).toEqual(['gecici', 2])
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'belge', eylem: 'BAGLA' } })).toBe(0)
  })

  it('dönen sürümle yeniden kaydetmek aynı taslağı günceller (kopya açmaz), sürümü ilerletir ve belgeyi bağlar', async () => {
    const r1 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-2' }), BAGLAM, undefined, undefined, await geciciBelge(2))
    expect(r1.belgeHatasi).not.toBeNull()
    const belgeId = await geciciBelge(1)
    const r2 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-2B' }), BAGLAM, r1.id, r1.version, belgeId)
    expect(r2.id).toBe(r1.id)
    expect(r2.version).toBe(r1.version + 1)
    expect(r2.version).toBe(await surum(r2.id))
    expect(r2.belgeHatasi).toBeNull()
    expect(await prisma.sozlesme.count()).toBe(1)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: r2.id } })).sozlesmeNo).toBe('BAG-2B')
    const b = await prisma.belge.findUniqueOrThrow({ where: { id: belgeId } })
    expect([b.sahipTur, b.sahipId]).toEqual(['sozlesme', r2.id])
  })

  it('bayat sürümde CakismaHatasi verir; taslak ve belge değişmez', async () => {
    const r1 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-3' }), BAGLAM)
    const r2 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-3B' }), BAGLAM, r1.id, r1.version)
    expect(r2.version).toBe(r1.version + 1)
    const belgeId = await geciciBelge(1)
    await expect(taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BAG-3C' }), BAGLAM, r1.id, r1.version, belgeId)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: r1.id } })).sozlesmeNo).toBe('BAG-3B')
    expect(await surum(r1.id)).toBe(r2.version)
    expect((await prisma.belge.findUniqueOrThrow({ where: { id: belgeId } })).sahipTur).toBe('gecici')
  })

  it('kayıt ile geri okuma arasına giren eşzamanlı düzenleme: dönen sürüm çağıranın yazdığıdır, sonraki kaydetme CakismaHatasi verir ve ezmez', async () => {
    const r1 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'ES-1' }), BAGLAM)
    // Başka bir kullanıcı, çağıranın yazısı ile (varsa) sürüm okuması arasında aynı taslağı güncelliyor.
    const gercek = prisma.sozlesme.findUniqueOrThrow.bind(prisma.sozlesme)
    vi.spyOn(prisma.sozlesme, 'findUniqueOrThrow').mockImplementation(((...a: Parameters<typeof gercek>) =>
      prisma.sozlesme.updateMany({ where: { id: r1.id }, data: { sozlesmeNo: 'BASKA', version: { increment: 1 } } }).then(() => gercek(...a))) as unknown as typeof gercek)
    const r2 = await taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'ES-1B' }), BAGLAM, r1.id, r1.version)
    vi.restoreAllMocks()
    // Çağıranın sahip olduğu sürüm version + 1'dir; satırdaki güncel sürüm değil.
    expect(r2.version).toBe(r1.version + 1)
    // Güncelleme yolunda geri okuma yoktur (aralık kapalıdır), bu yüzden düzenleme bu noktada giriyor: satır artık çağıranın
    // sürümünün önündedir ve aynı sürümle yeniden kaydetme çakışma almalıdır (aksi halde "BASKA" sessizce ezilirdi).
    if ((await surum(r1.id)) === r2.version) {
      await prisma.sozlesme.updateMany({ where: { id: r1.id }, data: { sozlesmeNo: 'BASKA', version: { increment: 1 } } })
    }
    await expect(taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'ES-1C' }), BAGLAM, r2.id, r2.version)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: r1.id } })).sozlesmeNo).toBe('BASKA')
  })

  it('beklenmeyen bağlama hatası olduğu gibi yeniden fırlatılır ve kayıt sonrası hata olarak tanınır; taslak kayıtlıdır', async () => {
    const hata = new Error('veritabanı koptu')
    taklit.baglaHatasi = hata
    await expect(taslakKaydetVeBagla(girdi(h, { sozlesmeNo: 'BEK-1' }), BAGLAM, undefined, undefined, await geciciBelge(1))).rejects.toBe(hata)
    expect(kayitSonrasiHataMi(hata)).toBe(true)
    expect(kayitSonrasiHataMi(new Error('başka'))).toBe(false)
    expect(await prisma.sozlesme.count({ where: { sozlesmeNo: 'BEK-1' } })).toBe(1)
  })
})

/** Formdan gelen ham değerler (action zod ile ayrıştırır); `girdi` yardımcısının ayrıştırılmış çıktısı değil. */
const HAM = () => ({
  sozlesmeNo: 'ACT-1', tasinmazId: h.tasinmazId, birimId: h.birimId, ekonomikKod: null, imzaTarihi: '2025-12-20', baslangic: '2026-01-01', bitis: '2026-12-31',
  ilkKiraBaslangici: null, bedelTutari: '10.000,00', bedelTabani: 'AYLIK', bedelTuru: 'BRUT', odemePeriyoduAy: 1, odemeZamani: 'PESIN',
  vadeKurali: 'DONEM_BASI_ARTI_GUN', vadeParametresi: 0, artisKurali: 'TUFE12', artisDegisimTuru: 'ON_IKI_AY_ORT', sabitArtisOrani: null, artisPeriyoduAy: 12,
  kistYontemi: 'GERCEK_GUN', damgaTahsil: 'ISTIHKAKTAN', ihaleDayanagi: 'DT_4734_22E', onayBelgesiNo: 'OB-1', onayBelgesiTarihi: null, piyasaArastirmaTarihi: null,
  encumenKararNo: null, gecisTarihi: null, gecisBedeli: null, odenmisSayilanSonTarih: null, notlar: null,
  malikler: [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null }],
})

describe('sozlesmeKaydetAction', () => {
  it('kaydeder ve bağlar; sürümü kaydedilmiş satırdan döndürür', async () => {
    const r = await sozlesmeKaydetAction(HAM(), null, null, await geciciBelge(1))
    expect(r).toEqual({ ok: true, id: expect.any(Number) as number, version: 0, belgeHatasi: null })
  })

  it('iş kuralı bağlama hatasında ok:true ve belgeHatasi döner (taslak kayıtlı)', async () => {
    const r = await sozlesmeKaydetAction(HAM(), null, null, await geciciBelge(2))
    expect(r).toMatchObject({ ok: true, version: 0 })
    expect(r.ok && r.belgeHatasi).toContain('Belge bağlanamadı')
    expect(await prisma.sozlesme.count()).toBe(1)
  })

  it('beklenmeyen bağlama hatasında "kayıt değişmedi" demez; kayıt yapıldığını ve sayfanın yenilenmesini söyler', async () => {
    taklit.baglaHatasi = new Error('veritabanı koptu')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await sozlesmeKaydetAction(HAM(), null, null, await geciciBelge(1))
    expect(r).toMatchObject({ ok: false, hata: 'Kayıt kaydedildi ancak belge bağlanırken beklenmeyen bir hata oluştu; sayfayı yenileyin.' })
    expect(!r.ok && r.hata).not.toContain('kayıt değişmedi')
    expect(log).toHaveBeenCalledTimes(1)
    expect(await prisma.sozlesme.count()).toBe(1)
    log.mockRestore()
  })

  it('doğrulama hatasında ok:false ve alan hatalarını döndürür; hiçbir şey kaydedilmez, belge bağlanmaz', async () => {
    const belgeId = await geciciBelge(1)
    const r = await sozlesmeKaydetAction({ ...HAM(), sozlesmeNo: '' }, null, null, belgeId)
    expect(r).toMatchObject({ ok: false, alanHatalari: { sozlesmeNo: 'Sözleşme numarası girin.' } })
    expect(await prisma.sozlesme.count()).toBe(0)
    expect((await prisma.belge.findUniqueOrThrow({ where: { id: belgeId } })).sahipTur).toBe('gecici')
  })
})
