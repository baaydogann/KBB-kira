import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { genelAramaHedefi } from '@/server/kisi/arama'
import { kisiIbanIleBul, kisiKimlikIleBul } from '@/server/kisi/servis'
import {
  hatirlatmaErtele, hatirlatmalariUretVeKaydet, hatirlatmaTamamla, hatirlatmaVerisiYukle, panoVerisi,
} from '@/server/hatirlatma/servis'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { malikleriDegistir, taslakSil } from '@/server/sozlesme/yasam-dongusu'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
const BUGUN = t('2026-10-15')
const uret = (bugun = BUGUN) => prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, bugun))

beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

async function sozlesme() {
  const id = await sozlesmeTaslakKaydet(girdi(h, { vadeKurali: 'AYIN_GUNU', vadeParametresi: 20, odenmisSayilanSonTarih: null }), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
  return id
}

/** Motorun üretmediği kurallardan biriyle elle açılmış (başka servislerin yazdığı türden) kayıt. */
function motorDisiKayit(id: number, kural: string, anahtar: string) {
  return prisma.hatirlatma.create({
    data: {
      anahtar, kural, iliskiliTur: 'sozlesme', iliskiliId: String(id), sozlesmeId: id, baslik: `${kural} başlığı`, aciklama: 'açıklama',
      hedefTarih: new Date('2026-10-01'), gorunurTarih: new Date('2026-10-01'), oncelik: 'KRITIK', kararGerekli: true,
    },
  })
}

describe('hatırlatma üretimi', () => {
  it('veriden H1, H6 ve H12 üretir; ikinci çalıştırma yeni kayıt açmaz', async () => {
    const id = await sozlesme()
    const r = await uret()
    expect(r.yeni).toBeGreaterThan(0)
    const kayitlar = await prisma.hatirlatma.findMany({ where: { sozlesmeId: id } })
    const anahtarlar = kayitlar.map((k) => k.anahtar)
    expect(anahtarlar.some((a) => a.startsWith('H1:taksit:') && a.endsWith(':2026-10-20'))).toBe(true)
    expect(anahtarlar).toContain(`H6:sozlesme:${id}:2026-12-31`)
    expect(anahtarlar).toContain(`H12:sozlesme:${id}:SOZLESME_PDF_YOK`)
    expect(kayitlar.filter((k) => k.kural === 'H1' && k.oncelik === 'KRITIK')).toHaveLength(9)
    expect((await uret()).yeni).toBe(0)
  })

  it('koşul kalkınca otomatik kapanır; tamamlanan ve elle açılan kayda dokunmaz', async () => {
    const id = await sozlesme()
    await uret()
    const ekim = await prisma.taksit.findFirstOrThrow({ where: { sozlesmeId: id, donemBaslangic: new Date('2026-10-01') } })
    await prisma.taksit.update({ where: { id: ekim.id }, data: { durum: 'ODENDI' } })
    const pdf = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H12:sozlesme:${id}:SOZLESME_PDF_YOK` } })
    await hatirlatmaTamamla(pdf.id, 'PDF arşivden istendi', TEST_BAGLAMI)
    await prisma.hatirlatma.create({ data: { anahtar: 'H5_FAZLA:taksit:1:elle', kural: 'H5_FAZLA_ODEME', iliskiliTur: 'taksit', iliskiliId: '1', sozlesmeId: id, baslik: 'x', aciklama: 'x', hedefTarih: new Date('2026-10-15'), gorunurTarih: new Date('2026-10-15'), oncelik: 'KRITIK', kararGerekli: true } })
    const r = await uret()
    expect(r.kapanan).toBeGreaterThanOrEqual(1)
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H1:taksit:${ekim.id}:2026-10-20` } })).durum).toBe('OTOMATIK_KAPANDI')
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { id: pdf.id } })).durum).toBe('TAMAMLANDI')
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: 'H5_FAZLA:taksit:1:elle' } })).durum).toBe('ACIK')
  })

  it('sona ermiş sözleşmenin planlı taksiti hatırlatılmaya devam eder; sözleşme kuralları susar', async () => {
    const id = await sozlesme()
    // Bitişi geçmiş: bitişi gelmemiş SONA_ERDI sözleşme bitişine kadar yürürlükte sayılır (I2) ve H5/H12 alır.
    await prisma.sozlesme.update({ where: { id }, data: { durum: 'SONA_ERDI', bitis: new Date('2026-10-14') } })
    await uret()
    const kurallar = (await prisma.hatirlatma.findMany({ where: { sozlesmeId: id } })).map((k) => k.kural)
    expect(kurallar.filter((k) => k === 'H1')).toHaveLength(10) // 9 gecikmiş + Ekim (vade 2026-10-20)
    expect(kurallar).not.toContain('H6')
    expect(kurallar).not.toContain('H12')
  })

  it('taksit ufku vade görünürlük parametresiyle genişler; parametre yükselince hatırlatma sessizce kapanmaz', async () => {
    await sozlesme()
    const aralik = async () => (await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, BUGUN))).planliTaksitler.map((x) => x.vade)
    // Varsayılanda 2026-12-20 vadesi (66 gün sonra) yüklenmez.
    expect(await aralik()).not.toContain('2026-12-20')
    await prisma.parametre.updateMany({ where: { anahtar: 'HATIRLATMA_VADE_GORUNUR_GUN' }, data: { deger: '90' } })
    const genis = await aralik()
    expect(genis).toContain('2026-12-20')
  })
})

