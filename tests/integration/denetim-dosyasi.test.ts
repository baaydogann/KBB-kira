import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatOran, formatTL, para } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { artisOnayla, artislariHesapla } from '@/server/artis/servis'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketKesinlestir } from '@/server/paket/durum'
import { paketHesapla } from '@/server/paket/hesapla'
import { denetimDosyasiPdf, denetimDosyasiVerisi } from '@/server/rapor/denetim-dosyasi'
import { sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { pdfMetni } from '../pdf-metni'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur } from './paket-yardimci'

const BUGUN = t('2026-03-05')
let h: Hazirlik
let s: number
let baska: number
let paketId: number
let metin: string

/** 2025-03-01–2027-02-28 sözleşmesi; 2026-03-01 artışı onaylı; Mart paketi (NORMAL + FARK) kesinleşmiş. Yanında başka bir sözleşme. */
beforeAll(async () => {
  await temizle()
  h = await hazirlik()
  s = await aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, t('2026-02-20'))
  baska = await aktifSozlesme(h, { tasinmazId: h.arsaId })
  await prisma.$transaction((tx) => artislariHesapla(tx, BUGUN, s))
  const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, donemBaslangic: new Date('2026-03-01') } })
  await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
  await borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: BUGUN, borcVar: false, borcTutari: null, vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, BUGUN)
  paketId = await paketKur(h, { ad: 'Mart paketi', vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
  await paketHesapla(paketId, 0, TEST_BAGLAMI, BUGUN)
  await paketKesinlestir(paketId, 1, TEST_BAGLAMI, BUGUN)
  metin = await pdfMetni((await denetimDosyasiPdf(s, TEST_BAGLAMI)).icerik)
}, 120_000)
afterAll(() => prisma.$disconnect())

describe('denetim dosyası', () => {
  it('PDF metni: sözleşme no, malik adı, kira dönemleri, artış oranı ve endeks onayı, taksit tablosu, paket adı, damga 226,80', async () => {
    const sz = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, durum: 'ONAYLANDI' } })
    const damga = await prisma.damgaKaydi.findFirstOrThrow({ where: { sozlesmeId: s, olay: 'ILK' } })
    for (const parca of [
      'DENETİM DOSYASI', sz.sozlesmeNo, `${kisi.ad} ${kisi.soyad}`, 'Kira dönemleri', formatTL(a.yeniBedel!.toString(), false),
      formatOran(para(a.uygulananOran!.toString())), 'Endeks onayı', 'Taksitler', 'FARK', `#${paketId} Mart paketi`, formatTL(damga.tutar.toString(), false),
    ]) expect(metin).toContain(parca)
    const v = await denetimDosyasiVerisi(s)
    expect(v.artislar[0]!.endeksOnayi).toMatchObject({ kaynak: expect.any(String) })
    expect(v.dagilimlar.length).toBeGreaterThan(0)
    expect(v.damga.map((d) => d.tutar)).toContain(damga.tutar.toFixed(2))
  })

  it('hesap izi: dağılım satırının "Stopaj" satırı ve formülü PDF metninde', () => {
    expect(metin).toMatch(/K4 Stopaj \d+\.\d{2} × 20% \d+\.\d{2}/)
  })

  it('olay özeti AKTIFLESTIR ve KESINLESTIR eylemlerini içerir; başka sözleşmenin olayı yok; once/sonra içeriği yok', async () => {
    const v = await denetimDosyasiVerisi(s)
    const eylemler = v.olaylar.map((o) => `${o.varlik}:${o.eylem}`)
    for (const e of ['sozlesme:AKTIFLESTIR', 'sozlesme:ARTIS_ONAY', 'odeme_paketi:HESAPLA', 'odeme_paketi:KESINLESTIR']) expect(eylemler).toContain(e)
    expect(v.olaylar.every((o) => Object.keys(o).sort().join(',') === 'eylem,kullanici,varlik,zaman')).toBe(true)
    const baskaAktiflestir = await prisma.olayGunlugu.count({ where: { varlik: 'sozlesme', varlikId: String(baska) } })
    expect(baskaAktiflestir).toBeGreaterThan(0)
    expect(eylemler.filter((e) => e === 'sozlesme:AKTIFLESTIR')).toHaveLength(1)
    expect(metin).not.toContain('"sonra"')
  })

  it('DISA_AKTAR denetim satırı DENETIM_DOSYASI; TASLAK sözleşmede IsKuraliHatasi', async () => {
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'sozlesme', varlikId: String(s), eylem: 'DISA_AKTAR' } })
    const taksitSayisi = await prisma.taksit.count({ where: { sozlesmeId: s } })
    expect(d.sonra).toEqual({ belge: 'DENETIM_DOSYASI', kayitSayisi: taksitSayisi })
    const sz = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    expect((await denetimDosyasiPdf(s, TEST_BAGLAMI)).dosyaAdi).toBe(`denetim-dosyasi-${sz.sozlesmeNo.replace(/[^A-Za-z0-9-]/g, '')}.pdf`)
    const taslak = await sozlesmeTaslakKaydet(girdi(h, { tasinmazId: h.arsaId }), TEST_BAGLAMI)
    expect(await denetimDosyasiPdf(taslak, TEST_BAGLAMI).catch((e: unknown) => e)).toBeInstanceOf(IsKuraliHatasi)
  })
})
