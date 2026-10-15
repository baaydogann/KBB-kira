import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { prisma } from '@/server/db'
import { kisiSemasi } from '@/server/kisi/sema'
import { ibanAktiflik, ibanEkle, kisiDetayi, kisiGorunenAd, kisiKaydet, kisiKimlikIleBul, kisiListesi, statuTeyitEt } from '@/server/kisi/servis'
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
    await statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)
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
    await expect(statuTeyitEt(9999, true, { version: 0, vergiStatusu: 'SIRKET' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
  })

  it('aynı IBAN aynı kişiye ikinci kez eklenemez', async () => {
    const id = await kisiKaydet(gercek(10), TEST_BAGLAMI)
    await ibanEkle(id, { iban: ibanUret(11), bankaAdi: null }, TEST_BAGLAMI)
    await expect(ibanEkle(id, { iban: ibanUret(11), bankaAdi: null }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('vergi statüsü değişince teyit sıfırlanır, aynı kalırsa korunur', async () => {
    const id = await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'BASIT_USUL' }), TEST_BAGLAMI)
    await statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)
    const teyitliSurum = (await kisiDetayi(id)).version
    await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'BASIT_USUL', telefon: '1' }), TEST_BAGLAMI, id, teyitliSurum)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(true)
    await kisiKaydet(kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(12), ad: 'A', soyad: 'B', vergiStatusu: 'SERBEST_MESLEK' }), TEST_BAGLAMI, id, teyitliSurum + 1)
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

const basit = (n: number, ek: Record<string, string> = {}) => kisiSemasi.parse({ tip: 'GERCEK', tckn: tcknUret(n), ad: 'A', soyad: 'B', vergiStatusu: 'BASIT_USUL', ...ek })
const denetimSatirlari = (varlik: string, varlikId: number) => prisma.olayGunlugu.findMany({ where: { varlik, varlikId: String(varlikId) }, orderBy: { id: 'asc' } })