describe('I7: aktifleştirilmemiş taslak', () => {
  it('başlangıcına 15 gün kalan taslak için karar gerektiren H12 açılır; aktifleştirilince ya da silinince kendiliğinden kapanır; daha uzak taslak için açılmaz', async () => {
    const yakin = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-10-30', bitis: '2027-10-29' }), TEST_BAGLAMI)
    const silinecek = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-10-01', bitis: '2027-09-30' }), TEST_BAGLAMI)
    const uzak = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2026-10-31', bitis: '2027-10-30' }), TEST_BAGLAMI)
    await uret()
    const kayit = (id: number) => prisma.hatirlatma.findUnique({ where: { anahtar: `H12:sozlesme:${id}:TASLAK_AKTIF_DEGIL` } })
    const yakinKayit = await kayit(yakin)
    expect([yakinKayit?.oncelik, yakinKayit?.kararGerekli, yakinKayit?.sozlesmeId, yakinKayit?.hedefTarih.toISOString().slice(0, 10)]).toEqual(['NORMAL', true, yakin, '2026-10-30'])
    expect([(await kayit(silinecek))?.oncelik, await kayit(uzak)]).toEqual(['KRITIK', null])
    await sozlesmeAktiflestir(yakin, 0, TEST_BAGLAMI, BUGUN)
    await taslakSil(silinecek, 0, TEST_BAGLAMI)
    await uret()
    expect([(await kayit(yakin))?.durum, (await kayit(silinecek))?.durum]).toEqual(['OTOMATIK_KAPANDI', 'OTOMATIK_KAPANDI'])
  })
})

