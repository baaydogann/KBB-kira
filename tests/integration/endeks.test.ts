import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Server action'lar doğrudan çağrılır: oturum ve önbellek taklit edilir, veritabanı ve servisler gerçektir.
vi.mock('@/server/auth/gerekli', () => ({
  kullaniciGerekli: async () => ({ id: 1 }),
  islemBaglami: async (k: { id: number }) => ({ kullaniciId: k.id, ip: null }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { endeksElleGirAction, endeksOnaylaAction } from '@/app/(uygulama)/endeksler/actions'
import { prisma, type Tx } from '@/server/db'
import { para } from '@/core/para'
import { ayAnahtari, ayKaydir, tarih as t, type Ay } from '@/core/tarih'
import { EvdsHatasi, evdsSerisiGetir, evdsUrl } from '@/server/endeks/evds'
import { onayliOranlariYukle } from '@/server/endeks/oranlar'
import { bekleyenEndeksler, endeksCek, endeksElleGir, endeksOnayla, endeksTablosu } from '@/server/endeks/servis'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { TEST_BAGLAMI, temizle } from './yardimci'

type Istek = { url: string; key: string | null }

/** I(ay) = 100 + (2024-10'dan beri geçen ay); EVDS biçiminde (alan adında nokta yerine alt çizgi). */
function sahteFetch(istekler: Istek[]): typeof fetch {
  return (async (girdi: string | URL | Request, ayar?: RequestInit) => {
    const url = String(girdi)
    istekler.push({ url, key: new Headers(ayar?.headers).get('key') })
    const alan = /series=([^&]+)/.exec(url)![1]!.replaceAll('.', '_')
    const items = []
    for (let k = -14; k <= 23; k++) {
      const a = ayKaydir({ yil: 2024, ay: 10 }, k)
      items.push({ Tarih: `${a.yil}-${a.ay}`, [alan]: String(100 + k), UNIXTIME: { $numberLong: '0' } })
    }
    return new Response(JSON.stringify({ totalCount: items.length, items }), { status: 200 })
  }) as typeof fetch
}

/** İstenen başlangıç-bitiş aralığını (aynı endeks kuralıyla) üretir; her pencere için veri bulunur. */
function aralikFetch(istekler: Istek[], son?: Ay): typeof fetch {
  return (async (girdi: string | URL | Request, ayar?: RequestInit) => {
    const url = String(girdi)
    istekler.push({ url, key: new Headers(ayar?.headers).get('key') })
    const m = /series=([^&]+)&startDate=01-(\d{2})-(\d{4})&endDate=01-(\d{2})-(\d{4})/.exec(url)!
    const alan = m[1]!.replaceAll('.', '_')
    const bas = { yil: Number(m[3]), ay: Number(m[2]) }
    const bit = { yil: Number(m[5]), ay: Number(m[4]) }
    const items = []
    for (let a = bas; a.yil * 12 + a.ay <= bit.yil * 12 + bit.ay; a = ayKaydir(a, 1)) {
      if (son && a.yil * 12 + a.ay > son.yil * 12 + son.ay) break
      const k = (a.yil - 2024) * 12 + (a.ay - 10)
      items.push({ Tarih: `${a.yil}-${a.ay}`, [alan]: String(1000 + k) })
    }
    return new Response(JSON.stringify({ totalCount: items.length, items }), { status: 200 })
  }) as typeof fetch
}

const yanit = (govde: BodyInit | null, status = 200, basliklar?: Record<string, string>): typeof fetch =>
  (async () => new Response(govde, { status, headers: basliklar })) as typeof fetch

const ARALIK = { bas: { yil: 2026, ay: 1 }, bit: { yil: 2026, ay: 2 } }
const getir = (fetchFn: typeof fetch, apiAnahtari = 'k', ek: { tabanUrl?: string } = {}) =>
  evdsSerisiGetir('X', ARALIK.bas, ARALIK.bit, { apiAnahtari, fetchFn, ...ek })

/** Seçilen `endeksDegeri.findUnique` okumasından hemen sonra, okuyanın göremediği bir eşzamanlı yazma yapar. */
function okumadanSonra(araya: (anahtar: { seri: string; yil: number; ay: number }) => Promise<void>): Tx {
  return new Proxy(prisma, {
    get(hedef, ozellik) {
      const deger: unknown = Reflect.get(hedef, ozellik, hedef)
      if (ozellik !== 'endeksDegeri') return typeof deger === 'function' ? deger.bind(hedef) : deger
      const model = deger as Record<string, unknown>
      return new Proxy(model, {
        get(h2, o2) {
          const d2: unknown = Reflect.get(h2, o2, h2)
          if (typeof d2 !== 'function') return d2
          if (o2 !== 'findUnique') return d2.bind(h2)
          return async (args: { where: { seri_yil_ay: { seri: string; yil: number; ay: number } } }) => {
            const okunan: unknown = await d2.call(h2, args)
            await araya(args.where.seri_yil_ay)
            return okunan
          }
        },
      })
    },
  }) as unknown as Tx
}

/** Başka bir bağlantı kilit beklemeye başlayana kadar yoklar (zamanlamaya değil gözleme dayanır). */
async function kilitBeklemesiniBekle(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [satir] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`
    if ((satir?.n ?? 0) > 0) return
    await new Promise((coz) => setTimeout(coz, 50))
  }
  throw new Error('Kilit beklemesi gözlenmedi.')
}

beforeEach(async () => {
  await temizle()
  await seedVerisiniYukle(prisma)
  await prisma.endeksDegeri.deleteMany()
})
afterAll(() => prisma.$disconnect())

describe('EVDS istemcisi', () => {
  it('URL biçimi ve anahtar başlığı', async () => {
    expect(evdsUrl('TP.GENENDEKS.T1', { yil: 2024, ay: 10 }, { yil: 2026, ay: 9 }))
      .toBe('https://evds3.tcmb.gov.tr/igmevdsms-dis/series=TP.GENENDEKS.T1&startDate=01-10-2024&endDate=01-09-2026&type=json')
    const istekler: Istek[] = []
    const m = await evdsSerisiGetir('TP.GENENDEKS.T1', { yil: 2024, ay: 10 }, { yil: 2026, ay: 9 }, { apiAnahtari: 'gizli', fetchFn: sahteFetch(istekler) })
    expect(istekler[0]!.key).toBe('gizli')
    expect(m.get('2026-09')?.toString()).toBe('123')
  })
  it('seri kodu URL parametresine sızamaz', () => {
    expect(evdsUrl('A&key=x', ARALIK.bas, ARALIK.bit)).toContain('series=A%26key%3Dx&startDate')
  })
  it('anahtar yoksa veya HTTP hatasında EvdsHatasi', async () => {
    await expect(evdsSerisiGetir('X', { yil: 2026, ay: 1 }, { yil: 2026, ay: 2 }, { apiAnahtari: '' })).rejects.toBeInstanceOf(EvdsHatasi)
    const hatali = (async () => new Response('yasak', { status: 403 })) as typeof fetch
    await expect(evdsSerisiGetir('X', { yil: 2026, ay: 1 }, { yil: 2026, ay: 2 }, { apiAnahtari: 'k', fetchFn: hatali })).rejects.toBeInstanceOf(EvdsHatasi)
  })

  it('bozuk JSON, items yok veya items dizi değil: EvdsHatasi (çökmez)', async () => {
    await expect(getir(yanit('<html>giriş</html>'))).rejects.toBeInstanceOf(EvdsHatasi)
    await expect(getir(yanit('{"mesaj":"hata"}'))).rejects.toBeInstanceOf(EvdsHatasi)
    await expect(getir(yanit('{"items":"yok"}'))).rejects.toBeInstanceOf(EvdsHatasi)
    await expect(getir(yanit('null'))).rejects.toBeInstanceOf(EvdsHatasi)
    await expect(getir(yanit('[]'))).rejects.toBeInstanceOf(EvdsHatasi)
  })

  it('ağ hatası ve zaman aşımı EvdsHatasi olur', async () => {
    const kopuk = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    await expect(getir(kopuk)).rejects.toBeInstanceOf(EvdsHatasi)
    const asili = ((_: unknown, ayar?: RequestInit) => new Promise((_coz, red) => {
      ayar?.signal?.addEventListener('abort', () => red(ayar.signal!.reason))
    })) as typeof fetch
    await expect(evdsSerisiGetir('X', ARALIK.bas, ARALIK.bit, { apiAnahtari: 'k', fetchFn: asili, zamanAsimiMs: 20 })).rejects.toBeInstanceOf(EvdsHatasi)
  })

  it('boş seri boş tablo; eksik, boş, sayı olmayan, sıfır ve bozuk tarihli satırlar atlanır', async () => {
    expect((await getir(yanit('{"totalCount":0,"items":[]}'))).size).toBe(0)
    const items = [
      { Tarih: '2026-1', X: '100.5' },
      { Tarih: '2026-2', X: null },
      { Tarih: '2026-3', X: '' },
      { Tarih: '2026-4', X: 'ND' },
      { Tarih: '2026-5', X: '0' },
      { Tarih: '2026-6', X: '-4' },
      { Tarih: '2026-13', X: '100' },
      { Tarih: 'bozuk', X: '100' },
      { Tarih: '01-07-2026', X: 101 },
      { Tarih: '2026-8' },
      null,
      'metin',
    ]
    const m = await getir(yanit(JSON.stringify({ items })))
    expect([...m].map(([k, v]) => [k, v.toString()])).toEqual([['2026-01', '100.5'], ['2026-07', '101']])
  })

  it('evds2 → evds3 yönlendirmesini izler ve anahtarı yalnızca izinli TCMB adresine gönderir', async () => {
    const adimlar: { url: string; key: string | null; redirect: RequestRedirect | undefined }[] = []
    const f = (async (girdi: string | URL | Request, ayar?: RequestInit) => {
      const url = String(girdi)
      adimlar.push({ url, key: new Headers(ayar?.headers).get('key'), redirect: ayar?.redirect })
      if (url.startsWith('https://evds2.tcmb.gov.tr/')) {
        return new Response(null, { status: 302, headers: { location: url.replace('https://evds2.tcmb.gov.tr', 'https://evds3.tcmb.gov.tr') } })
      }
      return new Response('{"items":[{"Tarih":"2026-1","X":"7"}]}', { status: 200 })
    }) as typeof fetch
    const m = await getir(f, 'gizli', { tabanUrl: 'https://evds2.tcmb.gov.tr/igmevdsms-dis' })
    expect(m.get('2026-01')?.toString()).toBe('7')
    expect(adimlar.map((a) => new URL(a.url).hostname)).toEqual(['evds2.tcmb.gov.tr', 'evds3.tcmb.gov.tr'])
    expect(adimlar.every((a) => a.key === 'gizli' && a.redirect === 'manual')).toBe(true)
  })

  it('bağıl yönlendirme izlenir; yabancı sunucuya, http\'ye, konumsuz ve sonsuz yönlendirmeye EvdsHatasi (anahtar gönderilmez)', async () => {
    const goreli = (async (girdi: string | URL | Request) => String(girdi).includes('/yeni/')
      ? new Response('{"items":[{"Tarih":"2026-1","X":"7"}]}')
      : new Response(null, { status: 301, headers: { location: '/yeni/series=X' } })) as typeof fetch
    expect((await getir(goreli)).size).toBe(1)

    for (const konum of ['https://kotu.example.com/x', 'http://evds3.tcmb.gov.tr/x', 'https://tcmb.gov.tr.kotu.example/x']) {
      const istekler: Istek[] = []
      const f = (async (girdi: string | URL | Request, ayar?: RequestInit) => {
        istekler.push({ url: String(girdi), key: new Headers(ayar?.headers).get('key') })
        return new Response(null, { status: 302, headers: { location: konum } })
      }) as typeof fetch
      await expect(getir(f, 'gizli')).rejects.toBeInstanceOf(EvdsHatasi)
      expect(istekler).toHaveLength(1)
    }

    await expect(getir(yanit(null, 302))).rejects.toBeInstanceOf(EvdsHatasi)
    const dongu = (async () => new Response(null, { status: 302, headers: { location: 'https://evds3.tcmb.gov.tr/igmevdsms-dis/series=X' } })) as typeof fetch
    await expect(getir(dongu)).rejects.toBeInstanceOf(EvdsHatasi)
  })

  it('API anahtarı hiçbir hata iletisinde geçmez', async () => {
    const anahtar = 'GIZLI-ANAHTAR-123'
    const iletisi = async (f: typeof fetch, k = anahtar): Promise<string> => {
      try {
        await getir(f, k)
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
      throw new Error('hata bekleniyordu')
    }
    const iletiler = [
      await iletisi(yanit('yasak', 403)),
      await iletisi(yanit('<html>', 200)),
      await iletisi(yanit('{}', 200)),
      await iletisi((async () => { throw new Error(`bağlantı reddedildi (key: ${anahtar})`) }) as typeof fetch),
      await iletisi((async () => new Response(null, { status: 302, headers: { location: `https://kotu.example.com/?key=${anahtar}` } })) as typeof fetch),
      await iletisi(yanit('{}', 200), 'gecersiz\nbaslik'),
    ]
    for (const m of iletiler) {
      expect(m).not.toContain(anahtar)
      expect(m).not.toContain('gecersiz')
    }
    expect(iletiler[3]).toContain('***')
  })
})

