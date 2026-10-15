import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// EVDS anahtarı ortamdan gelir; testler anahtarı değiştirebilsin diye ortam() yalnızca bu alanda taklit edilir.
const sahte = vi.hoisted(() => ({ anahtar: '', cakisan: null as number | null }))
vi.mock('@/server/env', async (orijinal) => {
  const m = await orijinal<typeof import('@/server/env')>()
  return { ...m, ortam: () => ({ ...m.ortam(), EVDS_API_KEY: sahte.anahtar }) }
})
// Plan güncellemesi gerçek çalışır; seçilen sözleşmede yazılar yapıldıktan sonra CakismaHatasi atılır (sözleşme başına geri alma denetimi).
vi.mock('@/server/taksit/servis', async (orijinal) => {
  const m = await orijinal<typeof import('@/server/taksit/servis')>()
  const { CakismaHatasi } = await import('@/server/hata')
  return {
    ...m,
    taksitPlaniniGuncelle: async (...a: Parameters<typeof m.taksitPlaniniGuncelle>) => {
      const ozet = await m.taksitPlaniniGuncelle(...a)
      if (a[1] === sahte.cakisan) throw new CakismaHatasi()
      return ozet
    },
  }
})

import { prisma } from '@/server/db'
import { para } from '@/core/para'
import { ayKaydir, tarih as t } from '@/core/tarih'
import { endeksElleGir } from '@/server/endeks/servis'
import { tekKopya } from '@/server/isler/tek-kopya'
import { isCalistir, saglikDurumu } from '@/server/isler/kayit'
import { ISLER } from '@/server/isler'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterEach(() => {
  vi.unstubAllGlobals()
  sahte.anahtar = ''
  sahte.cakisan = null
})
afterAll(() => prisma.$disconnect())

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function aktif(ek: Record<string, unknown> = {}, bugun = t('2026-01-01')) {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
  return id
}

/** I(ay) = 100 + (2024-10'dan beri geçen ay); `sonK` son yayımlanan ayın kaydırması (22: 2026-08, 23: 2026-09). */
function evdsYaniti(sonK: number): typeof fetch {
  return (async (girdi: string | URL | Request) => {
    const alan = /series=([^&]+)/.exec(String(girdi))![1]!.replaceAll('.', '_')
    const items = []
    for (let k = -14; k <= sonK; k++) {
      const a = ayKaydir({ yil: 2024, ay: 10 }, k)
      items.push({ Tarih: `${a.yil}-${a.ay}`, [alan]: String(100 + k) })
    }
    return new Response(JSON.stringify({ totalCount: items.length, items }), { status: 200 })
  }) as typeof fetch
}

