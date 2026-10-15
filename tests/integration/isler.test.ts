import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// EVDS anahtarı ortamdan gelir; testler anahtarı değiştirebilsin diye ortam() yalnızca bu alanda taklit edilir.
const sahte = vi.hoisted(() => ({
  anahtar: '',
  /** Plan güncellemesi gerçek çalışır, ardından bu sözleşme için CakismaHatasi atılır (adım içi geri alma denetimi). */
  cakisan: null as number | null,
  /** Plan güncellemesi gerçek çalışır, ardından bu sözleşme için beklenmeyen (iş kuralı dışı) hata atılır. */
  patlayan: null as number | null,
  hata: new RangeError('beklenmeyen hata') as Error,
}))
vi.mock('@/server/env', async (orijinal) => {
  const m = await orijinal<typeof import('@/server/env')>()
  return { ...m, ortam: () => ({ ...m.ortam(), EVDS_API_KEY: sahte.anahtar }) }
})
vi.mock('@/server/taksit/servis', async (orijinal) => {
  const m = await orijinal<typeof import('@/server/taksit/servis')>()
  const { CakismaHatasi } = await import('@/server/hata')
  return {
    ...m,
    taksitPlaniniGuncelle: async (...a: Parameters<typeof m.taksitPlaniniGuncelle>) => {
      const ozet = await m.taksitPlaniniGuncelle(...a)
      if (a[1] === sahte.cakisan) throw new CakismaHatasi()
      if (a[1] === sahte.patlayan) throw sahte.hata
      return ozet
    },
  }
})

import { prisma } from '@/server/db'
import { para } from '@/core/para'
import { ayKaydir, tarih as t } from '@/core/tarih'
import { endeksElleGir, endeksVerisiniGetir, endeksYaz } from '@/server/endeks/servis'
import { gozetimTuru } from '@/server/isler/gozetim'
import { tekKopya, BASKA_CALISMA_MESAJI } from '@/server/isler/tek-kopya'
import { isCalistir, saglikDurumu, takiliCalismalariSupur, yurutulenCalismalariTerket, type IsSonucu } from '@/server/isler/kayit'
import { ISLER } from '@/server/isler'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
let konsol: MockInstance
beforeEach(async () => {
  konsol = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await temizle()
  h = await hazirlik()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sahte.anahtar = ''
  sahte.cakisan = null
  sahte.patlayan = null
  sahte.hata = new RangeError('beklenmeyen hata')
})
afterAll(() => prisma.$disconnect())

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Geçen ayın `gun`ü öğlen (İstanbul): EVDS bandının geçerli olduğu 3-10 arası bir gün; çalışma kayıtları ondan yeni olduğundan 26 saat kuralını bozmaz. */
function gecenAyinGunu(gun: number): Date {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 1, gun)
  d.setUTCHours(9, 0, 0, 0)
  return d
}

async function aktif(ek: Record<string, unknown> = {}, bugun = t('2026-01-01')) {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
  return id
}