describe('endeks çekme ve onay', () => {
  it('son iki ayın oranlarını BEKLIYOR olarak yazar; tekrar çalıştırma değişiklik yapmaz', async () => {
    const istekler: Istek[] = []
    const r = await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch(istekler) })
    expect(r.hatalar).toEqual([])
    expect(r.olusturulan).toBe(8)
    const tufe = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    expect([tufe.deger.toFixed(2), tufe.onayDurumu, tufe.kaynak, tufe.evdsSeriKodu]).toEqual(['11.37', 'BEKLIYOR', 'EVDS', 'TP.GENENDEKS.T1'])
    const yillik = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_YILLIK', yil: 2026, ay: 9 } } })
    expect(yillik.deger.toFixed(2)).toBe('10.81')
    const ikinci = await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    expect([ikinci.olusturulan, ikinci.guncellenen]).toEqual([0, 0])
  })

  it('onaylanmamış değer oran tablosunda görünmez; resmi değerle onay kaynağı ELLE yapar', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    expect((await onayliOranlariYukle()).oran('TUFE_12AY_ORT', { yil: 2026, ay: 9 })).toBeNull()
    const kayit = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    await endeksOnayla(kayit.id, para('11.38'), TEST_BAGLAMI)
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: kayit.id } })
    expect([o.deger.toFixed(2), o.evdsDegeri?.toFixed(2), o.kaynak, o.onayDurumu]).toEqual(['11.38', '11.37', 'ELLE', 'ONAYLANDI'])
    const oranlar = await onayliOranlariYukle()
    expect(oranlar.oran('TUFE_12AY_ORT', { yil: 2026, ay: 9 })?.toString()).toBe('11.38')
    expect(oranlar.sonOnayliTufe12).toEqual({ yil: 2026, ay: 9 })
    await expect(endeksOnayla(kayit.id, null, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('elle giriş onaylı kayıt açar; onaylı kaydı değiştirmez', async () => {
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.20') }, TEST_BAGLAMI)
    expect((await onayliOranlariYukle()).oran('TUFE_12AY_ORT', { yil: 2026, ay: 10 })?.toString()).toBe('31.2')
    await expect(endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.30') }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    expect(ayAnahtari({ yil: 2026, ay: 10 })).toBe('2026-10')
  })
})

describe('endeks çekme: EVDS kenar durumları (toplu iş çökmez)', () => {
  const bugun = t('2026-10-15')

  it('HTTP hatası her seri/ay için hatalar\'a yazılır; anahtar özette geçmez', async () => {
    const anahtar = 'GIZLI-ANAHTAR-123'
    const r = await endeksCek(prisma, bugun, { apiAnahtari: anahtar, fetchFn: yanit('yasak', 500) })
    expect(r.hatalar).toHaveLength(4)
    expect([r.olusturulan, r.guncellenen, r.atlanan]).toEqual([0, 0, []])
    expect(JSON.stringify(r)).not.toContain(anahtar)
    expect(await prisma.endeksDegeri.count()).toBe(0)
  })

  it('bozuk JSON ve anahtarsız çalıştırma hatalar\'a yazılır', async () => {
    const bozuk = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: yanit('<html>') })
    expect(bozuk.hatalar).toHaveLength(4)
    const anahtarsiz = await endeksCek(prisma, bugun, { apiAnahtari: '', fetchFn: sahteFetch([]) })
    expect(anahtarsiz.hatalar).toHaveLength(4)
    expect(await prisma.endeksDegeri.count()).toBe(0)
  })

  it('boş seri atlanan\'a yazılır, hata sayılmaz', async () => {
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: yanit('{"totalCount":0,"items":[]}') })
    expect(r.hatalar).toEqual([])
    expect(r.atlanan).toHaveLength(8)
    expect(r.atlanan[0]).toContain('endeks değeri yok')
    expect(await prisma.endeksDegeri.count()).toBe(0)
  })

  it('kısmi seri: yayımlanmamış ay atlanır, hesaplanabilen ay yazılır', async () => {
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: aralikFetch([], { yil: 2026, ay: 8 }) })
    expect(r.hatalar).toEqual([])
    expect(r.olusturulan).toBe(4)
    expect(r.atlanan).toHaveLength(4)
    expect(r.atlanan.every((a) => a.includes('2026-09'))).toBe(true)
    const aylar = (await prisma.endeksDegeri.findMany()).map((k) => ayAnahtari({ yil: k.yil, ay: k.ay }))
    expect([...new Set(aylar)]).toEqual(['2026-08'])
  })

  it('eksik parametre yalnızca o seriyi hatalı yapar, diğer seri işlenir', async () => {
    await prisma.parametre.deleteMany({ where: { anahtar: 'EVDS_SERI_YIUFE' } })
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    expect(r.hatalar).toHaveLength(2)
    expect(r.hatalar[0]).toContain('EVDS_SERI_YIUFE')
    expect(r.olusturulan).toBe(4)
  })

  it('makul olmayan oran (veri hatası) atlanır; DB taşmaz', async () => {
    const f = (async (girdi: string | URL | Request) => {
      const alan = /series=([^&]+)/.exec(String(girdi))![1]!.replaceAll('.', '_')
      const items = []
      for (let k = -14; k <= 23; k++) {
        const a = ayKaydir({ yil: 2024, ay: 10 }, k)
        items.push({ Tarih: `${a.yil}-${a.ay}`, [alan]: k === 23 ? '99999999' : '100' })
      }
      return new Response(JSON.stringify({ items }))
    }) as typeof fetch
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: f })
    expect(r.hatalar).toEqual([])
    expect(r.atlanan.length).toBeGreaterThan(0)
    expect(r.atlanan.some((a) => a.includes('makul'))).toBe(true)
    expect(await prisma.endeksDegeri.count({ where: { deger: { gt: 1000 } } })).toBe(0)
  })

  it('onaylı değere dokunmaz', async () => {
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 }, deger: para('11.38') }, TEST_BAGLAMI)
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    expect(r.olusturulan).toBe(7)
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    expect([k.deger.toFixed(2), k.kaynak, k.onayDurumu, k.evdsDegeri]).toEqual(['11.38', 'ELLE', 'ONAYLANDI', null])
  })

  it('EVDS değeri değişirse bekleyen kayıt güncellenir', async () => {
    await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    const r = await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: aralikFetch([]) })
    expect(r.hatalar).toEqual([])
    expect(r.guncellenen).toBeGreaterThan(0)
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_YILLIK', yil: 2026, ay: 9 } } })
    expect([k.onayDurumu, k.kaynak]).toEqual(['BEKLIYOR', 'EVDS'])
    expect(k.deger.toFixed(2)).toBe('1.19')
    expect(k.evdsDegeri?.toFixed(2)).toBe('1.19')
  })

  it('TÜFE serisi hedef aya göre seçilir; baz yılları karıştırılmaz', async () => {
    const istekler: Istek[] = []
    const r = await endeksCek(prisma, t('2027-02-15'), { apiAnahtari: 'k', fetchFn: aralikFetch(istekler) })
    expect(r.hatalar).toEqual([])
    const tufe = istekler.map((i) => i.url).filter((u) => u.includes('TUKFIY2025') || u.includes('GENENDEKS'))
    expect(tufe).toHaveLength(2)
    expect(tufe.find((u) => u.includes('endDate=01-12-2026'))).toContain('series=TP.GENENDEKS.T1&')
    expect(tufe.find((u) => u.includes('endDate=01-01-2027'))).toContain('series=TP.TUKFIY2025.GENEL&')
    const kodlar = await prisma.endeksDegeri.findMany({ where: { seri: 'TUFE_YILLIK' }, orderBy: [{ yil: 'asc' }, { ay: 'asc' }] })
    expect(kodlar.map((k) => [ayAnahtari({ yil: k.yil, ay: k.ay }), k.evdsSeriKodu])).toEqual([['2026-12', 'TP.GENENDEKS.T1'], ['2027-01', 'TP.TUKFIY2025.GENEL']])
  })

  it('aynı anda iki çalıştırma çökmez ve her kaydı bir kez oluşturur', async () => {
    const [a, b] = await Promise.all([
      endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) }),
      endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) }),
    ])
    expect([...a.hatalar, ...b.hatalar]).toEqual([])
    expect(a.olusturulan + b.olusturulan).toBe(8)
    expect(await prisma.endeksDegeri.count()).toBe(8)
  })

  it('okuma ile yazma arasında onaylanan kaydın üzerine yazmaz', async () => {
    await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    let bir = true
    const db = okumadanSonra(async () => {
      if (!bir) return
      bir = false
      await prisma.endeksDegeri.updateMany({ where: { onayDurumu: 'BEKLIYOR' }, data: { onayDurumu: 'ONAYLANDI', kaynak: 'ELLE', deger: '99' } })
    })
    const r = await endeksCek(db, bugun, { apiAnahtari: 'k', fetchFn: aralikFetch([]) })
    expect(r.guncellenen).toBe(0)
    expect(r.atlanan.some((a) => a.includes('eşzamanlı'))).toBe(true)
    const kayitlar = await prisma.endeksDegeri.findMany()
    expect(kayitlar.every((k) => k.onayDurumu === 'ONAYLANDI' && k.deger.toFixed(2) === '99.00')).toBe(true)
  })

  it('okuma ile yazma arasında aynı kayıt oluşursa tekrar oluşturmaz', async () => {
    let bir = true
    const db = okumadanSonra(async (a) => {
      if (!bir) return
      bir = false
      await prisma.endeksDegeri.create({ data: { seri: a.seri as 'TUFE_12AY_ORT', yil: a.yil, ay: a.ay, deger: '99', kaynak: 'ELLE', onayDurumu: 'ONAYLANDI' } })
    })
    const r = await endeksCek(db, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    expect(r.olusturulan).toBe(7)
    expect(r.atlanan.some((a) => a.includes('eşzamanlı'))).toBe(true)
    expect(await prisma.endeksDegeri.count()).toBe(8)
    expect(await prisma.endeksDegeri.count({ where: { deger: 99 } })).toBe(1)
  })
})