describe('hatırlatma üretimi — ezilmeyen kayıtlar', () => {
  it('ertelenen kayıt yeniden üretimde ertelemesini korur; içerik düzeltilse de erteleme ve durum ezilmez', async () => {
    const id = await sozlesme()
    await uret()
    const h6 = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H6:sozlesme:${id}:2026-12-31` } })
    await hatirlatmaErtele(h6.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)
    await prisma.hatirlatma.update({ where: { id: h6.id }, data: { baslik: 'eski başlık', oncelik: 'KRITIK' } })
    const r = await uret()
    expect(r.guncellenen).toBeGreaterThanOrEqual(1)
    const sonra = await prisma.hatirlatma.findUniqueOrThrow({ where: { id: h6.id } })
    expect(sonra.baslik).not.toBe('eski başlık') // içerik üreticiye göre düzeltildi
    expect(sonra.durum).toBe('ERTELENDI')
    expect(sonra.ertelenenTarih?.toISOString().slice(0, 10)).toBe('2026-10-20')
  })

  it('tamamlanan kaydın içeriği, notu ve durumu yeniden üretimde ezilmez', async () => {
    const id = await sozlesme()
    await uret()
    const pdf = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H12:sozlesme:${id}:SOZLESME_PDF_YOK` } })
    await hatirlatmaTamamla(pdf.id, 'arşivden istendi', TEST_BAGLAMI)
    await prisma.hatirlatma.update({ where: { id: pdf.id }, data: { baslik: 'elle değişmiş' } })
    await uret()
    const sonra = await prisma.hatirlatma.findUniqueOrThrow({ where: { id: pdf.id } })
    expect([sonra.durum, sonra.baslik, sonra.not]).toEqual(['TAMAMLANDI', 'elle değişmiş', 'arşivden istendi'])
  })

  it('koşulu kalkıp dönen kayıt yeniden açılır; geçerli ertelemesi varsa ertelenmiş olarak', async () => {
    const id = await sozlesme()
    await prisma.sozlesme.update({ where: { id }, data: { onayBelgesiNo: null } })
    await uret()
    const anahtar = `H12:sozlesme:${id}:ONAY_BELGESI_YOK`
    const kayit = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar } })
    await hatirlatmaErtele(kayit.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)
    await prisma.sozlesme.update({ where: { id }, data: { onayBelgesiNo: 'OB-1' } })
    await uret()
    const kapali = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar } })
    expect(kapali.durum).toBe('OTOMATIK_KAPANDI')
    expect(kapali.ertelenenTarih?.toISOString().slice(0, 10)).toBe('2026-10-20') // kapanma ertelemeyi silmez
    await prisma.sozlesme.update({ where: { id }, data: { onayBelgesiNo: null } })
    await uret()
    const geri = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar } })
    expect([geri.durum, geri.ertelenenTarih?.toISOString().slice(0, 10)]).toEqual(['ERTELENDI', '2026-10-20'])
    // Erteleme süresi dolduktan sonra dönen kayıt ertelenmiş değil, açık olarak yeniden açılır.
    await prisma.sozlesme.update({ where: { id }, data: { onayBelgesiNo: 'OB-1' } })
    await uret()
    await prisma.sozlesme.update({ where: { id }, data: { onayBelgesiNo: null } })
    await uret(t('2026-10-21'))
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar } })).durum).toBe('ACIK')
  })

  it('motorun üretmediği kurallar (UZAMA_*, ARTIS_HESAP_HATA, H5_FAZLA_ODEME, H13) kullanıcı tamamlayana kadar açık kalır; pano hepsini listeler', async () => {
    const id = await sozlesme()
    const kurallar = ['UZAMA_BILGI', 'UZAMA_HATA', 'ARTIS_HESAP_HATA', 'H5_FAZLA_ODEME', 'H13', 'BILINMEYEN_KURAL']
    for (const k of kurallar) await motorDisiKayit(id, k, `${k}:deneme`)
    const r = await uret()
    expect(r.kapanan).toBe(0)
    for (const k of kurallar) expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `${k}:deneme` } })).durum, k).toBe('ACIK')
    const pano = await panoVerisi(BUGUN)
    for (const k of kurallar) expect(pano.listeler.tumu.some((x) => x.kural === k), k).toBe(true)
    expect(pano.kartlar.kararBekleyen).toBe(pano.listeler.karar.length)
    expect(pano.listeler.karar.map((x) => x.kural)).toEqual(expect.arrayContaining(kurallar))
  })
})

