import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ibanBicimle } from '@/core/dogrulama'
import { tarih as t } from '@/core/tarih'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketBelgeleriPdf } from '@/server/paket/cikti'
import { paketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { paketHesapla } from '@/server/paket/hesapla'
import { pdfMetni } from '../pdf-metni'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur } from './paket-yardimci'

const BUGUN = t('2026-01-25')
let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

/** Görev 11 senaryosu: borç yok sorgulu, hesaplanmış Şubat paketi. */
async function hesaplanmis(): Promise<number> {
  await aktifSozlesme(h)
  await borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: BUGUN, borcVar: false, borcTutari: null, vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, BUGUN)
  const p = await paketKur(h)
  await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
  return p
}

describe('paket belgeleri', () => {
  it('föy: "ÖDEME EMRİ HAZIRLIK FÖYÜ", birim adı, kurumsal kod, alıcının TCKN si, biçimli IBAN, "7.773,20", tertip 03.5.5.05', async () => {
    const p = await hesaplanmis()
    const { dosyaAdi, icerik } = await paketBelgeleriPdf(p, TEST_BAGLAMI)
    expect(dosyaAdi).toBe(`odeme-paketi-${p}.pdf`)
    const metin = await pdfMetni(icerik)
    const birim = await prisma.birim.findUniqueOrThrow({ where: { id: h.birimId } })
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    for (const parca of ['ÖDEME EMRİ HAZIRLIK FÖYÜ', birim.ad, birim.kurumsalKod, kisi.tckn!, ibanBicimle(iban.iban), '7.773,20', '03.5.5.05']) expect(metin).toContain(parca)
    const v = await paketCiktiVerisi(p)
    expect(v.kalemler[0]!.tertip).toBe(`${birim.kurumsalKod}.${birim.fonksiyonelKod}.${birim.finansKodu}.03.5.5.05`)
    expect([v.butceYili, v.toplam]).toEqual([2026, { gider: '10000.00', kesinti: '2226.80', net: '7773.20' }])
    expect(v.alicilar.map((a) => [a.sira, a.kimlikNo, a.net])).toEqual([[1, kisi.tckn, '7773.20']])
  })

  it('föy: GV stopajı 2.000,00 (oran %20) ve damga 226,80 kesinti satırları', async () => {
    const p = await hesaplanmis()
    const v = await paketCiktiVerisi(p)
    expect(v.kesintiler.map((k) => [k.tur, k.hesabaEsas, k.oran, k.tutar])).toEqual([
      ['GV_STOPAJI', '10000.00', '%20,00', '2000.00'],
      ['DAMGA', '120000.00', 'binde 1,89', '226.80'],
    ])
    const metin = await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)
    for (const parca of ['2.000,00', '%20,00', '226,80', 'Vergi dairesi (muhtasar)']) expect(metin).toContain(parca)
  })

  it('HESAPLANDI pakette filigran "KESİNLEŞMEMİŞ"; TASLAK pakette IsKuraliHatasi (DURUM)', async () => {
    const p = await hesaplanmis()
    expect((await paketCiktiVerisi(p)).kesinlesmemis).toBe(true)
    expect(await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)).toContain('KESİNLEŞMEMİŞ')
    const taslak = await paketKur(h, { ad: 'Mart', vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
    const e = await paketBelgeleriPdf(taslak, TEST_BAGLAMI).catch((x: unknown) => x)
    expect((e as IsKuraliHatasi).kod).toBe('DURUM')
  })

  it('ek listesi: ilk ödeme → onay belgesi OB-1, piyasa araştırması EKSİK (tarih yok)', async () => {
    const p = await hesaplanmis()
    const v = await paketCiktiVerisi(p)
    expect(v.ekBelgeler.map((b) => [b.tur, b.numara, b.eksik])).toEqual([
      ['ONAY_BELGESI', 'OB-1', false],
      ['PIYASA_ARASTIRMA', null, true],
      ['SOZLESME', v.kalemler[0]!.sozlesmeNo, false],
      ['HARCAMA_PUSULASI', null, false],
      ['BORC_YAZISI', 'B-1', false],
    ])
    const metin = await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)
    expect(metin).toContain('EK BELGE KONTROL LİSTESİ')
    expect(metin).toContain('EKSİK')
  })

  it('DISA_AKTAR denetim satırı: belge PAKET_BELGELERI; satır JSON unda TCKN, IBAN ve ad yok', async () => {
    const p = await hesaplanmis()
    await paketBelgeleriPdf(p, TEST_BAGLAMI)
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'DISA_AKTAR' } })
    expect(d.sonra).toEqual({ belge: 'PAKET_BELGELERI', kayitSayisi: 1 })
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    const json = JSON.stringify(d)
    for (const gizli of [kisi.tckn!, iban.iban, kisi.soyad!]) expect(json).not.toContain(gizli)
  })
})