describe('onay', () => {
  const bugun = t('2026-10-15')
  async function bekleyenKayit(seri: 'TUFE_12AY_ORT' | 'TUFE_YILLIK' = 'TUFE_12AY_ORT', ay = 9) {
    await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    return prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri, yil: 2026, ay } } })
  }

  it('resmi değer EVDS değeriyle aynıysa kaynak EVDS kalır; denetim satırı yazılır', async () => {
    const k = await bekleyenKayit()
    await endeksOnayla(k.id, para('11.37'), TEST_BAGLAMI)
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })
    expect([o.deger.toFixed(2), o.kaynak, o.onayDurumu, o.onayZamani !== null]).toEqual(['11.37', 'EVDS', 'ONAYLANDI', true])
    const gunluk = await prisma.olayGunlugu.findMany({ where: { varlik: 'endeks', eylem: 'ONAYLA' } })
    expect(gunluk).toHaveLength(1)
    expect(gunluk[0]!.varlikId).toBe(String(k.id))
    expect(gunluk[0]!.sonra).toMatchObject({ deger: '11.37', kaynak: 'EVDS' })
  })

  it('resmi değer olmadan onay EVDS değerini onaylar', async () => {
    const k = await bekleyenKayit()
    await endeksOnayla(k.id, null, TEST_BAGLAMI)
    expect((await onayliOranlariYukle()).oran('TUFE_12AY_ORT', { yil: 2026, ay: 9 })?.toString()).toBe('11.37')
  })

  it('kayıt yoksa BulunamadiHatasi; makul olmayan resmi değer reddedilir', async () => {
    await expect(endeksOnayla(999_999, null, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
    const k = await bekleyenKayit()
    for (const kotu of ['5000', '-100', '-250']) {
      await expect(endeksOnayla(k.id, para(kotu), TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    }
    expect((await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })).onayDurumu).toBe('BEKLIYOR')
  })

  it('aynı değeri iki kullanıcı eşzamanlı onaylarsa yalnızca biri başarılı olur', async () => {
    await endeksCek(prisma, bugun, { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    const kayitlar = await prisma.endeksDegeri.findMany({ where: { yil: 2026, ay: 9 } })
    const sonuclar = await Promise.all(kayitlar.map((k) => Promise.allSettled([
      endeksOnayla(k.id, para('12.34'), TEST_BAGLAMI),
      endeksOnayla(k.id, null, TEST_BAGLAMI),
    ])))
    for (const [a, b] of sonuclar) {
      expect([a!.status, b!.status].sort()).toEqual(['fulfilled', 'rejected'])
      const red = (a!.status === 'rejected' ? a! : b!) as PromiseRejectedResult
      expect(red.reason instanceof CakismaHatasi || red.reason instanceof IsKuraliHatasi).toBe(true)
    }
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'endeks', eylem: 'ONAYLA' } })).toBe(kayitlar.length)
  })

  it('okuma ile yazma arasında başkası onaylarsa CakismaHatasi; kaydın üzerine yazılmaz', async () => {
    const k = await bekleyenKayit()
    let bekleyen: Promise<void> | undefined
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM endeks_degeri WHERE id = ${k.id} FOR UPDATE`
      bekleyen = endeksOnayla(k.id, para('12.34'), TEST_BAGLAMI)
      bekleyen.catch(() => undefined)
      await kilitBeklemesiniBekle()
      await tx.endeksDegeri.update({ where: { id: k.id }, data: { onayDurumu: 'ONAYLANDI', kaynak: 'ELLE', deger: '20' } })
    })
    await expect(bekleyen).rejects.toBeInstanceOf(CakismaHatasi)
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })
    expect([o.deger.toFixed(2), o.kaynak]).toEqual(['20.00', 'ELLE'])
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'endeks', eylem: 'ONAYLA' } })).toBe(0)
  })

  it('okuma ile onay arasında EVDS değeri değişirse eski değer onaylanmaz', async () => {
    const k = await bekleyenKayit()
    let bekleyen: Promise<void> | undefined
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM endeks_degeri WHERE id = ${k.id} FOR UPDATE`
      bekleyen = endeksOnayla(k.id, null, TEST_BAGLAMI)
      bekleyen.catch(() => undefined)
      await kilitBeklemesiniBekle()
      await tx.endeksDegeri.update({ where: { id: k.id }, data: { deger: '15', evdsDegeri: '15' } })
    })
    await expect(bekleyen).rejects.toBeInstanceOf(CakismaHatasi)
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })
    expect([o.onayDurumu, o.deger.toFixed(2)]).toEqual(['BEKLIYOR', '15.00'])
  })
})

