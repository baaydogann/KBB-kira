import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { prisma } from '@/server/db'
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

  it('aktifleşir; ilk kira dönemi ve 12 aylık taksit planı oluşur; tekrar çalıştırma değişiklik yapmaz', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id }, include: { kiraDonemleri: true, taksitler: { orderBy: { donemBaslangic: 'asc' } } } })
    expect(s.durum).toBe('AKTIF')
    expect(s.kiraDonemleri.map((k) => [k.kaynak, k.bedelTutari.toFixed(2), k.bitis])).toEqual([['ILK', '10000.00', null]])
    expect(s.taksitler).toHaveLength(12)
    expect(s.taksitler.every((x) => x.tutar.toFixed(2) === '10000.00' && x.durum === 'PLANLANDI')).toBe(true)
    expect(s.taksitler[0]!.vadeTarihi.toISOString().slice(0, 10)).toBe('2026-01-01')
    const goruntu = s.taksitler[0]!.hesapGoruntusu as { surum: string; artisBekleniyor: boolean; satirlar: unknown[] }
    expect(goruntu.surum).toBe('F1-1')
    expect(goruntu.artisBekleniyor).toBe(false)
    const ikinci = await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, BUGUN))
    expect(ikinci).toEqual({ eklenen: 0, guncellenen: 0, iptal: 0 })
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'sozlesme', varlikId: String(id), eylem: 'AKTIFLESTIR' } })).toBe(1)
  })

  it('yıllık bedel 3 aylık ödemede kuruş artığını kira yılının son taksitine koyar', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { bedelTutari: '100.000,01', bedelTabani: 'YILLIK', odemePeriyoduAy: 3 }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    const tutarlar = (await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })).map((x) => x.tutar.toFixed(2))
    expect(tutarlar).toEqual(['25000.00', '25000.00', '25000.00', '25000.01'])
  })

  it('Review Focus #1: yarı yoldaki sözleşme göçü geçmişi ödenmiş sayar, gecikmiş üretmez', async () => {
    const bugun = t('2026-10-15')
    const id = await sozlesmeTaslakKaydet(girdi(h, {
      baslangic: '2019-03-01', bitis: '2027-02-28', bedelTutari: '5.000,00',
      gecisTarihi: '2026-03-01', gecisBedeli: '14.500,00', odenmisSayilanSonTarih: '2026-10-31',
    }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
    const kd = await prisma.kiraDonemi.findMany({ where: { sozlesmeId: id }, orderBy: { baslangic: 'asc' } })
    expect(kd.map((k) => [k.kaynak, k.baslangic.toISOString().slice(0, 10), k.bitis?.toISOString().slice(0, 10) ?? null, k.bedelTutari.toFixed(2)]))
      .toEqual([['ILK', '2019-03-01', '2026-02-28', '5000.00'], ['ELLE', '2026-03-01', null, '14500.00']])
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler).toHaveLength(96)
    expect(taksitler.filter((x) => x.durum === 'ODENDI')).toHaveLength(92)
    const planli = taksitler.filter((x) => x.durum === 'PLANLANDI')
    expect(planli.map((x) => x.donemBaslangic.toISOString().slice(0, 7))).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
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
    expect(await prisma.taksit.count({ where: { sozlesmeId: eskiId, durum: 'IPTAL' } })).toBe(6)
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
    await expect(sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'YENILEME' })
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: yeniId } })).durum).toBe('TASLAK')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: eskiId } })).durum).toBe('AKTIF')
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: yeniId } })).toBe(0)
  })
})

describe('taksit planı (çekirdek değerleriyle)', () => {
  it('bitişi ay sonuna denk gelmeyen sözleşmenin son taksiti kıst gün oranıyla hesaplanır', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-01-15', bitis: '2026-12-31' }), TEST_BAGLAMI)
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
    expect(ozet).toEqual({ eklenen: 0, guncellenen: 5, iptal: 0 })
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler.map((x) => [x.durum, x.tutar.toFixed(2)])).toEqual([
      ...Array.from({ length: 6 }, () => ['PLANLANDI', '10000.00']),
      ['ODENDI', '10000.00'],
      ...Array.from({ length: 5 }, () => ['PLANLANDI', '11000.00']),
    ])
  })
})
