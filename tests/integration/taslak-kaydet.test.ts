import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { CakismaHatasi } from '@/server/hata'
import { taslakKaydetVeBagla } from '@/server/sozlesme/kaydet'
import { temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

const BAGLAM = { kullaniciId: 1, ip: null }

let h: Hazirlik
beforeEach(async () => {
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
})