const taksitSayisi = (sozlesmeId: number) => prisma.taksit.count({ where: { sozlesmeId } })

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

  it('kilidi ayrı bir işlem tutar; iş kendi bağlantılarıyla çalışır; farklı işler birbirini engellemez', async () => {
    const r = await tekKopya('bir', async () => {
      const [kilit] = await prisma.$queryRaw<{ n: bigint; benim: bigint }[]>`
        SELECT count(*) AS n, count(*) FILTER (WHERE pid = pg_backend_pid()) AS benim
        FROM pg_locks WHERE locktype = 'advisory' AND granted`
      const diger = await tekKopya('iki', async () => 'iki')
      return { n: kilit?.n, benim: kilit?.benim, diger }
    })
    // Kilit tek, işin sorgularını yürüten bağlantıdan başka bir bağlantıya (kilit tutan işleme) ait.
    expect(r).toEqual({ calisti: true, sonuc: { n: 1n, benim: 0n, diger: { calisti: true, sonuc: 'iki' } } })
  })

  it('kilit tutan işlem satır kilidi almaz: iş sürerken sözleşme satırı güncellenebilir', async () => {
    const id = await aktif()
    const r = await tekKopya('satir', async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
      }, { timeout: 5_000, maxWait: 5_000 })
      return 'tamam'
    })
    expect(r).toEqual({ calisti: true, sonuc: 'tamam' })
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

  it('günlük işin son çalışması HATALI ise 26 saat dolmadan hemen uyarır; sonraki başarılı çalışma uyarıyı kaldırır', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    expect(await saglikDurumu()).toEqual([])
    await isCalistir('hatirlatma-uret', async () => { throw new Error('veritabanı koptu') })
    const uyarilar = await saglikDurumu()
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('Hatırlatma üretimi')
    expect(uyarilar[0]).toContain('son çalışmada hata verdi: veritabanı koptu')
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    expect(await saglikDurumu()).toEqual([])
  })

  it('EVDS çekimi hatalıysa (3-10 arası) uyarır; sonraki başarılı çekim uyarıyı kaldırır; atlanan (başka çalışma) kayıt hatayı gizlemez', async () => {
    const simdi = gecenAyinGunu(5)
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 0', ayrinti: 'EVDS 500 döndü', hatali: true }))
    await isCalistir('endeks-cek', async () => ({ ozet: BASKA_CALISMA_MESAJI, atlandi: true }))
    const uyarilar = await saglikDurumu(simdi)
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('EVDS')
    expect(uyarilar[0]).toContain('EVDS 500 döndü')
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 8' }))
    expect(await saglikDurumu(simdi)).toEqual([])
  })

  it('EVDS uyarıları yalnızca ayın 3-10\'u arasında görünür; dışında H4_EKSIK hatırlatması bildirir', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 0', ayrinti: 'EVDS 500 döndü', hatali: true }))
    for (const gun of [3, 10]) expect(await saglikDurumu(gecenAyinGunu(gun))).toHaveLength(1)
    for (const gun of [1, 2, 11, 15, 28]) expect(await saglikDurumu(gecenAyinGunu(gun))).toEqual([])
    // Gün sınırı İstanbul takvimine göredir: 10'u 23:30 (UTC 20:30) pencerede, 11'i 00:30 (UTC 21:30, 10'u) dışında.
    const onuncuGun = gecenAyinGunu(10)
    const gece = (saat: number, dakika: number) => new Date(Date.UTC(onuncuGun.getUTCFullYear(), onuncuGun.getUTCMonth(), 10, saat, dakika))
    expect(await saglikDurumu(gece(20, 30))).toHaveLength(1)
    expect(await saglikDurumu(gece(21, 30))).toEqual([])
  })

  it('EVDS\'te yayımlanmamış (atlanan) endeksler ve takvim işinin sözleşme hataları uyarı olarak görünür', async () => {
    await isCalistir('takvim-guncelle', async () => ({ ozet: 'ok', ayrinti: 'S-1: kira bedeli tanımlı değil' }))
    await isCalistir('hatirlatma-uret', async () => ({ ozet: 'ok' }))
    await isCalistir('endeks-cek', async () => ({ ozet: 'oluşturulan: 4, atlanan: 4', ayrinti: 'TUFE_YILLIK 2026-09: eksik veri' }))
    const uyarilar = await saglikDurumu(gecenAyinGunu(5))
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

describe('takılı çalışmalar', () => {
  it('15 dakikadan eski CALISIYOR kayıtlar HATALI işaretlenir; yeniler ve biten kayıtlar kalır', async () => {
    const simdi = new Date()
    const once = (dakika: number) => new Date(simdi.getTime() - dakika * 60_000)
    await prisma.isCalisma.createMany({
      data: [
        { isAdi: 'takvim-guncelle', baslangic: once(20), durum: 'CALISIYOR' },
        { isAdi: 'endeks-cek', baslangic: once(5), durum: 'CALISIYOR' },
        { isAdi: 'hatirlatma-uret', baslangic: once(30), bitis: once(29), durum: 'BASARILI', ozet: 'ok' },
      ],
    })
    expect(await takiliCalismalariSupur(simdi)).toBe(1)
    const r = await prisma.isCalisma.findMany({ orderBy: { id: 'asc' } })
    expect(r.map((x) => [x.isAdi, x.durum, x.hata, x.bitis !== null])).toEqual([
      ['takvim-guncelle', 'HATALI', 'Süreç beklenmedik biçimde durdu (başlangıçta temizlendi).', true],
      ['endeks-cek', 'CALISIYOR', null, false],
      ['hatirlatma-uret', 'BASARILI', null, true],
    ])
    expect(await takiliCalismalariSupur(simdi)).toBe(0)
  })

  it('kapanış beklemesi dolunca yürüyen çalışma yarıda bırakılmış olarak HATALI işaretlenir', async () => {
    let birak: (r: IsSonucu) => void = () => undefined
    const calisma = isCalistir('takvim-guncelle', () => new Promise<IsSonucu>((tamam) => { birak = tamam }))
    // Kayıt açılıp süreç içi izleyiciye girene dek bekle (ilk başarılı terk 1 satır işaretler).
    await vi.waitFor(async () => { expect(await yurutulenCalismalariTerket()).toBe(1) })
    const kayit = await prisma.isCalisma.findFirstOrThrow()
    expect([kayit.durum, kayit.hata, kayit.bitis !== null]).toEqual(['HATALI', 'Kapanış bekleme süresi doldu; çalışma yarıda bırakıldı (işlem geri alındı).', true])
    expect(await yurutulenCalismalariTerket()).toBe(0)
    birak({ ozet: 'ok' })
    await calisma
    expect(await yurutulenCalismalariTerket()).toBe(0)
  })
})

describe('gözetim turu', () => {
  // 2026-10-16 12:12 İstanbul: takvim 05:30'da, hatırlatma 06:00'da zamanlandı; endeks penceresinin son çalışması 10 Ekim 17:15'te.
  const simdi = new Date('2026-10-16T09:12:00Z')
  const kayit = (isAdi: string, baslangic: string, durum: 'BASARILI' | 'HATALI' | 'CALISIYOR' | 'ATLANDI' = 'BASARILI') =>
    prisma.isCalisma.create({ data: { isAdi, baslangic: new Date(baslangic), durum, ozet: 'x' } })

  function calistirici() {
    const cagrilar: string[] = []
    return { cagrilar, calistir: async (ad: string) => { cagrilar.push(ad) } }
  }

  it('hiç çalışma yoksa üç işi takvim → endeks → hatırlatma sırasıyla çalıştırır (endeks anahtarla)', async () => {
    sahte.anahtar = 'k'
    const c = calistirici()
    const sonuc = await gozetimTuru(c.calistir, simdi)
    expect(c.cagrilar).toEqual(['takvim-guncelle', 'endeks-cek', 'hatirlatma-uret'])
    expect(sonuc.map((s) => s.karar)).toEqual(['calistirildi', 'calistirildi', 'calistirildi'])
  })

  it('zamanlanmış andan sonra başarılı çalışması olan iş çalıştırılmaz; eskisi çalıştırılır', async () => {
    sahte.anahtar = 'k'
    await kayit('takvim-guncelle', '2026-10-16T02:31:00Z')
    await kayit('hatirlatma-uret', '2026-10-15T03:00:00Z')
    await kayit('endeks-cek', '2026-10-10T14:16:00Z')
    const c = calistirici()
    const sonuc = await gozetimTuru(c.calistir, simdi)
    expect(c.cagrilar).toEqual(['hatirlatma-uret'])
    expect(sonuc.map((s) => [s.ad, s.karar])).toEqual([['takvim-guncelle', 'guncel'], ['endeks-cek', 'guncel'], ['hatirlatma-uret', 'calistirildi']])
  })

  it('HATALI ve ATLANDI çalışmalar başarı sayılmaz', async () => {
    sahte.anahtar = 'k'
    await kayit('takvim-guncelle', '2026-10-16T02:31:00Z', 'HATALI')
    await kayit('hatirlatma-uret', '2026-10-16T03:01:00Z', 'ATLANDI')
    await kayit('endeks-cek', '2026-10-10T14:16:00Z')
    const c = calistirici()
    await gozetimTuru(c.calistir, simdi)
    expect(c.cagrilar).toEqual(['takvim-guncelle', 'hatirlatma-uret'])
  })

  it('EVDS anahtarı yoksa endeks işi sessizce atlanır', async () => {
    const c = calistirici()
    const sonuc = await gozetimTuru(c.calistir, simdi)
    expect(c.cagrilar).toEqual(['takvim-guncelle', 'hatirlatma-uret'])
    expect(sonuc.find((s) => s.ad === 'endeks-cek')?.karar).toBe('anahtar-yok')
  })

  it('zamanlayıcının kendi tetiklemesine tolerans tanınır; taze CALISIYOR kaydı olan iş çalıştırılmaz, takılı olan engellemez', async () => {
    const c = calistirici()
    const sonuc = await gozetimTuru(c.calistir, new Date('2026-10-16T02:32:00Z'))
    expect(sonuc.find((s) => s.ad === 'takvim-guncelle')?.karar).toBe('bekle')
    expect(c.cagrilar).not.toContain('takvim-guncelle')

    await kayit('takvim-guncelle', '2026-10-16T09:10:00Z', 'CALISIYOR')
    await kayit('hatirlatma-uret', '2026-10-16T08:00:00Z', 'CALISIYOR')
    const d = calistirici()
    const ikinci = await gozetimTuru(d.calistir, simdi)
    expect(ikinci.map((s) => [s.ad, s.karar])).toEqual([['takvim-guncelle', 'calisiyor'], ['endeks-cek', 'anahtar-yok'], ['hatirlatma-uret', 'calistirildi']])
  })

  it('bir işin hatası diğerlerini engellemez', async () => {
    sahte.anahtar = 'k'
    const cagrilar: string[] = []
    const sonuc = await gozetimTuru(async (ad) => { cagrilar.push(ad); if (ad === 'endeks-cek') throw new Error('veritabanı koptu') }, simdi)
    expect(cagrilar).toEqual(['takvim-guncelle', 'endeks-cek', 'hatirlatma-uret'])
    expect(sonuc.map((s) => s.karar)).toEqual(['calistirildi', 'hata', 'calistirildi'])
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
    // Belirsiz süreli sözleşmenin planı yalnızca TAKVIM_UFUK_AY kadar ileri üretilir: ilerleyen tarihte yeni dönemler eklenir.
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
    const [iyiOnce, bozukOnce] = [await taksitSayisi(iyi), await taksitSayisi(bozuk)]

    const r = await ISLER['takvim-guncelle'](t('2026-10-15'))
    expect(await taksitSayisi(iyi)).toBeGreaterThan(iyiOnce)
    expect(await taksitSayisi(bozuk)).toBe(bozukOnce)
    expect(r.ozet).toContain('hata: 1')
    expect(r.ayrinti).toContain(bozukNo)
    expect(r.hatali).toBeUndefined()
    // İş kuralı hatası TAKVIM_HATA satırı doğurmaz (UZAMA_HATA / ARTIS_HESAP_HATA gibi kendi bildirimleri vardır).
    expect(await prisma.hatirlatma.count({ where: { kural: 'TAKVIM_HATA' } })).toBe(0)
  })

  it('takvim işi: artışı hesaplanamayan sözleşme ARTIS_HESAP_HATA bırakır, işlem tamamlanır; diğer sözleşmenin artışı hesaplanır', async () => {
    const bugun = t('2026-10-20')
    const bozuk = await aktif({ baslangic: '2025-11-01', bitis: '2027-10-31' }, t('2025-11-01'))
    const saglam = await aktif({ baslangic: '2025-11-01', bitis: '2027-10-31' }, t('2025-11-01'))
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.20') }, TEST_BAGLAMI, bugun)
    // Son kira döneminin bitişi geçmişte kalırsa artış tarihinden önceki gün hiçbir dönemde bulunmaz.
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: bozuk }, data: { bitis: new Date('2026-06-30') } })
    const bozukNo = (await prisma.sozlesme.findUniqueOrThrow({ where: { id: bozuk } })).sozlesmeNo

    const r = await ISLER['takvim-guncelle'](bugun)
    expect(r.ayrinti).toContain(bozukNo)
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: bozuk } })).toBe(0)
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: saglam } })).durum).toBe('HESAPLANDI')
    expect(await prisma.hatirlatma.count({ where: { kural: 'ARTIS_HESAP_HATA', sozlesmeId: bozuk } })).toBe(1)
    expect(await prisma.hatirlatma.count({ where: { kural: 'TAKVIM_HATA' } })).toBe(0)
  })

  it('takvim işi: uzama hatası UZAMA_HATA hatırlatmasını bırakır, plan hatası onu geri almaz', async () => {
    const bozuk = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await prisma.kiraDonemi.deleteMany({ where: { sozlesmeId: bozuk } })
    const r = await ISLER['takvim-guncelle'](t('2026-10-15'))
    expect(r.ozet).toContain('uzatılan: 0')
    expect(r.ozet).toContain('hata: 1')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: bozuk } })).durum).toBe('AKTIF')
    expect(await prisma.hatirlatma.count({ where: { kural: 'UZAMA_HATA', sozlesmeId: bozuk } })).toBe(1)
  })

  it('takvim işi: çakışan sözleşmenin (CakismaHatasi) plan yazıları geri alınır, diğerleri işlenir', async () => {
    // Belirsiz süreli sözleşmenin planı yalnızca TAKVIM_UFUK_AY kadar ileri üretilir: ilerleyen tarihte yeni dönemler eklenir.
    const uzun = { baslangic: '2026-01-01', bitis: null }
    const iyi = await aktif(uzun)
    const cakisan = await aktif(uzun)
    const [iyiOnce, cakisanOnce] = [await taksitSayisi(iyi), await taksitSayisi(cakisan)]
    sahte.cakisan = cakisan

    const r = await ISLER['takvim-guncelle'](t('2026-10-15'))
    // Gerçek plan güncellemesi çakışan sözleşmede yeni taksitler yazdı; hata sonrası hepsi geri alınmış olmalı.
    expect(await taksitSayisi(cakisan)).toBe(cakisanOnce)
    expect(await taksitSayisi(iyi)).toBeGreaterThan(iyiOnce)
    expect(r.ozet).toContain('hata: 1')

    // Çakışma geçicidir: sonraki çalışmada sözleşme işlenir.
    sahte.cakisan = null
    const sonraki = await ISLER['takvim-guncelle'](t('2026-10-15'))
    expect(await taksitSayisi(cakisan)).toBeGreaterThan(cakisanOnce)
    expect(sonraki.ayrinti).toBeUndefined()
  })

  it('takvim işi: beklenmeyen hata veren sözleşme geri alınır ve TAKVIM_HATA yazılır; diğer sözleşmeler uzatılır, planlanır, hesaplanır', async () => {
    const bugun = t('2026-10-20')
    const uzayan = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const patlayan = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const acik = await aktif({ baslangic: '2026-01-01', bitis: null })
    const artisli = await aktif({ baslangic: '2025-11-01', bitis: '2027-10-31' }, t('2025-11-01'))
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.20') }, TEST_BAGLAMI, bugun)
    const patlayanNo = (await prisma.sozlesme.findUniqueOrThrow({ where: { id: patlayan } })).sozlesmeNo
    const patlayanOnce = await prisma.sozlesme.findUniqueOrThrow({ where: { id: patlayan } })
    const [acikOnce, patlayanTaksit] = [await taksitSayisi(acik), await taksitSayisi(patlayan)]
    sahte.patlayan = patlayan

    const r = await ISLER['takvim-guncelle'](bugun)

    // Diğer sözleşmeler: uzatıldı, plan genişledi, artış hesaplandı.
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: uzayan } })).durum).toBe('UZADI')
    expect(await taksitSayisi(acik)).toBeGreaterThan(acikOnce)
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: artisli } })).durum).toBe('HESAPLANDI')
    // Patlayan sözleşme: uzatma dahil hiçbir yazı kalmadı (işlemin tamamı geri alındı).
    const patlayanSonra = await prisma.sozlesme.findUniqueOrThrow({ where: { id: patlayan } })
    expect([patlayanSonra.durum, patlayanSonra.version, patlayanSonra.bitis]).toEqual([patlayanOnce.durum, patlayanOnce.version, patlayanOnce.bitis])
    expect(await taksitSayisi(patlayan)).toBe(patlayanTaksit)
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'sozlesme', varlikId: String(patlayan), eylem: 'OTOMATIK_UZAMA' } })).toBe(0)

    // Özet ve kalıcı KRITIK hatırlatma; kişisel veri/yığın izi/hata metni yok, yalnızca hata sınıfı.
    expect(r.ozet).toContain('hata: 1')
    expect(r.ayrinti).toContain(`${patlayanNo}: beklenmeyen hata`)
    expect(r.hatali).toBeUndefined()
    const satirlar = await prisma.hatirlatma.findMany({ where: { kural: 'TAKVIM_HATA' } })
    expect(satirlar).toHaveLength(1)
    const s = satirlar[0]!
    expect([s.anahtar, s.iliskiliTur, s.iliskiliId, s.sozlesmeId, s.baslik, s.oncelik, s.kararGerekli, s.durum]).toEqual([
      `TAKVIM_HATA:sozlesme:${patlayan}`, 'sozlesme', String(patlayan), patlayan, `Gece işi bu sözleşmede hata verdi — ${patlayanNo}`, 'KRITIK', true, 'ACIK',
    ])
    expect(s.aciklama).toContain('Hata türü: RangeError.')
    expect(s.aciklama).not.toContain('beklenmeyen hata')
    expect(s.aciklama).not.toContain(patlayanNo)
    expect(s.aciklama).not.toMatch(/\bat \S+\(|\.ts:\d+/)
    // Günlüğe yalnızca sözleşme kimliği düşer (sözleşme numarası değil).
    const gunluk = konsol.mock.calls.find((c) => String(c[0]).includes('işlenemedi'))
    expect(String(gunluk?.[0])).toContain(`#${patlayan}`)
    expect(String(gunluk?.[0])).not.toContain(patlayanNo)

    // Yeniden çalışma: satır çoğalmaz; kullanıcı tamamlamışsa yeniden açılmaz, yalnızca açıklama güncellenir; sorun giderilince iş sürer.
    await prisma.hatirlatma.update({ where: { id: s.id }, data: { durum: 'TAMAMLANDI' } })
    sahte.hata = new TypeError('başka hata')
    await ISLER['takvim-guncelle'](bugun)
    const ikinci = await prisma.hatirlatma.findMany({ where: { kural: 'TAKVIM_HATA' } })
    expect(ikinci).toHaveLength(1)
    expect([ikinci[0]!.durum, ikinci[0]!.baslik, ikinci[0]!.aciklama]).toEqual(['TAMAMLANDI', s.baslik, expect.stringContaining('Hata türü: TypeError.')])
    sahte.patlayan = null
    const son = await ISLER['takvim-guncelle'](bugun)
    expect(son.ayrinti).toBeUndefined()
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: patlayan } })).durum).toBe('UZADI')
  })

  it('takvim işi başka kopya çalışırken atlanır ve nedenini yazar', async () => {
    const [a, b] = await Promise.all([
      tekKopya('takvim-guncelle', async () => { await bekle(400); return 1 }),
      (async () => { await bekle(100); return ISLER['takvim-guncelle'](t('2026-10-15')) })(),
    ])
    expect(a.calisti).toBe(true)
    expect(b).toEqual({ ozet: 'Başka bir çalışma sürüyor; daha sonra tekrar deneyin.', atlandi: true })
  })

  it('hatırlatma işi özeti sayıları taşır ve idempotenttir', async () => {
    await aktif({ baslangic: '2026-01-01', bitis: null })
    const bugun = t('2026-10-15')
    const r1 = await ISLER['hatirlatma-uret'](bugun)
    expect(r1.ozet).toMatch(/^yeni: [1-9]\d*, güncellenen: 0, kapanan: 0$/)
    expect(await ISLER['hatirlatma-uret'](bugun)).toEqual({ ozet: 'yeni: 0, güncellenen: 0, kapanan: 0' })
  })

  it('hatırlatma işi sözleşme satırı kilitlemez: satır başka işlemde kilitliyken de biter', async () => {
    const id = await aktif()
    let birak: () => void = () => undefined
    const serbest = new Promise<void>((tamam) => { birak = tamam })
    let kilitAlindi: () => void = () => undefined
    const hazir = new Promise<void>((tamam) => { kilitAlindi = tamam })
    const kilitleyen = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
      kilitAlindi()
      await serbest
    }, { timeout: 120_000 })
    await hazir
    try {
      // Satır kilidi isteyen bir iş burada, kilit serbest bırakılana dek (test zaman aşımına dek) takılırdı.
      await ISLER['hatirlatma-uret'](t('2026-10-15'))
    } finally {
      birak()
      await kilitleyen
    }
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

  it('endeks işi: EVDS çağrıları açık bir veritabanı işlemi sırasında yapılmaz (kilit tutan işlem hariç)', async () => {
    await prisma.endeksDegeri.deleteMany()
    sahte.anahtar = 'gizli-anahtar-123'
    const gorulen: { kilitTutan: bigint; digeri: bigint }[] = []
    const sahteEvds = evdsYaniti(23)
    vi.stubGlobal('fetch', (async (...a: Parameters<typeof fetch>) => {
      const [r] = await prisma.$queryRaw<{ kilit_tutan: bigint; digeri: bigint }[]>`
        SELECT count(*) FILTER (WHERE query LIKE '%pg_try_advisory_xact_lock%') AS kilit_tutan,
               count(*) FILTER (WHERE query NOT LIKE '%pg_try_advisory_xact_lock%') AS digeri
        FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`
      gorulen.push({ kilitTutan: r!.kilit_tutan, digeri: r!.digeri })
      return sahteEvds(...a)
    }) as typeof fetch)
    const r = await ISLER['endeks-cek'](t('2026-10-15'))
    expect(r.ozet).toContain('oluşturulan: 8')
    expect(gorulen).toHaveLength(4)
    expect(gorulen.every((g) => g.kilitTutan === 1n && g.digeri === 0n)).toBe(true)
  })

  it('endeks çekme iki adımdır: çekme hiçbir şey yazmaz, yazma tek işlemde ya hep ya hiç', async () => {
    await prisma.endeksDegeri.deleteMany()
    const veri = await endeksVerisiniGetir(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: evdsYaniti(23) })
    expect([await prisma.endeksDegeri.count(), await prisma.olayGunlugu.count({ where: { varlik: 'endeks' } })]).toEqual([0, 0])

    await expect(prisma.$transaction(async (tx) => {
      expect((await endeksYaz(tx, veri)).olusturulan).toBe(8)
      throw new Error('geri al')
    })).rejects.toThrow('geri al')
    expect([await prisma.endeksDegeri.count(), await prisma.olayGunlugu.count({ where: { varlik: 'endeks' } })]).toEqual([0, 0])

    const sonuc = await prisma.$transaction((tx) => endeksYaz(tx, veri))
    expect([sonuc.olusturulan, sonuc.guncellenen, sonuc.atlanan, sonuc.hatalar]).toEqual([8, 0, [], []])
    expect([await prisma.endeksDegeri.count(), await prisma.olayGunlugu.count({ where: { varlik: 'endeks', eylem: 'EVDS_CEK' } })]).toEqual([8, 8])
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
    const uyarilar = await saglikDurumu(gecenAyinGunu(5))
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('2026-09')
  })

  it('endeks işi: EVDS hatası HATALI kaydı ve pano uyarısı üretir; anahtar hiçbir yere yazılmaz', async () => {
    const anahtar = 'gizli-anahtar-123'
    sahte.anahtar = anahtar
    await prisma.endeksDegeri.deleteMany()
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
    const uyarilar = await saglikDurumu(gecenAyinGunu(5))
    expect(uyarilar).toHaveLength(1)
    expect(uyarilar[0]).toContain('EVDS 500 döndü')

    const tumu = JSON.stringify([kayitlar, uyarilar, konsol.mock.calls])
    expect(tumu).not.toContain(anahtar)
  })
})
