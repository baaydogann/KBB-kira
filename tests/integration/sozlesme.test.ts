import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { prisma, type Tx } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { sozlesmeAktiflestir, sozlesmeOnizle, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { taksitPlaniniGuncelle } from '@/server/taksit/servis'
import { CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { ornekIban, ornekKisi } from './ornekler'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

const BUGUN = t('2026-01-01')
let h: Hazirlik

beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

async function aktifSozlesme(ek: Record<string, unknown> = {}): Promise<number> {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
  return id
}

/** Plan güncellemesi sözleşmeyi okuduktan hemen sonra, başka bir bağlantıdan araya girilmesini taklit eder. */
function okumadanSonra(tx: Tx, araya: () => Promise<unknown>): Tx {
  let girildi = false
  return new Proxy(tx, {
    get(hedef, ad) {
      const deger: unknown = Reflect.get(hedef, ad)
      if (ad !== 'sozlesme') return typeof deger === 'function' ? deger.bind(hedef) : deger
      return new Proxy(deger as Tx['sozlesme'], {
        get(delege, yontem) {
          const f: unknown = Reflect.get(delege, yontem)
          if (yontem !== 'findUnique') return f
          return async (...argumanlar: unknown[]) => {
            const sonuc: unknown = await Reflect.apply(f as (...a: unknown[]) => unknown, delege, argumanlar)
            if (!girildi) {
              girildi = true
              await araya()
            }
            return sonuc
          }
        },
      })
    },
  })
}

/** Başka bir oturum satır kilidinde bekleyene kadar bekler (pg_stat_activity). */
async function kilitBekleyeniBekle(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [satir] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`
    if (satir !== undefined && satir.n > 0n) return
    await new Promise((coz) => setTimeout(coz, 50))
  }
  throw new Error('Kilit bekleyen oturum görülmedi.')
}

describe('taslak', () => {
  it('kaydeder; ekonomik kodu taşınmaz amacından varsayar; malikleri yazar', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id }, include: { malikler: true } })
    expect(s.durum).toBe('TASLAK')
    expect(s.ekonomikKod).toBe('03.5.5.05')
    expect(s.ilkKiraBaslangici.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(s.malikler).toHaveLength(1)
  })

  it('şema hisse toplamını, tarih sırasını ve sabit oranı denetler', () => {
    expect(() => girdi(h, { malikler: [{ kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null }] })).toThrow(ZodError)
    expect(() => girdi(h, { bitis: '2025-01-01' })).toThrow(ZodError)
    expect(() => girdi(h, { artisKurali: 'SABIT' })).toThrow(ZodError)
    expect(() => girdi(h, { gecisTarihi: '2026-06-01' })).toThrow(ZodError)
    expect(() => girdi(h, { bedelTutari: '10000.00' })).toThrow(ZodError)
  })

  it('aynı sözleşme numarası ve eski sürüm reddedilir', async () => {
    const g = girdi(h)
    const id = await sozlesmeTaslakKaydet(g, TEST_BAGLAMI)
    await expect(sozlesmeTaslakKaydet({ ...g }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    await sozlesmeTaslakKaydet({ ...g, notlar: 'x' }, TEST_BAGLAMI, id, 0)
    await expect(sozlesmeTaslakKaydet(g, TEST_BAGLAMI, id, 0)).rejects.toBeInstanceOf(CakismaHatasi)
  })

  it('önizleme malik bazında stopajlı netleri verir', async () => {
    const r = await sozlesmeOnizle(girdi(h, {
      malikler: [
        { kisiId: h.kisiA, pay: 2, payda: 3, ibanId: h.ibanA, vekilKisiId: null },
        { kisiId: h.kisiB, pay: 1, payda: 3, ibanId: h.ibanB, vekilKisiId: null },
      ],
    }), BUGUN)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.satirlar).toHaveLength(12)
    expect(r.satirlar[0]!.malikler.map((m) => [m.brut, m.stopaj, m.net])).toEqual([['6666.67', '1333.33', '5333.34'], ['3333.33', '666.67', '2666.66']])
  })
})

describe('aktifleştirme ve taksit planı', () => {
  it('IBAN eksikse aktifleşmez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { malikler: [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: null, vekilKisiId: null }] }), TEST_BAGLAMI)
    await expect(sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('başka kişinin IBAN\'ı seçilmişse aktifleşmez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { malikler: [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanB, vekilKisiId: null }] }), TEST_BAGLAMI)
    await expect(sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('aktifleşir; ilk kira dönemi ve taksit planı (TBK 347: bitişten sonra ufka kadar) oluşur; tekrar çalıştırma değişiklik yapmaz', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id }, include: { kiraDonemleri: true, taksitler: { orderBy: { donemBaslangic: 'asc' } } } })
    expect(s.durum).toBe('AKTIF')
    expect(s.kiraDonemleri.map((k) => [k.kaynak, k.bedelTutari.toFixed(2), k.bitis])).toEqual([['ILK', '10000.00', null]])
    // I1: 12 aylık sözleşme dönemi + uzayacağı varsayılan 13 ay (TAKVIM_UFUK_AY: 2028-01'e kadar).
    expect(s.taksitler).toHaveLength(25)
    expect(s.taksitler.every((x) => x.tutar.toFixed(2) === '10000.00' && x.durum === 'PLANLANDI')).toBe(true)
    expect(s.taksitler[0]!.vadeTarihi.toISOString().slice(0, 10)).toBe('2026-01-01')
    const goruntu = s.taksitler[0]!.hesapGoruntusu as { surum: string; artisBekleniyor: boolean; satirlar: unknown[] }
    expect(goruntu.surum).toBe('F1-1')
    expect(goruntu.artisBekleniyor).toBe(false)
    const ikinci = await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, BUGUN))
    expect(ikinci).toEqual({ eklenen: 0, guncellenen: 0, iptal: 0, gecmisDokunulmadi: 0 })
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'sozlesme', varlikId: String(id), eylem: 'AKTIFLESTIR' } })).toBe(1)
  })

  it('yıllık bedel 3 aylık ödemede kuruş artığını kira yılının son taksitine koyar', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { bedelTutari: '100.000,01', bedelTabani: 'YILLIK', odemePeriyoduAy: 3 }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    const tutarlar = (await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })).map((x) => x.tutar.toFixed(2))
    // I1: her kira yılının son taksiti artığı alır (plan ufka, 2028-01'e kadar sürer).
    expect(tutarlar).toEqual(['25000.00', '25000.00', '25000.00', '25000.01', '25000.00', '25000.00', '25000.00', '25000.01', '25000.00'])
  })

  it('Review Focus #1: yarı yoldaki sözleşme göçü geçmişi ödenmiş sayar, gecikmiş üretmez', async () => {
    const bugun = t('2026-10-15')
    const id = await sozlesmeTaslakKaydet(girdi(h, {
      baslangic: '2019-03-01', bitis: '2027-02-28', bedelTutari: '5.000,00',
      gecisTarihi: '2026-03-01', gecisBedeli: '14.500,00', odenmisSayilanSonTarih: '2026-10-31',
    }), TEST_BAGLAMI, undefined, undefined, bugun)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect(sozlesme.ilkKiraBaslangici.toISOString().slice(0, 10)).toBe('2019-03-01')
    const kd = await prisma.kiraDonemi.findMany({ where: { sozlesmeId: id }, orderBy: { baslangic: 'asc' } })
    expect(kd.map((k) => [k.kaynak, k.baslangic.toISOString().slice(0, 10), k.bitis?.toISOString().slice(0, 10) ?? null, k.bedelTutari.toFixed(2)]))
      .toEqual([['ILK', '2019-03-01', '2026-02-28', '5000.00'], ['ELLE', '2026-03-01', null, '14500.00']])
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    // I1: işyeri sözleşmesi bitişten (2027-02) sonra ufka (2028-10) kadar planlanır.
    expect(taksitler).toHaveLength(116)
    expect(taksitler.filter((x) => x.durum === 'ODENDI')).toHaveLength(92)
    expect(taksitler.filter((x) => x.durum === 'ODENDI').every((x) => x.odemeTarihi === null)).toBe(true)
    const planli = taksitler.filter((x) => x.durum === 'PLANLANDI')
    expect(planli.map((x) => x.donemBaslangic.toISOString().slice(0, 7)).slice(0, 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect([planli.length, planli.at(-1)!.donemBaslangic.toISOString().slice(0, 7)]).toEqual([24, '2028-10'])
    expect(planli.every((x) => x.tutar.toFixed(2) === '14500.00')).toBe(true)
    expect(planli.filter((x) => x.vadeTarihi < new Date('2026-10-15'))).toHaveLength(0)
  })

  it('yenileme sözleşmesi aktifleşince önceki sözleşme kapanır ve çakışan planlı taksitleri iptal olur', async () => {
    const eskiId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-01-01', bitis: '2026-12-31' }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(eskiId, 0, TEST_BAGLAMI, BUGUN)
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-07-01', bitis: '2027-06-30', ilkKiraBaslangici: '2026-01-01' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    await sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)
    const eski = await prisma.sozlesme.findUniqueOrThrow({ where: { id: eskiId } })
    expect(eski.durum).toBe('SONA_ERDI')
    expect(eski.bitis?.toISOString().slice(0, 10)).toBe('2026-06-30')
    expect(await prisma.taksit.count({ where: { sozlesmeId: eskiId, durum: 'PLANLANDI' } })).toBe(6)
    // I1: 2026-07..2026-12 ve ufka kadar planlanan 2027-01..2028-01.
    expect(await prisma.taksit.count({ where: { sozlesmeId: eskiId, durum: 'IPTAL' } })).toBe(19)
  })
})

// Aşağıdaki testler brief'in dışındadır: dispatch'teki Task 15/17 kararlarının ve veritabanı kısıtlarının sözleşme servisindeki karşılığı.
describe('sürüm kilidi ve denetim (KVKK)', () => {
  it('mevcut taslak sürümsüz güncellenemez (iyimser kilit sessizce düşmez)', async () => {
    const g = girdi(h)
    const id = await sozlesmeTaslakKaydet(g, TEST_BAGLAMI)
    await expect(sozlesmeTaslakKaydet({ ...g, notlar: 'x' }, TEST_BAGLAMI, id)).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'VERSION' })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version).toBe(0)
  })

  it('olmayan taslak güncellenemez; aktif sözleşme taslak ekranından düzenlenemez', async () => {
    await expect(sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI, 999_999, 0)).rejects.toMatchObject({ name: 'BulunamadiHatasi' })
    const g = girdi(h)
    const id = await sozlesmeTaslakKaydet(g, TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    await expect(sozlesmeTaslakKaydet(g, TEST_BAGLAMI, id, 1)).rejects.toMatchObject({ kod: 'DURUM' })
  })

  it('denetim satırları serbest metni ve kimlik değerlerini içermez; değişen alan adını yazar', async () => {
    const g = girdi(h, { notlar: 'Ahmet Yılmaz 0532 111 22 33 ile görüşüldü' })
    const id = await sozlesmeTaslakKaydet(g, TEST_BAGLAMI)
    await sozlesmeTaslakKaydet({ ...g, notlar: 'Mehmet Kaya adresi: Örnek Mah.' }, TEST_BAGLAMI, id, 0)
    await sozlesmeAktiflestir(id, 1, TEST_BAGLAMI, BUGUN)
    const kayitlar = await prisma.olayGunlugu.findMany({ where: { varlik: 'sozlesme', varlikId: String(id) }, orderBy: { id: 'asc' } })
    expect(kayitlar.map((k) => k.eylem)).toEqual(['OLUSTUR', 'GUNCELLE', 'AKTIFLESTIR'])
    const metin = JSON.stringify(kayitlar)
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    for (const yasak of ['Ahmet', 'Yılmaz', '0532', 'Mehmet', 'Örnek Mah.', kisi.tckn!, kisi.soyad!, iban.iban]) expect(metin).not.toContain(yasak)
    const guncelle = kayitlar[1]!.sonra as { degisenAlanlar: string[]; malikler: unknown[] }
    expect(guncelle.degisenAlanlar).toEqual(['notlar'])
    expect(guncelle.malikler).toEqual([{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null }])
  })
})

describe('IBAN sahipliği (sunucu tarafı)', () => {
  it('pasif IBAN ile aktifleşmez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await prisma.iban.update({ where: { id: h.ibanA }, data: { aktif: false } })
    await expect(sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'IBAN' })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum).toBe('TASLAK')
  })

  it('vekil varsa ödeme vekilin IBAN\'ına gider: vekilin IBAN\'ı kabul, malikin kendi IBAN\'ı red', async () => {
    const vekil = await ornekKisi()
    const vekilIban = await ornekIban(vekil.id)
    const vekilli = (ibanId: number) => [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId, vekilKisiId: vekil.id }]
    const yanlis = await sozlesmeTaslakKaydet(girdi(h, { malikler: vekilli(h.ibanA) }), TEST_BAGLAMI)
    await expect(sozlesmeAktiflestir(yanlis, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'IBAN' })
    const dogru = await sozlesmeTaslakKaydet(girdi(h, { malikler: vekilli(vekilIban.id) }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(dogru, 0, TEST_BAGLAMI, BUGUN)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: dogru } })).durum).toBe('AKTIF')
  })

  it('kesirli hisseler (1/2 + 1/3 + 1/6) veritabanı hisse kısıtından geçer', async () => {
    const c = await ornekKisi()
    const ic = await ornekIban(c.id)
    const id = await sozlesmeTaslakKaydet(girdi(h, {
      malikler: [
        { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
        { kisiId: h.kisiB, pay: 1, payda: 3, ibanId: h.ibanB, vekilKisiId: null },
        { kisiId: c.id, pay: 1, payda: 6, ibanId: ic.id, vekilKisiId: null },
      ],
    }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    expect(await prisma.sozlesmeMalik.count({ where: { sozlesmeId: id } })).toBe(3)
  })
})

describe('aktifleştirme koruması', () => {
  it('eski sürümle ve taslak olmayan sözleşmede aktifleşmez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await expect(sozlesmeAktiflestir(id, 7, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    await expect(sozlesmeAktiflestir(id, 1, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'DURUM' })
    await expect(sozlesmeAktiflestir(999_999, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ name: 'BulunamadiHatasi' })
  })

  it('yenileme, önceki sözleşmenin başlangıcından önce/aynı gün başlıyorsa tüm işlem geri alınır', async () => {
    const eskiId = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(eskiId, 0, TEST_BAGLAMI, BUGUN)
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-01-01', bitis: '2027-12-31' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    await expect(sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'YENILEME', message: expect.stringContaining('başlangıcından sonraki') })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: yeniId } })).durum).toBe('TASLAK')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: eskiId } })).durum).toBe('AKTIF')
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: yeniId } })).toBe(0)
  })
})

describe('taksit planı (çekirdek değerleriyle)', () => {
  it('bitişi ay sonuna denk gelmeyen sözleşmenin son taksiti kıst gün oranıyla hesaplanır', async () => {
    // I1: bitişte kıst kesim kendiliğinden uzamayan (arsa) sözleşmede kalır; TBK 347 sözleşmesi ufka kadar tam dönemlerle planlanır.
    const id = await sozlesmeTaslakKaydet(girdi(h, { tasinmazId: h.arsaId, baslangic: '2026-01-15', bitis: '2026-12-31' }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler).toHaveLength(12)
    expect(taksitler.slice(0, 11).every((x) => x.tur === 'NORMAL' && x.tutar.toFixed(2) === '10000.00')).toBe(true)
    const son = taksitler[11]!
    expect([son.tur, son.donemBaslangic.toISOString().slice(0, 10), son.donemBitis.toISOString().slice(0, 10), son.tutar.toFixed(2)])
      .toEqual(['KIST', '2026-12-15', '2026-12-31', '5483.87'])
  })

  it('kira bedeli değişince yalnızca PLANLANDI taksitler güncellenir; ödeme sürecine girenlere dokunulmaz', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: id }, data: { bitis: new Date('2026-06-30') } })
    await prisma.kiraDonemi.create({ data: { sozlesmeId: id, baslangic: new Date('2026-07-01'), bitis: null, bedelTutari: '11000.00', bedelTabani: 'AYLIK', kaynak: 'ELLE' } })
    await prisma.taksit.updateMany({ where: { sozlesmeId: id, donemBaslangic: new Date('2026-07-01') }, data: { durum: 'ODENDI' } })
    const ozet = await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, BUGUN))
    // I1: Ağustos–Aralık ve ufka kadar planlanan 2027-01..2028-01 (13) yeniden fiyatlanır.
    expect(ozet).toEqual({ eklenen: 0, guncellenen: 18, iptal: 0, gecmisDokunulmadi: 0 })
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler.map((x) => [x.durum, x.tutar.toFixed(2)])).toEqual([
      ...Array.from({ length: 6 }, () => ['PLANLANDI', '10000.00']),
      ['ODENDI', '10000.00'],
      ...Array.from({ length: 18 }, () => ['PLANLANDI', '11000.00']),
    ])
  })
})

describe('eşzamanlılık ve bayat satır koruması (taksit planı)', () => {
  async function kiraArtisiHazirla(id: number): Promise<void> {
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: id }, data: { bitis: new Date('2026-06-30') } })
    await prisma.kiraDonemi.create({ data: { sozlesmeId: id, baslangic: new Date('2026-07-01'), bitis: null, bedelTutari: '11000.00', bedelTabani: 'AYLIK', kaynak: 'ELLE' } })
  }

  it('okumadan sonra PAKETTE olan satır yeniden fiyatlanmaz: CakismaHatasi, tüm güncelleme geri alınır', async () => {
    const id = await aktifSozlesme()
    await kiraArtisiHazirla(id)
    const araya = () => prisma.taksit.updateMany({ where: { sozlesmeId: id, donemBaslangic: new Date('2026-08-01') }, data: { durum: 'PAKETTE' } })
    await expect(prisma.$transaction((tx) => taksitPlaniniGuncelle(okumadanSonra(tx, araya), id, BUGUN))).rejects.toBeInstanceOf(CakismaHatasi)
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    // Temmuz'daki yeni fiyat da geri alındı; Ağustos PAKETTE ve eski tutarıyla kaldı (I1: ufka kadar planlanan 13 satır dahil).
    expect(taksitler.slice(6).map((x) => [x.durum, x.tutar.toFixed(2)])).toEqual([
      ['PLANLANDI', '10000.00'], ['PAKETTE', '10000.00'], ['PLANLANDI', '10000.00'], ['PLANLANDI', '10000.00'], ['PLANLANDI', '10000.00'], ['PLANLANDI', '10000.00'],
      ...Array.from({ length: 13 }, () => ['PLANLANDI', '10000.00']),
    ])
  })

  it('okumadan sonra ODENDI olan satır iptal edilmez: CakismaHatasi, tüm güncelleme geri alınır', async () => {
    // I1: bitişin kısalması planı yalnızca kendiliğinden uzamayan (arsa) sözleşmede kısaltır.
    const id = await aktifSozlesme({ tasinmazId: h.arsaId })
    await prisma.sozlesme.update({ where: { id }, data: { bitis: new Date('2026-06-30') } })
    const araya = () => prisma.taksit.updateMany({ where: { sozlesmeId: id, donemBaslangic: new Date('2026-09-01') }, data: { durum: 'ODENDI' } })
    await expect(prisma.$transaction((tx) => taksitPlaniniGuncelle(okumadanSonra(tx, araya), id, BUGUN))).rejects.toBeInstanceOf(CakismaHatasi)
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler.slice(6).map((x) => x.durum)).toEqual(['PLANLANDI', 'PLANLANDI', 'ODENDI', 'PLANLANDI', 'PLANLANDI', 'PLANLANDI'])
  })

  it('plan güncellemesi sözleşme satırını işlem sonuna kadar kilitler (F2 paket kodu da aynı kilidi almalı)', async () => {
    const id = await aktifSozlesme()
    await prisma.$transaction(async (tx) => {
      await taksitPlaniniGuncelle(tx, id, BUGUN)
      await expect(prisma.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE NOWAIT`).rejects.toThrow(/lock/i)
    })
    await expect(prisma.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE NOWAIT`).resolves.toHaveLength(1)
  })

  it('aynı sözleşme için eşzamanlı iki plan güncellemesi çakışmadan biter ve yinelenen satır üretmez', async () => {
    const id = await aktifSozlesme()
    await prisma.taksit.deleteMany({ where: { sozlesmeId: id } })
    const sonuclar = await Promise.all([1, 2].map(() => prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, BUGUN))))
    // I1: plan ufka (2028-01) kadar 25 satır.
    expect(sonuclar.map((o) => o.eklenen).sort((a, b) => a - b)).toEqual([0, 25])
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id } })
    expect(taksitler).toHaveLength(25)
    expect(new Set(taksitler.map((x) => x.donemBaslangic.toISOString())).size).toBe(25)
  })

  it('aktifleştirme sözleşme satır kilidini ilk ifadede alır: alt satır ekleyip tam kilide yükselten eşzamanlı işlemle kilitlenmez', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    let tutuyor!: () => void
    const tutuyorSoz = new Promise<void>((coz) => { tutuyor = coz })
    let birak!: () => void
    const birakSoz = new Promise<void>((coz) => { birak = coz })
    const GERI_AL = new Error('geri al')
    // Başka bir işlem sözleşmeye bağlı alt satır ekler (sözleşmede FOR KEY SHARE), sonra tam kilide (FOR UPDATE) yükselir ve geri alınır.
    const baska = prisma.$transaction(async (tx) => {
      await tx.sozlesmeMalik.create({ data: { sozlesmeId: id, kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, gecerlilikBaslangic: new Date('2026-01-01') } })
      tutuyor()
      await birakSoz
      await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
      throw GERI_AL
    }).then(() => null, (e: unknown) => e)
    await tutuyorSoz
    // Kilidi ilk ifadede almayan aktifleştirme durumu güncelleyip (FOR NO KEY UPDATE) planda FOR UPDATE'e yükselirken diğer işlemle
    // karşılıklı bekler (40P01). Doğru sıra: ilk ifade bekler, hiçbir şey tutmaz; diğer işlem bitince aktifleştirme sürer.
    const aktif = sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN).then(() => null, (e: unknown) => e)
    await kilitBekleyeniBekle()
    birak()
    expect(await baska).toBe(GERI_AL)
    expect(await aktif).toBeNull()
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum).toBe('AKTIF')
  })

  it('önceki sözleşme okunduktan sonra başkası değiştirirse yenileme aktifleşmesi CakismaHatasi ile geri alınır', async () => {
    const eskiId = await aktifSozlesme()
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-07-01', bitis: '2027-06-30', ilkKiraBaslangici: '2026-01-01' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    let birak!: () => void
    let basladi!: () => void
    const birakildi = new Promise<void>((coz) => { birak = coz })
    const basladiSozu = new Promise<void>((coz) => { basladi = coz })
    const araya = prisma.$transaction(async (tx) => {
      await tx.sozlesme.update({ where: { id: eskiId }, data: { notlar: 'araya girdi', version: { increment: 1 } } })
      basladi()
      await birakildi
    })
    try {
      await basladiSozu
      const aktif = expect(sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
      await kilitBekleyeniBekle()
      birak()
      await araya
      await aktif
    } finally {
      birak()
      await araya
    }
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: yeniId } })).durum).toBe('TASLAK')
    const eski = await prisma.sozlesme.findUniqueOrThrow({ where: { id: eskiId } })
    expect([eski.durum, eski.bitis?.toISOString().slice(0, 10)]).toEqual(['AKTIF', '2026-12-31'])
  })
})

describe('bilinmeyen kimlikler', () => {
  const durumlar: readonly [string, string, (x: Hazirlik) => Record<string, unknown>][] = [
    ['kisiId', 'KISI', (x) => ({ malikler: [{ kisiId: 999_999, pay: 1, payda: 1, ibanId: x.ibanA, vekilKisiId: null }] })],
    ['ibanId', 'IBAN', (x) => ({ malikler: [{ kisiId: x.kisiA, pay: 1, payda: 1, ibanId: 999_999, vekilKisiId: null }] })],
    ['vekilKisiId', 'VEKIL', (x) => ({ malikler: [{ kisiId: x.kisiA, pay: 1, payda: 1, ibanId: x.ibanA, vekilKisiId: 999_999 }] })],
    ['birimId', 'BIRIM', () => ({ birimId: 999_999 })],
  ]

  it.each(durumlar)('%s yoksa taslak kaydı ve önizleme IsKuraliHatasi(%s) verir; ham veritabanı hatası ve sessiz varsayılan yok', async (_ad, kod, ek) => {
    const g = girdi(h, ek(h))
    await expect(sozlesmeTaslakKaydet(g, TEST_BAGLAMI)).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod })
    await expect(sozlesmeOnizle(g, BUGUN)).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod })
    expect(await prisma.sozlesme.count()).toBe(0)
  })
})

describe('denetim özeti ve yenileme zinciri', () => {
  it('AKTIFLESTIR ve YENILEME_ILE_SONA_ERDI satırları plan özetini taşır', async () => {
    const eskiId = await aktifSozlesme()
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-07-01', bitis: '2027-06-30', ilkKiraBaslangici: '2026-01-01' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    await sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)
    const sonra = async (varlikId: number, eylem: string) =>
      (await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'sozlesme', varlikId: String(varlikId), eylem } })).sonra
    // I1: işyeri planları ufka (2028-01) kadar sürer; kesim sonrası tüm planlı satırlar iptal olur.
    expect(await sonra(eskiId, 'AKTIFLESTIR')).toEqual({ durum: 'AKTIF', plan: { eklenen: 25, guncellenen: 0, iptal: 0, gecmisDokunulmadi: 0 } })
    expect(await sonra(yeniId, 'AKTIFLESTIR')).toEqual({ durum: 'AKTIF', plan: { eklenen: 19, guncellenen: 0, iptal: 0, gecmisDokunulmadi: 0 } })
    expect(await sonra(eskiId, 'YENILEME_ILE_SONA_ERDI')).toEqual({ bitis: '2026-06-30', durum: 'SONA_ERDI', plan: { eklenen: 0, guncellenen: 0, iptal: 19, gecmisDokunulmadi: 0 } })
  })

  it('yenileme sözleşmesinin ilk kira başlangıcı öncekinden farklıysa aktifleşmez ve tümü geri alınır', async () => {
    const eskiId = await aktifSozlesme()
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-07-01', bitis: '2027-06-30' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    await expect(sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({
      kod: 'YENILEME',
      message: 'Yenileme sözleşmesinin ilk kira başlangıcı önceki sözleşmeyle aynı olmalı (TBK 344/347 süreleri).',
    })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: yeniId } })).durum).toBe('TASLAK')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: eskiId } })).durum).toBe('AKTIF')
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: yeniId } })).toBe(0)
  })

  it('yenilemede kısaltılan aralıktaki PAKETTE ve ODENDI taksitler iptal edilmez, değişmeden kalır', async () => {
    const eskiId = await aktifSozlesme()
    await prisma.taksit.updateMany({ where: { sozlesmeId: eskiId, donemBaslangic: new Date('2026-08-01') }, data: { durum: 'PAKETTE' } })
    await prisma.taksit.updateMany({ where: { sozlesmeId: eskiId, donemBaslangic: new Date('2026-09-01') }, data: { durum: 'ODENDI' } })
    const oncesi = await prisma.taksit.findMany({ where: { sozlesmeId: eskiId, durum: { in: ['PAKETTE', 'ODENDI'] } }, orderBy: { donemBaslangic: 'asc' } })
    const yeniId = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-07-01', bitis: '2027-06-30', ilkKiraBaslangici: '2026-01-01' }), TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { oncekiSozlesmeId: eskiId } })
    await sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)
    const sonrasi = await prisma.taksit.findMany({ where: { sozlesmeId: eskiId, durum: { in: ['PAKETTE', 'ODENDI'] } }, orderBy: { donemBaslangic: 'asc' } })
    expect(oncesi).toHaveLength(2)
    expect(sonrasi).toEqual(oncesi)
    const hepsi = await prisma.taksit.findMany({ where: { sozlesmeId: eskiId }, orderBy: { donemBaslangic: 'asc' } })
    expect(hepsi.map((x) => x.durum)).toEqual([
      'PLANLANDI', 'PLANLANDI', 'PLANLANDI', 'PLANLANDI', 'PLANLANDI', 'PLANLANDI', // Ocak–Haziran
      'IPTAL', 'PAKETTE', 'ODENDI', 'IPTAL', 'IPTAL', 'IPTAL', // Temmuz–Aralık
      ...Array.from({ length: 13 }, () => 'IPTAL'), // I1: ufka kadar planlanan 2027-01..2028-01
    ])
  })
})

describe('göçte yarım dönem sınırı', () => {
  it.each([
    ['2026-09-30', 91, '2026-10'],
    ['2026-10-15', 91, '2026-10'],
    ['2026-10-30', 91, '2026-10'],
    ['2026-10-31', 92, '2026-11'],
  ] as const)('ödenmiş sayılan son tarih %s: %i taksit ödendi, ilk planlı dönem %s', async (sinir, odendi, ilkPlanli) => {
    const bugun = t('2026-10-15')
    const id = await sozlesmeTaslakKaydet(girdi(h, {
      baslangic: '2019-03-01', bitis: '2027-02-28', bedelTutari: '5.000,00',
      gecisTarihi: '2026-03-01', gecisBedeli: '14.500,00', odenmisSayilanSonTarih: sinir,
    }), TEST_BAGLAMI, undefined, undefined, bugun)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler).toHaveLength(116) // I1: bitişten (2027-02) sonra ufka (2028-10) kadar
    expect(taksitler.filter((x) => x.durum === 'ODENDI')).toHaveLength(odendi)
    expect(taksitler.find((x) => x.durum === 'PLANLANDI')!.donemBaslangic.toISOString().slice(0, 7)).toBe(ilkPlanli)
    // Ödenmiş sayılanlar tek bir sürekli önek oluşturur: aralarında planlı satır yok.
    expect(taksitler.slice(0, odendi).every((x) => x.durum === 'ODENDI')).toBe(true)
    expect(taksitler.slice(odendi).every((x) => x.durum === 'PLANLANDI')).toBe(true)
  })
})