describe('elle giriş', () => {
  it('bekleyen EVDS kaydının üzerine yazar: ELLE/ONAYLANDI, EVDS değeri saklanır, denetim once ile yazılır', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 }, deger: para('11.50') }, TEST_BAGLAMI)
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    expect([o.deger.toFixed(2), o.evdsDegeri?.toFixed(2), o.kaynak, o.onayDurumu]).toEqual(['11.50', '11.37', 'ELLE', 'ONAYLANDI'])
    const g = await prisma.olayGunlugu.findMany({ where: { varlik: 'endeks', eylem: 'ELLE_GIR' } })
    expect(g).toHaveLength(1)
    expect(g[0]!.once).toMatchObject({ deger: '11.37', onayDurumu: 'BEKLIYOR' })
    expect(g[0]!.sonra).toMatchObject({ seri: 'TUFE_12AY_ORT', ay: '2026-09', deger: '11.5' })
  })

  it('geçersiz seri, ay, gelecek ay ve makul olmayan oran reddedilir; kayıt oluşmaz', async () => {
    const bugun = t('2026-10-15')
    const dene = (g: { seri: string; ay: Ay; deger: string }) =>
      endeksElleGir({ seri: g.seri as 'TUFE_12AY_ORT', ay: g.ay, deger: para(g.deger) }, TEST_BAGLAMI, bugun)
    await expect(dene({ seri: 'YOK', ay: { yil: 2026, ay: 9 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 13 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 0 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 1899, ay: 1 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 11 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2036, ay: 10 }, deger: '10' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 9 }, deger: '3149' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 9 }, deger: '-100' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await expect(dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 9 }, deger: '10.12345' })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await dene({ seri: 'TUFE_YILLIK', ay: { yil: 2026, ay: 10 }, deger: '10' })
    expect(await prisma.endeksDegeri.count()).toBe(1)
  })

  it('aynı ay için eşzamanlı iki giriş: biri başarılı, diğeri CakismaHatasi/IsKuraliHatasi; tek kayıt, tek denetim', async () => {
    const giris = (d: string) => endeksElleGir({ seri: 'YIUFE_YILLIK', ay: { yil: 2026, ay: 9 }, deger: para(d) }, TEST_BAGLAMI)
    const [a, b] = await Promise.allSettled([giris('20.10'), giris('20.20')])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    const red = (a.status === 'rejected' ? a : b) as PromiseRejectedResult
    expect(red.reason instanceof CakismaHatasi || red.reason instanceof IsKuraliHatasi).toBe(true)
    expect(await prisma.endeksDegeri.count()).toBe(1)
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'endeks', eylem: 'ELLE_GIR' } })).toBe(1)
  })

  it('aynı anda aynı ayı yaratan başka bir işlem varsa unique ihlali CakismaHatasi olur', async () => {
    let bekleyen: Promise<void> | undefined
    await prisma.$transaction(async (tx) => {
      await tx.endeksDegeri.create({ data: { seri: 'YIUFE_YILLIK', yil: 2026, ay: 9, deger: '20', kaynak: 'ELLE', onayDurumu: 'ONAYLANDI' } })
      bekleyen = endeksElleGir({ seri: 'YIUFE_YILLIK', ay: { yil: 2026, ay: 9 }, deger: para('21') }, TEST_BAGLAMI)
      bekleyen.catch(() => undefined)
      await kilitBeklemesiniBekle()
    })
    await expect(bekleyen).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await prisma.endeksDegeri.findFirstOrThrow()).deger.toFixed(2)).toBe('20.00')
  })

  it('okuma ile yazma arasında başkası onaylarsa bekleyen kaydın üzerine yazmaz', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    let bekleyen: Promise<void> | undefined
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM endeks_degeri WHERE id = ${k.id} FOR UPDATE`
      bekleyen = endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 }, deger: para('11.50') }, TEST_BAGLAMI)
      bekleyen.catch(() => undefined)
      await kilitBeklemesiniBekle()
      await tx.endeksDegeri.update({ where: { id: k.id }, data: { onayDurumu: 'ONAYLANDI', kaynak: 'ELLE', deger: '20' } })
    })
    await expect(bekleyen).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })).deger.toFixed(2)).toBe('20.00')
  })
})

describe('listeler', () => {
  it('bekleyenler yeniden eskiye sıralanır; tablo onaylı ve bekleyen değerleri, bu ayın elle girişini gösterir', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    await endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 10 }, deger: para('31.20') }, TEST_BAGLAMI)
    const bekleyen = await bekleyenEndeksler()
    expect(bekleyen).toHaveLength(8)
    expect(bekleyen.slice(0, 4).every((k) => k.yil === 2026 && k.ay === 9)).toBe(true)
    expect(bekleyen.slice(0, 4).map((k) => k.seri)).toEqual(['TUFE_12AY_ORT', 'TUFE_YILLIK', 'YIUFE_12AY_ORT', 'YIUFE_YILLIK'])

    const tablo = await endeksTablosu(24, t('2026-10-15'))
    expect(tablo).toHaveLength(24)
    expect(tablo[0]!.ay).toEqual({ yil: 2026, ay: 10 })
    expect(tablo[0]!.seriler.TUFE_12AY_ORT?.deger.toFixed(2)).toBe('31.20')
    expect(tablo[0]!.seriler.TUFE_YILLIK).toBeNull()
    expect(tablo[1]!.ay).toEqual({ yil: 2026, ay: 9 })
    expect(tablo[1]!.seriler.TUFE_YILLIK?.onayDurumu).toBe('BEKLIYOR')
    expect(tablo.at(-1)!.ay).toEqual({ yil: 2024, ay: 11 })
  })

  it('bu ay için kayıt yoksa tablo geçen aydan başlar', async () => {
    const tablo = await endeksTablosu(3, t('2026-10-15'))
    expect(tablo.map((s) => ayAnahtari(s.ay))).toEqual(['2026-09', '2026-08', '2026-07'])
  })
})

describe("server action'lar", () => {
  const form = (alanlar: Record<string, string>) => {
    const f = new FormData()
    for (const [ad, deger] of Object.entries(alanlar)) f.set(ad, deger)
    return f
  }
  const BOS = { hata: null, alanHatalari: {}, tamam: false }

  beforeEach(async () => {
    await prisma.kullanici.create({ data: { id: 1, kullaniciAdi: 'test', adSoyad: 'Test', sifreHash: 'x' } })
  })

  it('elle giriş: kaydeder, onaylayanı ve denetimi yazar', async () => {
    const r = await endeksElleGirAction(BOS, form({ seri: 'YIUFE_YILLIK', ay: '2026-09', deger: '%23,45' }))
    expect(r).toMatchObject({ tamam: true, hata: null })
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'YIUFE_YILLIK', yil: 2026, ay: 9 } } })
    expect([k.deger.toFixed(4), k.kaynak, k.onayDurumu, k.onaylayanId]).toEqual(['23.4500', 'ELLE', 'ONAYLANDI', 1])
    const g = await prisma.olayGunlugu.findMany({ where: { varlik: 'endeks' } })
    expect(g.map((x) => [x.eylem, x.kullaniciId])).toEqual([['ELLE_GIR', 1]])
  })

  it('elle giriş: doğrulama hataları alan hatası verir ve girilen değerleri korur', async () => {
    const dene = (alanlar: Record<string, string>) => endeksElleGirAction(BOS, form(alanlar))
    const gecerli = { seri: 'TUFE_YILLIK', ay: '2026-09', deger: '31,49' }
    for (const [alan, kotu] of [['seri', 'YOK'], ['ay', '2026-9'], ['ay', '2026-13'], ['ay', '2036-10'], ['deger', '31.49'], ['deger', '3149'], ['deger', '']] as const) {
      const girdi = { ...gecerli, [alan]: kotu }
      const r = await dene(girdi)
      expect(r.tamam).toBe(false)
      expect(Object.keys(r.alanHatalari)).toEqual([alan])
      expect(r.degerler).toMatchObject(girdi)
    }
    expect(await prisma.endeksDegeri.count()).toBe(0)
  })

  it('elle giriş: onaylı kayıt için hata verir; değerler korunur', async () => {
    await endeksElleGirAction(BOS, form({ seri: 'TUFE_YILLIK', ay: '2026-09', deger: '31,49' }))
    const r = await endeksElleGirAction(BOS, form({ seri: 'TUFE_YILLIK', ay: '2026-09', deger: '31,50' }))
    expect(r.tamam).toBe(false)
    expect(r.hata).toContain('Onaylı endeks değiştirilemez')
    expect(r.degerler).toMatchObject({ deger: '31,50' })
  })

  it('onay: geçersiz kimlik reddedilir; resmi değer biçimi ve aralığı denetlenir', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    for (const kotu of ['', 'abc', '1e3', '0x10', '-1', '99999999999999999999']) {
      expect((await endeksOnaylaAction(BOS, form({ id: kotu }))).hata).toBe('Kayıt seçilmedi.')
    }
    const bicim = await endeksOnaylaAction(BOS, form({ id: String(k.id), resmiDeger: '11.38' }))
    expect(Object.keys(bicim.alanHatalari)).toEqual(['resmiDeger'])
    expect(bicim.degerler).toMatchObject({ resmiDeger: '11.38' })
    const aralik = await endeksOnaylaAction(BOS, form({ id: String(k.id), resmiDeger: '5000' }))
    expect(Object.keys(aralik.alanHatalari)).toEqual(['resmiDeger'])
    expect((await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })).onayDurumu).toBe('BEKLIYOR')
  })

  it('onay: resmi değerle onaylar (ELLE), tekrar onay hata verir', async () => {
    await endeksCek(prisma, t('2026-10-15'), { apiAnahtari: 'k', fetchFn: sahteFetch([]) })
    const k = await prisma.endeksDegeri.findUniqueOrThrow({ where: { seri_yil_ay: { seri: 'TUFE_12AY_ORT', yil: 2026, ay: 9 } } })
    const r = await endeksOnaylaAction(BOS, form({ id: String(k.id), resmiDeger: '11,38' }))
    expect(r).toMatchObject({ tamam: true, mesaj: 'Endeks onaylandı.' })
    const o = await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: k.id } })
    expect([o.deger.toFixed(2), o.kaynak, o.onayDurumu, o.onaylayanId]).toEqual(['11.38', 'ELLE', 'ONAYLANDI', 1])
    const tekrar = await endeksOnaylaAction(BOS, form({ id: String(k.id) }))
    expect([tekrar.tamam, tekrar.hata]).toEqual([false, 'Bu endeks zaten onaylı.'])
  })
})