describe('tek kopya kilidi', () => {
  it('aynı iş aynı anda iki kez çalışmaz', async () => {
    const [a, b] = await Promise.all([
      tekKopya('deneme', async () => { await bekle(400); return 1 }),
      (async () => { await bekle(100); return tekKopya('deneme', async () => 2) })(),
    ])
    expect([a.calisti, b.calisti]).toEqual([true, false])
    expect((await tekKopya('deneme', async () => 3)).calisti).toBe(true)
  })

  it('kilit işin çalıştığı bağlantıda tutulur; farklı işler birbirini engellemez', async () => {
    const r = await tekKopya('bir', async (tx) => {
      const [satir] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`
      const diger = await tekKopya('iki', async () => 'iki')
      return { n: satir?.n, diger }
    })
    expect(r).toEqual({ calisti: true, sonuc: { n: 1n, diger: { calisti: true, sonuc: 'iki' } } })
  })

  it('iş hata verirse hata yayılır ve kilit bırakılır', async () => {
    await expect(tekKopya('hata', async () => { throw new Error('patladı') })).rejects.toThrow('patladı')
    expect(await tekKopya('hata', async () => 1)).toEqual({ calisti: true, sonuc: 1 })
  })
})

describe('iş kaydı', () => {
  it('başarılı, hatalı ve atlanan çalışmaları kaydeder', async () => {
    expect(await isCalistir('x', async () => ({ ozet: 'tamam' }))).toBe('BASARILI')
    expect(await isCalistir('x', async () => { throw new Error('patladı') })).toBe('HATALI')
    expect(await isCalistir('x', async () => ({ ozet: 'anahtar yok', atlandi: true }))).toBe('ATLANDI')
    const r = await prisma.isCalisma.findMany({ orderBy: { id: 'asc' } })
    expect(r.map((x) => [x.durum, x.ozet ?? x.hata])).toEqual([['BASARILI', 'tamam'], ['HATALI', 'patladı'], ['ATLANDI', 'anahtar yok']])
  })

  it('sayılar ve ayrıntı birlikte yazılır; hatalı biten çalışma da sayılarını taşır', async () => {
    expect(await isCalistir('x', async () => ({ ozet: 'oluşturulan: 2', ayrinti: 'seri A: eksik', hatali: true }))).toBe('HATALI')
    expect(await isCalistir('x', async () => ({ ozet: 'oluşturulan: 3', ayrinti: 'seri B: eksik' }))).toBe('BASARILI')
    const r = await prisma.isCalisma.findMany({ orderBy: { id: 'asc' } })
    expect(r.map((x) => [x.durum, x.ozet, x.hata])).toEqual([['HATALI', 'oluşturulan: 2', 'seri A: eksik'], ['BASARILI', 'oluşturulan: 3', 'seri B: eksik']])
  })

  it('sağlık durumu son 26 saatte başarılı takvim/hatırlatma çalışması yoksa uyarır', async () => {
    expect((await saglikDurumu()).length).toBeGreaterThan(0)
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    expect(await saglikDurumu()).toEqual([])
  })

  it('26 saati aşan başarı uyarı sayılır', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    const yirmiBesSaatSonra = new Date(Date.now() + 25 * 3_600_000)
    const yirmiYediSaatSonra = new Date(Date.now() + 27 * 3_600_000)
    expect(await saglikDurumu(yirmiBesSaatSonra)).toEqual([])
    expect(await saglikDurumu(yirmiYediSaatSonra)).toHaveLength(2)
  })

  it('EVDS çekimi hatalıysa uyarır; sonraki başarılı çekim uyarıyı kaldırır; atlanan (başka kopya) çalışma hatayı gizlemez', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 0', ayrinti: 'EVDS 500 döndü', hatali: true }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'Başka bir kopya çalışıyor.', atlandi: true }))
    const uyarilar = await saglikDurumu()
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('EVDS')
    expect(uyarilar[0]).toContain('EVDS 500 döndü')
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 8' }))
    expect(await saglikDurumu()).toEqual([])
  })

  it('EVDS\'te yayımlanmamış (atlanan) endeksler ve takvim işinin sözleşme hataları uyarı olarak görünür', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok', ayrinti: 'S-1: kira bedeli tanımlı değil' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 4, atlanan: 4', ayrinti: 'TUFE_YILLIK 2026-09: eksik veri' }))
    const uyarilar = await saglikDurumu()
    expect(uyarilar).toHaveLength(2)
    expect(uyarilar.join('\n')).toContain('S-1: kira bedeli tanımlı değil')
    expect(uyarilar.join('\n')).toContain('TUFE_YILLIK 2026-09: eksik veri')
  })

  it('uzun ayrıntı bantta kısaltılır', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok', ayrinti: 'x'.repeat(3000) }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    const [u] = await saglikDurumu()
    expect(u!.length).toBeLessThan(500)
  })
})

describe('işler', () => {
  it('takvim işi süresi geçen işyerini uzatır, idempotenttir; hatırlatma işi kayıt üretir', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2025-10-01', bitis: '2026-09-30' }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2025-10-01'))
    const bugun = t('2026-10-15')
    const r1 = await ISLER['takvim-guncelle'](bugun)
    expect(r1.ozet).toContain('uzatılan: 1')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum).toBe('UZADI')
    const r2 = await ISLER['takvim-guncelle'](bugun)
    expect(r2.ozet).toContain('uzatılan: 0')
    expect(r2.ozet).toContain('eklenen: 0')
    await ISLER['hatirlatma-uret'](bugun)
    expect(await prisma.hatirlatma.count()).toBeGreaterThan(0)
  })

  it('takvim işi: ardışık çalışmalar (telafi) aynı sonucu verir, kayıt çoğalmaz', async () => {
    await aktif({ baslangic: '2026-01-01', bitis: null })
    const bugun = t('2026-10-15')
    const r1 = await ISLER['takvim-guncelle'](bugun)
    expect(r1.ozet).not.toContain('eklenen: 0,')
    const sayilar = async () => [await prisma.taksit.count(), await prisma.artisHesabi.count(), await prisma.olayGunlugu.count(), await prisma.hatirlatma.count()]
    const once = await sayilar()
    const r2 = await ISLER['takvim-guncelle'](bugun)
    expect(r2.ozet).toContain('eklenen: 0, güncellenen: 0, iptal: 0')
    expect(await sayilar()).toEqual(once)
    expect(r2.ayrinti).toBeUndefined()
  })

  it('takvim işi: bekleyen ve hesaplanan artış telafi çalışmalarında çoğalmaz', async () => {
    const id = await aktif({ baslangic: '2025-11-01', bitis: '2027-10-31' }, t('2025-11-01'))
    const bugun = t('2026-10-20')
    const kayitSayilari = async () => [await prisma.artisHesabi.count(), await prisma.olayGunlugu.count({ where: { eylem: 'ARTIS_HESAPLA' } })]

    // Endeks yayımlanmadan: artış BEKLEMEDE; yeniden çalıştırma satırı ve denetim kaydını çoğaltmaz.
    expect((await ISLER['takvim-guncelle'](bugun)).ozet).toContain('artış hesaplanan: 0, endeks bekleyen: 1')
    expect(await kayitSayilari()).toEqual([1, 1])
    expect((await ISLER['takvim-guncelle'](bugun)).ozet).toContain('artış hesaplanan: 0, endeks bekleyen: 1')
    expect(await kayitSayilari()).toEqual([1, 1])

    // Endeks onaylanınca ilk çalışma hesaplar; sonrakiler hesaplanmış artışa dokunmaz.
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.20') }, TEST_BAGLAMI, bugun)
    expect((await ISLER['takvim-guncelle'](bugun)).ozet).toContain('artış hesaplanan: 1, endeks bekleyen: 0')
    const once = await kayitSayilari()
    expect((await ISLER['takvim-guncelle'](bugun)).ozet).toContain('artış hesaplanan: 0, endeks bekleyen: 0')
    expect(await kayitSayilari()).toEqual(once)
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })).durum).toBe('HESAPLANDI')
  })

  it('takvim işi: planı üretilemeyen sözleşme (IsKuraliHatasi) bildirilir, diğer sözleşmeler işlenir', async () => {
    const uzun = { baslangic: '2026-01-01', bitis: null }
    const iyi = await aktif(uzun)
    const bozuk = await aktif(uzun)
    // Kira dönemi olmayan sözleşmenin taksit planı üretilemez (DONEM_DISI).
    await prisma.kiraDonemi.deleteMany({ where: { sozlesmeId: bozuk } })
    const bozukNo = (await prisma.sozlesme.findUniqueOrThrow({ where: { id: bozuk } })).sozlesmeNo
    const [iyiOnce, bozukOnce] = [await prisma.taksit.count({ where: { sozlesmeId: iyi } }), await prisma.taksit.count({ where: { sozlesmeId: bozuk } })]

    const r = await ISLER['takvim-guncelle'](t('2026-10-15'))
    expect(await prisma.taksit.count({ where: { sozlesmeId: iyi } })).toBeGreaterThan(iyiOnce)
    expect(await prisma.taksit.count({ where: { sozlesmeId: bozuk } })).toBe(bozukOnce)
    expect(r.ozet).toContain('hata: 1')
    expect(r.ayrinti).toContain(bozukNo)
    expect(r.hatali).toBeUndefined()
  })

  it('takvim işi: çakışan sözleşmenin (CakismaHatasi) yazıları geri alınır, diğerleri işlenir', async () => {
    const uzun = { baslangic: '2026-01-01', bitis: null }
    const iyi = await aktif(uzun)
    const cakisan = await aktif(uzun)
    const sayi = (sozlesmeId: number) => prisma.taksit.count({ where: { sozlesmeId } })
    const [iyiOnce, cakisanOnce] = [await sayi(iyi), await sayi(cakisan)]
    sahte.cakisan = cakisan

    const r = await ISLER['takvim-guncelle'](t('2026-10-15'))
    // Gerçek plan güncellemesi çakışan sözleşmede yeni taksitler yazdı; hata sonrası hepsi geri alınmış olmalı.
    expect(await sayi(cakisan)).toBe(cakisanOnce)
    expect(await sayi(iyi)).toBeGreaterThan(iyiOnce)
    expect(r.ozet).toContain('hata: 1')

    // Çakışma geçicidir: sonraki çalışmada sözleşme işlenir.
    sahte.cakisan = null
    const sonraki = await ISLER['takvim-guncelle'](t('2026-10-15'))
    expect(await sayi(cakisan)).toBeGreaterThan(cakisanOnce)
    expect(sonraki.ayrinti).toBeUndefined()
  })

  it('takvim işi başka kopya çalışırken atlanır', async () => {
    const [a, b] = await Promise.all([
      tekKopya('takvim-guncelle', async () => { await bekle(400); return 1 }),
      (async () => { await bekle(100); return ISLER['takvim-guncelle'](t('2026-10-15')) })(),
    ])
    expect(a.calisti).toBe(true)
    expect(b.atlandi).toBe(true)
  })

  it('hatırlatma işi özeti sayıları taşır ve idempotenttir', async () => {
    await aktif({ baslangic: '2026-01-01', bitis: null })
    const bugun = t('2026-10-15')
    const r1 = await ISLER['hatirlatma-uret'](bugun)
    expect(r1.ozet).toMatch(/^yeni: [1-9]\d*, güncellenen: 0, kapanan: 0$/)
    expect(await ISLER['hatirlatma-uret'](bugun)).toEqual({ ozet: 'yeni: 0, güncellenen: 0, kapanan: 0' })
  })

  it('EVDS anahtarı yoksa endeks işi atlanır', async () => {
    const r = await ISLER['endeks-cek'](t('2026-10-15'))
    expect(r.atlandi).toBe(true)
  })

  it('endeks işi: tam veri bekleyen endeks yazar, hatırlatmayı tazeler; tekrar çalıştırma değişiklik yapmaz', async () => {
    await prisma.endeksDegeri.deleteMany()
    sahte.anahtar = 'gizli-anahtar-123'
    vi.stubGlobal('fetch', evdsYaniti(23))
    const r1 = await ISLER['endeks-cek'](t('2026-10-15'))
    expect(r1.ozet).toContain('oluşturulan: 8, güncellenen: 0, atlanan: 0, hata: 0')
    expect(r1.ozet).toContain('hatırlatma yeni: ')
    expect([r1.atlandi, r1.hatali, r1.ayrinti]).toEqual([undefined, undefined, undefined])
    expect(await prisma.hatirlatma.count({ where: { kural: 'H4' } })).toBeGreaterThan(0)
    const r2 = await ISLER['endeks-cek'](t('2026-10-15'))
    expect(r2.ozet).toBe('oluşturulan: 0, güncellenen: 0, atlanan: 0, hata: 0')
  })

  it('endeks işi: yayımlanmamış aylar atlanan olarak özette ve pano uyarısında görünür', async () => {
    await prisma.endeksDegeri.deleteMany()
    sahte.anahtar = 'gizli-anahtar-123'
    vi.stubGlobal('fetch', evdsYaniti(22))
    expect(await isCalistir('endeks-cek', () => ISLER['endeks-cek'](t('2026-10-15')))).toBe('BASARILI')
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    const kayit = await prisma.isCalisma.findFirstOrThrow({ where: { isAdi: 'endeks-cek' } })
    expect(kayit.ozet).toContain('oluşturulan: 4, güncellenen: 0, atlanan: 4, hata: 0')
    expect(kayit.hata).toContain('2026-09')
    const uyarilar = await saglikDurumu()
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('2026-09')
  })

  it('endeks işi: EVDS hatası HATALI kaydı ve pano uyarısı üretir; anahtar hiçbir yere yazılmaz', async () => {
    const anahtar = 'gizli-anahtar-123'
    sahte.anahtar = anahtar
    const konsol = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      vi.stubGlobal('fetch', (async () => { throw new Error(`bağlantı reddedildi (key: ${anahtar})`) }) as typeof fetch)
      expect(await isCalistir('endeks-cek', () => ISLER['endeks-cek'](t('2026-10-15')))).toBe('HATALI')
      vi.stubGlobal('fetch', (async () => new Response('hata', { status: 500 })) as typeof fetch)
      expect(await isCalistir('endeks-cek', () => ISLER['endeks-cek'](t('2026-10-15')))).toBe('HATALI')
      await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
      await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))

      const kayitlar = await prisma.isCalisma.findMany({ where: { isAdi: 'endeks-cek' }, orderBy: { id: 'asc' } })
      expect(kayitlar.map((k) => k.durum)).toEqual(['HATALI', 'HATALI'])
      expect(kayitlar[0]!.hata).toContain('EVDS\'e ulaşılamadı')
      expect(kayitlar[0]!.ozet).toContain('oluşturulan: 0, güncellenen: 0, atlanan: 0, hata: 4')
      expect(kayitlar[1]!.hata).toContain('EVDS 500 döndü')
      const uyarilar = await saglikDurumu()
      expect(uyarilar).toHaveLength(1)
      expect(uyarilar[0]).toContain('EVDS 500 döndü')

      const tumu = JSON.stringify([kayitlar, uyarilar, konsol.mock.calls])
      expect(tumu).not.toContain(anahtar)
    } finally {
      konsol.mockRestore()
    }
  })
})