describe('hatırlatma üretimi — malikler ve eşzamanlılık', () => {
  const veri = (bugun = BUGUN) => prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, bugun))

  async function ileriTarihliMalikDegisikligi() {
    const id = await sozlesme()
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await malikleriDegistir(id, s.version, {
      tarih: t('2026-12-01'), malikler: [{ kisiId: h.kisiB, pay: 1, payda: 1, ibanId: h.ibanB, vekilKisiId: null }],
    }, TEST_BAGLAMI, BUGUN)
    // Bugünkü malik A'nın ödeme IBAN'ı yok; ileride gelecek malik B'ninki tam.
    await prisma.sozlesmeMalik.updateMany({ where: { sozlesmeId: id, kisiId: h.kisiA }, data: { ibanId: null } })
    return id
  }

  it('ileri tarihli malik değişikliğinde bugünün malikinin eksik IBAN bilgisi hâlâ H12 üretir; hisse toplamı bozuk sayılmaz', async () => {
    const id = await ileriTarihliMalikDegisikligi()
    const eksikler = (await veri()).sozlesmeler.find((x) => x.id === String(id))!.eksikler
    expect(eksikler).toContain('IBAN_YOK')
    expect(eksikler).not.toContain('HISSE_TOPLAMI')
    await uret()
    const anahtarlar = (await prisma.hatirlatma.findMany({ where: { sozlesmeId: id } })).map((k) => k.anahtar)
    expect(anahtarlar).toContain(`H12:sozlesme:${id}:IBAN_YOK`)
    expect(anahtarlar).not.toContain(`H12:sozlesme:${id}:HISSE_TOPLAMI`)
  })

  it('değişiklik tarihi gelince eski malik değerlendirmeden çıkar; yeni malikin IBAN bilgisi tam olduğundan eksik kalmaz', async () => {
    const id = await ileriTarihliMalikDegisikligi()
    const eksikler = (await veri(t('2026-12-05'))).sozlesmeler.find((x) => x.id === String(id))!.eksikler
    expect(eksikler).not.toContain('IBAN_YOK')
    expect(eksikler).not.toContain('HISSE_TOPLAMI')
  })

  it('henüz başlamamış (yenileme) sözleşmede eksik veri sözleşmenin ilk günündeki maliklere göre değerlendirilir', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2027-01-01', bitis: '2027-12-31', imzaTarihi: '2026-10-01', onayBelgesiTarihi: '2026-09-15' }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, BUGUN)
    expect((await veri()).sozlesmeler.find((x) => x.id === String(id))!.eksikler).toEqual(['SOZLESME_PDF_YOK'])
  })

  it('eşzamanlı üretimler hata vermez, yinelenen anahtar bırakmaz ve tek çalıştırmayla aynı kayıt kümesini üretir', async () => {
    await sozlesme()
    const ozet = async () => (await prisma.hatirlatma.findMany({ orderBy: { anahtar: 'asc' } })).map((k) => [k.anahtar, k.kural, k.durum, k.oncelik, k.baslik, k.aciklama])
    await uret()
    const tek = await ozet()
    expect(tek.length).toBeGreaterThan(0)
    // Yarış zamanlamaya bağlıdır (bazı turlarda ikinci üretim ilkinin işlemi bittikten sonra okur): birkaç tur ve dört eşzamanlı üretimle denenir.
    for (let tur = 0; tur < 5; tur++) {
      await prisma.hatirlatma.deleteMany()
      const sonuclar = await Promise.all([uret(), uret(), uret(), uret()])
      const eszamanli = await ozet()
      expect(new Set(eszamanli.map((r) => r[0])).size).toBe(eszamanli.length)
      expect(sonuclar.reduce((toplam, r) => toplam + r.yeni, 0)).toBe(eszamanli.length)
      expect(eszamanli).toEqual(tek)
    }
  })
})

