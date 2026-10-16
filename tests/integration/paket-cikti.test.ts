import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ibanBicimle, vknGecerliMi } from '@/core/dogrulama'
import { formatTL } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketBankaDosyasi, paketBelgeleriPdf } from '@/server/paket/cikti'
import { paketKesinlestir } from '@/server/paket/durum'
import { paketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { paketHesapla } from '@/server/paket/hesapla'
import { paketFaturasiKaydet } from '@/server/paket/servis'
import { parametreEkle } from '@/server/parametre/servis'
import { artisOnayla, artislariHesapla } from '@/server/artis/servis'
import { ornekIban, ornekKisi } from './ornekler'
import { pdfMetni } from '../pdf-metni'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur, paketSurumu, sozlesmeTaksitleri } from './paket-yardimci'

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

  it('GMSİ alıcı için harcama pusulası; SIRKET alıcı (faturalı) için pusula yok, ek listesinde fatura no', async () => {
    await aktifSozlesme(h)
    const vkn = Array.from({ length: 10 }, (_, i) => `123456789${i}`).find(vknGecerliMi)!
    const sirket = await ornekKisi({ tip: 'TUZEL', tckn: null, vkn, ad: null, soyad: null, unvan: 'Ay Gayrimenkul Ltd. Şti.', vergiStatusu: 'SIRKET' })
    const iban = await ornekIban(sirket.id)
    const s2 = await aktifSozlesme(h, { tasinmazId: h.arsaId, malikler: [{ kisiId: sirket.id, pay: 1, payda: 1, ibanId: iban.id, vekilKisiId: null }] })
    const p = await paketKur(h)
    const subat2 = (await sozlesmeTaksitleri(s2)).find((x) => x.vadeTarihi.toISOString().startsWith('2026-02-01'))!
    await paketFaturasiKaydet(p, 0, { taksitId: subat2.id, kisiId: sirket.id, faturaNo: 'F-77', faturaTarihi: BUGUN }, TEST_BAGLAMI, BUGUN)
    await paketHesapla(p, await paketSurumu(p), TEST_BAGLAMI, BUGUN)
    const metin = await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    expect(metin.split('HARCAMA PUSULASI').length - 1).toBe(1)
    expect(metin).toContain(`${kisi.ad} ${kisi.soyad}`)
    expect(metin).toMatch(/Taşınmaz kirası — T-\d+ — 01\.02\.2026–28\.02\.2026/)
    const v = await paketCiktiVerisi(p)
    expect(v.ekBelgeler.filter((b) => b.tur === 'FATURA').map((b) => [b.numara, b.eksik])).toEqual([['F-77', false]])
    expect(metin).toContain('F-77')
  })

  it('fiş önerisi metninde 630.03.5.5.05, 360, 103 ve tutarlar; ilk ödeme notu', async () => {
    const p = await hesaplanmis()
    const v = await paketCiktiVerisi(p)
    expect(v.fis.satirlar.filter((x) => x.kayit === 1).map((x) => [x.hesap, x.borc, x.alacak])).toEqual([
      ['630.03.5.5.05', '10000.00', '0.00'], ['360', '0.00', '2000.00'], ['360', '0.00', '226.80'], ['103', '0.00', '7773.20'],
    ])
    const metin = await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)
    for (const parca of ['MUHASEBE İŞLEM FİŞİ ÖNERİSİ', '630.03.5.5.05', '360', '103', '7.773,20', 'İlk ödeme — T-', 'KDV hariç: 120.000,00 ₺']) expect(metin).toContain(parca)
  })

  it('artış onaylı sözleşmenin FARK taksiti pakette → artış tablosu: eski bedel, uygulanan oran, yeni bedel', async () => {
    const bugun = t('2026-03-05')
    const s = await aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, t('2026-02-20'))
    await prisma.$transaction((tx) => artislariHesapla(tx, bugun, s))
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, donemBaslangic: new Date('2026-03-01') } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, bugun)
    const onayli = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })
    const p = await paketKur(h, { vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
    await paketHesapla(p, 0, TEST_BAGLAMI, bugun)
    const v = await paketCiktiVerisi(p)
    expect(v.artislar.map((x) => [x.donemBaslangic, x.eskiBedel, x.yeniBedel])).toEqual([['2026-03-01', '10000.00', onayli.yeniBedel!.toFixed(2)]])
    expect(v.artislar[0]!.satirlar.length).toBeGreaterThan(0)
    expect(v.ekBelgeler.map((b) => b.tur)).toContain('ARTIS_TABLOSU')
    const metin = await pdfMetni((await paketBelgeleriPdf(p, TEST_BAGLAMI)).icerik)
    for (const parca of ['KİRA ARTIŞ HESAP TABLOSU', '10.000,00', formatTL(onayli.yeniBedel!.toString(), false), v.artislar[0]!.uygulananOran]) expect(metin).toContain(parca)
  })

  it('MUHASEBE_FIS_HESAPLARI şemaya uymayan JSON parametre olarak eklenemez', async () => {
    const ekle = (deger: string) => parametreEkle({ anahtar: 'MUHASEBE_FIS_HESAPLARI', deger, yururlukBaslangic: t('2026-06-01'), yururlukBitis: null, mevzuatDayanagi: null, aciklama: null }, TEST_BAGLAMI)
    expect(((await ekle('{"gider":"630"}').catch((e: unknown) => e)) as IsKuraliHatasi).kod).toBe('DEGER')
    expect(((await ekle('bozuk').catch((e: unknown) => e)) as IsKuraliHatasi).kod).toBe('DEGER')
    const tam = '{"gider":"630","vergi":"360","emanet22a":"333","emanetHaciz":"333","banka":"103","butceGider":"830","giderYansitma":"835","odenekliGider":"905","gonderilecekOdenek":"900"}'
    expect(await ekle(tam)).toBeGreaterThan(0)
  })

  it('banka dosyası: kesinleşmiş pakette tek satır, tutar 7773.2, IBAN metin; HESAPLANDI pakette IsKuraliHatasi; DISA_AKTAR BANKA_AKTARIMI', async () => {
    const p = await hesaplanmis()
    expect(((await paketBankaDosyasi(p, TEST_BAGLAMI).catch((e: unknown) => e)) as IsKuraliHatasi).kod).toBe('DURUM')
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const { dosyaAdi, icerik } = await paketBankaDosyasi(p, TEST_BAGLAMI)
    expect(dosyaAdi).toBe(`banka-aktarimi-${p}.xlsx`)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(icerik as unknown as ArrayBuffer)
    const ws = wb.getWorksheet('Banka aktarımı')!
    const iban = await prisma.iban.findUniqueOrThrow({ where: { id: h.ibanA } })
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['Sıra', 'Alıcı (ödeme kişisi)', 'IBAN', 'Tutar', 'Açıklama'])
    expect(ws.rowCount).toBe(2)
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual([1, `${kisi.ad} ${kisi.soyad}`, iban.iban, 7773.2, `${kisi.tckn} – kira ödemesi – 02/2026 – ${(await paketCiktiVerisi(p)).kalemler[0]!.sozlesmeNo}`])
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'DISA_AKTAR' } })
    expect(d.sonra).toEqual({ belge: 'BANKA_AKTARIMI', kayitSayisi: 1 })
  })
})
