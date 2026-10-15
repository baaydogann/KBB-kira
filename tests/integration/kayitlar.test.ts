import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { prisma } from '@/server/db'
import { kisiSemasi } from '@/server/kisi/sema'
import { ibanAktiflik, ibanEkle, kisiDetayi, kisiGorunenAd, kisiKaydet, kisiListesi, statuTeyitEt } from '@/server/kisi/servis'
import { tasinmazSemasi } from '@/server/tasinmaz/sema'
import { tasinmazKaydet, tasinmazListesi } from '@/server/tasinmaz/servis'
import { birimSemasi } from '@/server/birim/sema'
import { birimKaydet } from '@/server/birim/servis'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { ibanUret, tcknUret } from './ornekler'

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

const gercek = (n: number) => kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(n), ad: 'Ahmet', soyad: 'Yılmaz', vergiStatusu: 'GMSI_GERCEK' })

describe('kişi', () => {
  it('geçersiz TCKN ve eksik ad şemada reddedilir', () => {
    expect(() => kisiSemasi.parse({ tip: 'GERCEK', tckn: '12345678901', ad: 'A', soyad: 'B', vergiStatusu: 'GMSI_GERCEK' })).toThrow(ZodError)
    expect(() => kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', vergiStatusu: 'SIRKET' })).toThrow(ZodError)
    expect(kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', unvan: 'Örnek A.Ş.', vergiStatusu: 'SIRKET' }).unvan).toBe('Örnek A.Ş.')
  })

  it('kaydeder, aynı TCKN ikinci kez iş kuralı hatası verir, sürüm çakışmasını yakalar', async () => {
    const id = await kisiKaydet(gercek(1), TEST_BAGLAMI)
    await expect(kisiKaydet(gercek(1), TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    await kisiKaydet({ ...gercek(1), telefon: '0332 000 00 00' }, TEST_BAGLAMI, id, 0)
    await expect(kisiKaydet(gercek(1), TEST_BAGLAMI, id, 0)).rejects.toBeInstanceOf(CakismaHatasi)
    const d = await kisiDetayi(id)
    expect(d.telefon).toBe('0332 000 00 00')
    expect(kisiGorunenAd(d)).toBe('Ahmet Yılmaz')
  })

  it('IBAN normalize edilir, geçersizi reddedilir, pasifleştirilebilir', async () => {
    const id = await kisiKaydet(gercek(2), TEST_BAGLAMI)
    const bosluklu = ibanUret(5).replace(/(.{4})/g, '$1 ').toLowerCase()
    const ibanId = await ibanEkle(id, { iban: bosluklu, bankaAdi: 'Ziraat' }, TEST_BAGLAMI)
    await expect(ibanEkle(id, { iban: 'TR000000000000000000000000', bankaAdi: null }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    expect((await kisiDetayi(id)).ibanlar[0]!.iban).toBe(ibanUret(5))
    await ibanAktiflik(ibanId, false, TEST_BAGLAMI)
    expect((await kisiDetayi(id)).ibanlar[0]!.aktif).toBe(false)
  })

  it('statü teyidi ve arama', async () => {
    const id = await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(3), ad: 'Zeynep', soyad: 'Kaya', vergiStatusu: 'BASIT_USUL' }), TEST_BAGLAMI)
    await statuTeyitEt(id, true, TEST_BAGLAMI)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(true)
    expect((await kisiListesi('kaya')).map((k) => k.id)).toEqual([id])
    expect((await kisiListesi(tcknUret(3))).map((k) => k.id)).toEqual([id])
  })
})

describe('taşınmaz ve birim', () => {
  it('Türkçe m² girişini ayrıştırır ve ada/parsel ile arar', async () => {
    const birimId = await birimKaydet(birimSemasi.parse({ ad: 'Emlak ve İstimlak Dairesi', kurumsalKod: '46.01.33.01', fonksiyonelKod: '01.3.9.00' }), TEST_BAGLAMI)
    const g = tasinmazSemasi.parse({ tur: 'DEPO', kisaAd: 'Meram depo', adres: 'X Mah.', ilce: 'Meram', ada: '123', parsel: '45', m2: '1.250,50', kullananBirimId: String(birimId), kullanimAmaci: 'DEPO' })
    expect(g.m2?.toFixed(2)).toBe('1250.50')
    const id = await tasinmazKaydet(g, TEST_BAGLAMI)
    expect((await tasinmazListesi('123/45')).map((t) => t.id)).toEqual([id])
    expect(() => tasinmazSemasi.parse({ tur: 'DEPO', kisaAd: 'x', adres: 'X', ilce: 'Meram', m2: '1250.50', kullanimAmaci: 'DEPO' })).toThrow(ZodError)
  })
})

describe('sertleştirme', () => {
  const tasinmazGirdisi = (ek: Record<string, string> = {}) => ({ tur: 'DEPO', kisaAd: 'Depo', adres: 'X Mah.', ilce: 'Meram', kullanimAmaci: 'DEPO', ...ek })

  it('denetim satırlarına TCKN/VKN, ad, telefon ve adres değerleri yazılmaz; TCKN maskeli kalır, değişen alanlar görünür', async () => {
    const id = await kisiKaydet(gercek(7), TEST_BAGLAMI)
    await kisiKaydet({ ...gercek(7), ad: 'Mehmet', telefon: '0332 111 22 33', adres: 'Gizli Mah. 5' }, TEST_BAGLAMI, id, 0)
    const satirlar = await prisma.olayGunlugu.findMany({ where: { varlik: 'kisi', varlikId: String(id) }, orderBy: { id: 'asc' } })
    expect(satirlar.map((s) => s.eylem)).toEqual(['OLUSTUR', 'GUNCELLE'])
    const metin = JSON.stringify(satirlar.map((s) => [s.once, s.sonra]))
    for (const gizli of [tcknUret(7), 'Ahmet', 'Mehmet', 'Yılmaz', '0332', 'Gizli']) expect(metin).not.toContain(gizli)
    expect(satirlar[0]!.sonra).toMatchObject({ tckn: `*******${tcknUret(7).slice(-4)}` })
    expect(satirlar[1]!.sonra).toMatchObject({ degisenAlanlar: ['ad', 'telefon', 'adres'] })
  })

  it('tüzel kişide de dolu TCKN doğrulanır', () => {
    expect(() => kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', unvan: 'Örnek A.Ş.', tckn: '123', vergiStatusu: 'SIRKET' })).toThrow(ZodError)
  })

  it('sürümsüz güncelleme iyimser kilidi düşürmez, hata verir', async () => {
    const kisiId = await kisiKaydet(gercek(8), TEST_BAGLAMI)
    await expect(kisiKaydet(gercek(8), TEST_BAGLAMI, kisiId)).rejects.toBeInstanceOf(IsKuraliHatasi)
    const birim = birimSemasi.parse({ ad: 'Birim', kurumsalKod: '1', fonksiyonelKod: '2' })
    const birimId = await birimKaydet(birim, TEST_BAGLAMI)
    await expect(birimKaydet(birim, TEST_BAGLAMI, birimId)).rejects.toBeInstanceOf(IsKuraliHatasi)
    const tasinmazId = await tasinmazKaydet(tasinmazSemasi.parse(tasinmazGirdisi()), TEST_BAGLAMI)
    await expect(tasinmazKaydet(tasinmazSemasi.parse(tasinmazGirdisi()), TEST_BAGLAMI, tasinmazId)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('olmayan kayıt güncellenemez; sürüm çakışması ile karışmaz', async () => {
    await expect(kisiKaydet(gercek(9), TEST_BAGLAMI, 9999, 0)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(birimKaydet(birimSemasi.parse({ ad: 'Birim', kurumsalKod: '1', fonksiyonelKod: '2' }), TEST_BAGLAMI, 9999, 0)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(tasinmazKaydet(tasinmazSemasi.parse(tasinmazGirdisi()), TEST_BAGLAMI, 9999, 0)).rejects.toBeInstanceOf(BulunamadiHatasi)
  })

  it('olmayan kişi veya IBAN için hata verir (çıplak veritabanı hatası değil)', async () => {
    await expect(ibanEkle(9999, { iban: ibanUret(1), bankaAdi: null }, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(ibanAktiflik(9999, false, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(statuTeyitEt(9999, true, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
  })

  it('aynı IBAN aynı kişiye ikinci kez eklenemez', async () => {
    const id = await kisiKaydet(gercek(10), TEST_BAGLAMI)
    await ibanEkle(id, { iban: ibanUret(11), bankaAdi: null }, TEST_BAGLAMI)
    await expect(ibanEkle(id, { iban: ibanUret(11), bankaAdi: null }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('vergi statüsü değişince teyit sıfırlanır, aynı kalırsa korunur', async () => {
    const id = await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'BASIT_USUL' }), TEST_BAGLAMI)
    await statuTeyitEt(id, true, TEST_BAGLAMI)
    const teyitliSurum = (await kisiDetayi(id)).version
    await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'BASIT_USUL', telefon: '1' }), TEST_BAGLAMI, id, teyitliSurum)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(true)
    await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'KOOPERATIF' }), TEST_BAGLAMI, id, teyitliSurum + 1)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(false)
  })

  it('kullanan birim kimliği katı ayrıştırılır', () => {
    expect(tasinmazSemasi.parse(tasinmazGirdisi({ kullananBirimId: '7' })).kullananBirimId).toBe(7)
    expect(tasinmazSemasi.parse(tasinmazGirdisi({ kullananBirimId: '' })).kullananBirimId).toBeNull()
    for (const kotu of ['abc', '1e3', '0x10', '-1', '0', '1.5', '2147483648', '99999999999999999999']) {
      expect(() => tasinmazSemasi.parse(tasinmazGirdisi({ kullananBirimId: kotu })), kotu).toThrow(ZodError)
    }
  })

  it('alan sıfırdan büyük ve NUMERIC(12,2) sınırı içinde olmalı', () => {
    expect(tasinmazSemasi.parse(tasinmazGirdisi({ m2: '9.999.999.999,99' })).m2?.toFixed(2)).toBe('9999999999.99')
    for (const kotu of ['0', '0,00', '-5', '10.000.000.000']) {
      expect(() => tasinmazSemasi.parse(tasinmazGirdisi({ m2: kotu })), kotu).toThrow(ZodError)
    }
  })
})