describe('tamamla ve ertele', () => {
  async function acikKayit() {
    const id = await sozlesme()
    await uret()
    return prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H12:sozlesme:${id}:SOZLESME_PDF_YOK` } })
  }

  it('tamamlanmış kaydı yeniden tamamlamaz ya da ertelemez; ilk tamamlama bozulmaz', async () => {
    const k = await acikKayit()
    await hatirlatmaTamamla(k.id, 'ilk not', TEST_BAGLAMI)
    await expect(hatirlatmaTamamla(k.id, 'ikinci not', TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    await expect(hatirlatmaErtele(k.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
    const sonra = await prisma.hatirlatma.findUniqueOrThrow({ where: { id: k.id } })
    expect([sonra.durum, sonra.not, sonra.ertelenenTarih]).toEqual(['TAMAMLANDI', 'ilk not', null])
  })

  it('olmayan kayıtta BulunamadiHatasi; geçmiş ya da bugünkü erteleme tarihinde IsKuraliHatasi', async () => {
    const k = await acikKayit()
    await expect(hatirlatmaTamamla(999_999, '', TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(hatirlatmaErtele(999_999, t('2026-10-20'), TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(BulunamadiHatasi)
    await expect(hatirlatmaErtele(k.id, BUGUN, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(IsKuraliHatasi)
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { id: k.id } })).durum).toBe('ACIK')
  })

  it('ertelenmiş kayıt yeniden ertelenebilir ve tamamlanabilir', async () => {
    const k = await acikKayit()
    await hatirlatmaErtele(k.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)
    await hatirlatmaErtele(k.id, t('2026-10-25'), TEST_BAGLAMI, BUGUN)
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { id: k.id } })).ertelenenTarih?.toISOString().slice(0, 10)).toBe('2026-10-25')
    await hatirlatmaTamamla(k.id, '', TEST_BAGLAMI)
    expect((await prisma.hatirlatma.findUniqueOrThrow({ where: { id: k.id } })).durum).toBe('TAMAMLANDI')
  })

  it('denetim satırı serbest metin notu taşımaz; yalnızca not girildiğini ve değişen alanları yazar', async () => {
    const k = await acikKayit()
    await hatirlatmaTamamla(k.id, 'Ahmet Yılmaz aradı, 0532 000 00 00', TEST_BAGLAMI)
    const satir = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'hatirlatma', varlikId: String(k.id), eylem: 'TAMAMLA' } })
    const metin = JSON.stringify(satir.sonra)
    expect(metin).not.toContain('Ahmet')
    expect(metin).not.toContain('0532')
    expect(satir.sonra).toMatchObject({ anahtar: k.anahtar, notGirildi: true, degisenAlanlar: ['durum', 'not'] })
  })
})

describe('pano', () => {
  it('sekmeler ve kartlar; ertelenen kayıt ertelenen tarihe kadar görünmez', async () => {
    const id = await sozlesme()
    await uret()
    const p = await panoVerisi(BUGUN)
    // 9 gecikmiş H1 + hedefi (vadeden 10 iş günü önce) geçmiş Ekim H2'si
    expect(p.kartlar.gecikmis).toBe(10)
    expect(p.kartlar.buHaftaVade).toBe(1)
    expect(p.kartlar.sonTufe12).toEqual({ ay: { yil: 2026, ay: 9 }, oran: '31.49' })
    expect(p.listeler.karar.some((x) => x.kural === 'H6')).toBe(true)
    expect(p.listeler.gecikmis[0]!.oncelik).toBe('KRITIK')
    const h6 = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `H6:sozlesme:${id}:2026-12-31` } })
    await hatirlatmaErtele(h6.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)
    expect((await panoVerisi(BUGUN)).listeler.tumu.some((x) => x.id === h6.id)).toBe(false)
    expect((await panoVerisi(t('2026-10-20'))).listeler.tumu.some((x) => x.id === h6.id)).toBe(true)
  })

  it('I6: vadesi iş günü olmayan ödeme satırı "tatile denk geliyor" bayrağı taşır (2026-10-29 resmi tatil, hafta sonu); diğerleri taşımaz', async () => {
    const id = await sozlesme()
    const h1 = (taksitId: number, hedef: string, kural = 'H1') => prisma.hatirlatma.create({
      data: {
        anahtar: `${kural}:taksit:${taksitId}:${hedef}`, kural, iliskiliTur: 'taksit', iliskiliId: String(taksitId), sozlesmeId: id,
        baslik: 'Kira ödemesi', aciklama: 'açıklama', hedefTarih: new Date(hedef), gorunurTarih: new Date('2026-10-20'), oncelik: 'NORMAL',
      },
    })
    const tatil = await h1(1, '2026-10-29')
    const pazar = await h1(2, '2026-11-01')
    const isGunu = await h1(3, '2026-10-30')
    const odemeEmri = await h1(4, '2026-10-29', 'H2')
    const satirlar = (await panoVerisi(t('2026-10-25'))).listeler.tumu
    const bayrak = (kayitId: number) => satirlar.find((x) => x.id === kayitId)?.tatileDenk
    expect([bayrak(tatil.id), bayrak(pazar.id), bayrak(isGunu.id), bayrak(odemeEmri.id)]).toEqual([true, true, false, false])
  })

  it('satırlar düz değerlerdir (Date/Decimal yok); öncelik sırası KRITIK, YUKSEK, NORMAL', async () => {
    await sozlesme()
    await uret()
    const { listeler } = await panoVerisi(BUGUN)
    for (const s of listeler.tumu) {
      expect(typeof s.hedef).toBe('string')
      expect(Object.values(s).some((v) => v instanceof Date)).toBe(false)
    }
    const sira = { KRITIK: 0, YUKSEK: 1, NORMAL: 2 }
    const oncelikler = listeler.tumu.map((s) => sira[s.oncelik])
    expect(oncelikler).toEqual([...oncelikler].sort((a, b) => a - b))
  })

  it('ertelemesi bugün biten kayıt hedefi uzak olsa da Bugün sekmesinde yeniden görünür', async () => {
    const id = await sozlesme()
    const kayit = await prisma.hatirlatma.create({
      data: {
        anahtar: `H7:sozlesme:${id}:2027-06-01`, kural: 'H7', iliskiliTur: 'sozlesme', iliskiliId: String(id), sozlesmeId: id,
        baslik: '5 yıllık kira tespit dönemi', aciklama: 'emsal araştırması', hedefTarih: new Date('2027-06-01'),
        gorunurTarih: new Date('2026-10-01'), oncelik: 'NORMAL', kararGerekli: false,
      },
    })
    await hatirlatmaErtele(kayit.id, t('2026-10-20'), TEST_BAGLAMI, BUGUN)
    const bugunSatir = async (gun: ReturnType<typeof t>) => (await panoVerisi(gun)).listeler.bugun.find((x) => x.id === kayit.id)
    expect(await bugunSatir(t('2026-10-19'))).toBeUndefined() // erteleme sürüyor: hiçbir listede yok
    expect((await panoVerisi(t('2026-10-19'))).listeler.tumu.some((x) => x.id === kayit.id)).toBe(false)
    expect(await bugunSatir(t('2026-10-20'))).toMatchObject({ id: kayit.id, ertelenenTarih: '2026-10-20' })
    expect((await panoVerisi(t('2026-10-20'))).listeler.tumu.some((x) => x.id === kayit.id)).toBe(true)
    expect(await bugunSatir(t('2026-10-21'))).toBeUndefined() // ertelemenin bittiği günü geçince Bugün'den düşer, Tümü'nde kalır
    expect((await panoVerisi(t('2026-10-21'))).listeler.tumu.some((x) => x.id === kayit.id)).toBe(true)
    // Ertelenmemiş satırın ertelenenTarih'i null'dır.
    const baska = (await panoVerisi(t('2026-10-20'))).listeler.tumu.find((x) => x.id !== kayit.id)
    if (baska) expect(baska.ertelenenTarih).toBeNull()
  })
})

describe('genel arama yönlendirmesi', () => {
  const bul = { kimlik: kisiKimlikIleBul, iban: kisiIbanIleBul }

  it('TCKN ve IBAN kişinin kimlik adresine gider; hedef adreste kimlik değeri geçmez', async () => {
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    const bicimli = iban.iban.replace(/(.{4})/g, '$1 ').toLowerCase()
    for (const q of [kisi.tckn!, ` ${kisi.tckn!.slice(0, 5)} ${kisi.tckn!.slice(5)} `, iban.iban, bicimli]) {
      const hedef = await genelAramaHedefi(q, bul)
      expect(hedef, q).toBe(`/kisiler/${h.kisiA}`)
      expect(hedef).not.toContain(kisi.tckn!)
      expect(hedef).not.toContain(iban.iban.slice(4, 12))
    }
  })

  it('bulunamayan kimlik ve IBAN bildirim adresine gider; adreste değer yoktur', async () => {
    for (const q of ['99999999999', '1234567890', 'TR330006100519786457841326', 'tr33 0006 1005 1978 6457 8413 26', 'TR12']) {
      const hedef = await genelAramaHedefi(q, bul)
      expect(hedef, q).toBe('/ara?bulunamadi=1')
    }
  })

  it('aynı IBAN birden çok kişide kayıtlıysa kişi listesi adresine gider; adreste yalnızca kişi kimlikleri vardır', async () => {
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    await prisma.iban.create({ data: { kisiId: h.kisiB, iban: iban.iban } })
    expect(await kisiIbanIleBul(iban.iban)).toEqual([h.kisiA, h.kisiB])
    const hedef = await genelAramaHedefi(iban.iban.toLowerCase(), bul)
    expect(hedef).toBe(`/ara?kisiler=${h.kisiA},${h.kisiB}`)
    expect(hedef).not.toContain(iban.iban.slice(4, 12))
  })

  it('"Ahmet 10000000146", tireli ve noktalı numara ya da çıplak BBAN adrese yazılmaz; çözülmez', async () => {
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const tckn = kisi.tckn!
    const bban = (await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })).iban.slice(4)
    for (const q of [`Ahmet ${tckn}`, `${tckn.slice(0, 3)}-${tckn.slice(3, 6)}-${tckn.slice(6, 9)}-${tckn.slice(9)}`, `${tckn.slice(0, 3)}.${tckn.slice(3, 6)}.${tckn.slice(6, 9)}.${tckn.slice(9)}`, bban]) {
      const hedef = await genelAramaHedefi(q, bul)
      expect(hedef, q).toBe('/ara?bulunamadi=1')
    }
  })

  it('sıradan arama kodlanmış `q` ile gider', async () => {
    expect(await genelAramaHedefi(' 123/45 ', bul)).toBe('/ara?q=123%2F45')
    expect(await genelAramaHedefi('', bul)).toBe('/ara')
  })
})
