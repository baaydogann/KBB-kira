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
    await prisma.sozlesme.update({ where: { id }, data: { durum: 'SONA_ERDI' } })
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

  it('sıradan arama kodlanmış `q` ile gider', async () => {
    expect(await genelAramaHedefi(' 123/45 ', bul)).toBe('/ara?q=123%2F45')
    expect(await genelAramaHedefi('', bul)).toBe('/ara')
  })
})