describe('statü teyidi sürüm kilidi', () => {
  it('görülen sürüm ve statü ile teyit edilir; denetim satırı statüyü ve teyit durumunu yazar', async () => {
    const id = await kisiKaydet(basit(20), TEST_BAGLAMI)
    await statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)
    const d = await kisiDetayi(id)
    expect([d.statuTeyitli, d.version]).toEqual([true, 1])
    const satir = (await denetimSatirlari('kisi', id)).find((s) => s.eylem === 'STATU_TEYIT')
    expect(satir?.sonra).toEqual({ vergiStatusu: 'BASIT_USUL', statuTeyitli: true })
  })

  it('eski sürümle teyit reddedilir, teyit ve denetim değişmez', async () => {
    const id = await kisiKaydet(basit(21), TEST_BAGLAMI)
    await kisiKaydet(basit(21, { telefon: '1' }), TEST_BAGLAMI, id, 0)
    await expect(statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(false)
    expect((await denetimSatirlari('kisi', id)).map((s) => s.eylem)).toEqual(['OLUSTUR', 'GUNCELLE'])
  })

  it('arada statü değişirse (eski statü veya eski sürümle) teyit reddedilir, teyit değişmez', async () => {
    const id = await kisiKaydet(basit(22), TEST_BAGLAMI)
    await kisiKaydet(basit(22, { vergiStatusu: 'GMSI_GERCEK' }), TEST_BAGLAMI, id, 0)
    // güncel sürüm ama ekranda görülen statü eski
    await expect(statuTeyitEt(id, true, { version: 1, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    // eski sürüm, güncel statü
    await expect(statuTeyitEt(id, true, { version: 0, vergiStatusu: 'GMSI_GERCEK' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(false)
  })

  it('teyit sürümü artırır: teyitten önce açılmış düzenleme formu çakışma verir', async () => {
    const id = await kisiKaydet(basit(23), TEST_BAGLAMI)
    await statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)
    await expect(kisiKaydet(basit(23, { telefon: '1' }), TEST_BAGLAMI, id, 0)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await kisiDetayi(id)).statuTeyitli).toBe(true)
  })
})

describe('denetim içeriği', () => {
  it('IBAN satırlarında tam IBAN yok, maskeli IBAN var', async () => {
    const kisiId = await kisiKaydet(gercek(24), TEST_BAGLAMI)
    const ibanId = await ibanEkle(kisiId, { iban: ibanUret(5).replace(/(.{4})/g, '$1 '), bankaAdi: 'Ziraat' }, TEST_BAGLAMI)
    await ibanAktiflik(ibanId, false, TEST_BAGLAMI)
    const satirlar = await denetimSatirlari('iban', ibanId)
    expect(satirlar.map((s) => s.eylem)).toEqual(['OLUSTUR', 'PASIFLESTIR'])
    const metin = JSON.stringify(satirlar.map((s) => [s.once, s.sonra]))
    expect(metin).not.toContain(ibanUret(5))
    expect(metin).not.toContain(ibanUret(5).slice(0, 12))
    const maskeli = `${'*'.repeat(22)}${ibanUret(5).slice(-4)}`
    expect(satirlar[0]!.sonra).toEqual({ kisiId, bankaAdi: 'Ziraat', iban: maskeli })
    expect(satirlar[1]!.once).toEqual({ kisiId, iban: maskeli, aktif: true })
    expect(satirlar[1]!.sonra).toEqual({ kisiId, iban: maskeli, aktif: false })
  })

  it('vergi statüsü değişimi teyidin sıfırlandığını satıra yazar', async () => {
    const id = await kisiKaydet(basit(25), TEST_BAGLAMI)
    await statuTeyitEt(id, true, { version: 0, vergiStatusu: 'BASIT_USUL' }, TEST_BAGLAMI)
    await kisiKaydet(basit(25, { vergiStatusu: 'GMSI_GERCEK' }), TEST_BAGLAMI, id, 1)
    const guncelle = (await denetimSatirlari('kisi', id)).find((s) => s.eylem === 'GUNCELLE')
    expect(guncelle?.once).toMatchObject({ vergiStatusu: 'BASIT_USUL', statuTeyitli: true })
    expect(guncelle?.sonra).toMatchObject({ vergiStatusu: 'GMSI_GERCEK', statuTeyitli: false, degisenAlanlar: ['vergiStatusu'] })
  })

  it('tüzel kişinin unvanı ve vergi dairesi açık, kimlik numarası maskeli yazılır', async () => {
    const id = await kisiKaydet(kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', unvan: 'Örnek A.Ş.', vergiDairesi: 'Meram VD', vergiStatusu: 'SIRKET' }), TEST_BAGLAMI)
    const [olustur] = await denetimSatirlari('kisi', id)
    expect(olustur!.sonra).toEqual({ tip: 'TUZEL', vergiStatusu: 'SIRKET', statuTeyitli: false, tckn: null, vkn: '******7890', unvan: 'Örnek A.Ş.', vergiDairesi: 'Meram VD' })
  })

  it('taşınmaz denetimi serbest metni yazmaz; once ve sonra aynı biçimde, değişenler listelenir', async () => {
    const girdi = { tur: 'DEPO', kisaAd: 'Depo', adres: 'X Mah.', ilce: 'Meram', kullanimAmaci: 'DEPO', m2: '1.250,50', tapuBilgisi: 'Tapu gizli-123', notlar: 'Malik Ahmet ile görüşüldü' }
    const id = await tasinmazKaydet(tasinmazSemasi.parse(girdi), TEST_BAGLAMI)
    await tasinmazKaydet(tasinmazSemasi.parse({ ...girdi, kisaAd: 'Depo 2', m2: '1.250,5', notlar: 'Yeni not gizli' }), TEST_BAGLAMI, id, 0)
    const [olustur, guncelle] = await denetimSatirlari('tasinmaz', id)
    const metin = JSON.stringify([olustur, guncelle].map((s) => [s!.once, s!.sonra]))
    for (const gizli of ['gizli', 'Ahmet', 'Yeni not']) expect(metin).not.toContain(gizli)
    expect(Object.keys(olustur!.sonra as object)).not.toContain('notlar')
    expect(Object.keys(guncelle!.once as object)).toEqual(Object.keys(olustur!.sonra as object))
    const { degisenAlanlar, ...sonra } = guncelle!.sonra as Record<string, unknown>
    expect(Object.keys(sonra)).toEqual(Object.keys(guncelle!.once as object))
    expect(degisenAlanlar).toEqual(['kisaAd', 'notlar'])
    expect(sonra).toMatchObject({ kisaAd: 'Depo 2', m2: '1250.50' })
    expect(guncelle!.once).toMatchObject({ kisaAd: 'Depo', m2: '1250.50' })
  })
})

describe('kimlik çakışması ve arama', () => {
  it('yinelenen kimlik doğru alanda bildirilir (tckn, tüzel vkn, gerçek kişinin vkn değeri)', async () => {
    await kisiKaydet(gercek(30), TEST_BAGLAMI)
    await expect(kisiKaydet(gercek(30), TEST_BAGLAMI)).rejects.toMatchObject({ name: 'IsKuraliHatasi', alan: 'tckn' })
    const tuzel = kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', unvan: 'A A.Ş.', vergiStatusu: 'SIRKET' })
    await kisiKaydet(tuzel, TEST_BAGLAMI)
    await expect(kisiKaydet({ ...tuzel, unvan: 'B A.Ş.' }, TEST_BAGLAMI)).rejects.toMatchObject({ name: 'IsKuraliHatasi', alan: 'vkn', message: 'Bu vergi kimlik numarasıyla kayıtlı bir kişi zaten var.' })
    await expect(kisiKaydet({ ...gercek(31), vkn: '1234567890' }, TEST_BAGLAMI)).rejects.toMatchObject({ name: 'IsKuraliHatasi', alan: 'vkn' })
  })

  it('kimlik numarasıyla tam eşleşme kişiyi bulur, kısmi veya olmayan numara bulmaz', async () => {
    const gercekId = await kisiKaydet(gercek(40), TEST_BAGLAMI)
    const tuzelId = await kisiKaydet(kisiSemasi.parse({ tip: 'TUZEL', vkn: '1234567890', unvan: 'A A.Ş.', vergiStatusu: 'SIRKET' }), TEST_BAGLAMI)
    expect(await kisiKimlikIleBul(tcknUret(40))).toBe(gercekId)
    expect(await kisiKimlikIleBul('1234567890')).toBe(tuzelId)
    expect(await kisiKimlikIleBul(tcknUret(41))).toBeNull()
    expect(await kisiKimlikIleBul(tcknUret(40).slice(0, 10))).toBeNull()
  })
})

describe('vergi statüsü kişi tipine uymalı', () => {
  const gercekGirdi = (vergiStatusu: string) => ({ tip: 'GERCEK', tckn: tcknUret(50), ad: 'A', soyad: 'B', vergiStatusu })
  const tuzelGirdi = (vergiStatusu: string) => ({ tip: 'TUZEL', vkn: '1234567890', unvan: 'A A.Ş.', vergiStatusu })

  it.each(['GMSI_GERCEK', 'SERBEST_MESLEK', 'TICARI_AKTIF', 'BASIT_USUL'])('gerçek kişi için %s kabul edilir', (st) => {
    expect(kisiSemasi.safeParse(gercekGirdi(st)).success).toBe(true)
  })

  it.each(['SIRKET', 'KOOPERATIF', 'VAKIF_DERNEK', 'KAMU'])('tüzel kişi için %s kabul edilir', (st) => {
    expect(kisiSemasi.safeParse(tuzelGirdi(st)).success).toBe(true)
  })

  it.each(['SIRKET', 'KOOPERATIF', 'VAKIF_DERNEK', 'KAMU'])('gerçek kişi için %s vergiStatusu alanında reddedilir', (st) => {
    const r = kisiSemasi.safeParse(gercekGirdi(st))
    expect(r.success).toBe(false)
    expect(r.error?.issues).toEqual([expect.objectContaining({ path: ['vergiStatusu'], message: 'Bu vergi statüsü gerçek kişi için seçilemez.' })])
  })

  it.each(['GMSI_GERCEK', 'SERBEST_MESLEK', 'TICARI_AKTIF', 'BASIT_USUL'])('tüzel kişi için %s vergiStatusu alanında reddedilir', (st) => {
    const r = kisiSemasi.safeParse(tuzelGirdi(st))
    expect(r.success).toBe(false)
    expect(r.error?.issues).toEqual([expect.objectContaining({ path: ['vergiStatusu'], message: 'Bu vergi statüsü tüzel kişi için seçilemez.' })])
  })
})
