import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { tarih as t, type Tarih } from '@/core/tarih'
import { hatirlatmaAdresi } from '@/app/_lib/hatirlatma-adresi'
import { damgaMakbuzBagla } from '@/server/damga/servis'
import { prisma } from '@/server/db'
import { tarihDb } from '@/server/donustur'
import { hatirlatmalariUretVeKaydet, panoVerisi } from '@/server/hatirlatma/servis'
import { borcSorguEkle } from '@/server/kesinti/servis'
import { paketKesinlestir, paketOdemeEmriGir, paketOdendi } from '@/server/paket/durum'
import { paketHesapla } from '@/server/paket/hesapla'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur, sozlesmeTaksitleri } from './paket-yardimci'

const BUGUN = t('2026-01-25')
let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const uret = (bugun: Tarih = BUGUN) => prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, bugun), { timeout: 60_000 })
const sorgu = (bugun: Tarih = BUGUN) =>
  borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: bugun, borcVar: false, borcTutari: null, vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, bugun)
const kayit = (anahtarOnEki: string) => prisma.hatirlatma.findMany({ where: { anahtar: { startsWith: anahtarOnEki } }, orderBy: { id: 'asc' } })

describe('F2 hatırlatmaları', () => {
  it('paket kesinleşince H2 kapanır (OTOMATIK_KAPANDI), H1 açık kalır; ödendi olunca H1 kapanır', async () => {
    const s = await aktifSozlesme(h)
    const subat = (await sozlesmeTaksitleri(s)).find((x) => tarihDb(x.vadeTarihi) === '2026-02-01')!
    await sorgu()
    const p = await paketKur(h)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    await uret()
    expect((await kayit(`H1:taksit:${subat.id}:`)).map((x) => x.durum)).toEqual(['ACIK'])
    expect((await kayit(`H2:taksit:${subat.id}:`)).map((x) => x.durum)).toEqual(['ACIK'])
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    await uret()
    const [h1] = await kayit(`H1:taksit:${subat.id}:`)
    expect([h1!.durum, h1!.aciklama.endsWith('Ödeme sürecinde (paket kesinleşti).')]).toEqual(['ACIK', true])
    expect((await kayit(`H2:taksit:${subat.id}:`)).map((x) => x.durum)).toEqual(['OTOMATIK_KAPANDI'])
    await paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: BUGUN }, TEST_BAGLAMI, BUGUN)
    await paketOdendi(p, 3, BUGUN, TEST_BAGLAMI, BUGUN)
    await uret()
    expect((await kayit(`H1:taksit:${subat.id}:`)).map((x) => x.durum)).toEqual(['OTOMATIK_KAPANDI'])
  })

  it('ödendi paketin Eylül stopajı → 2026-10-20 üretiminde H9; Kasım üretiminde kendiliğinden kapanmaz', async () => {
    const gun = t('2026-09-01')
    await aktifSozlesme(h)
    await sorgu(gun)
    const p = await paketKur(h, { ad: 'Eylül', vadeBaslangic: t('2026-09-01'), vadeBitis: t('2026-09-30') })
    await paketHesapla(p, 0, TEST_BAGLAMI, gun)
    await paketKesinlestir(p, 1, TEST_BAGLAMI, gun)
    await paketOdemeEmriGir(p, 2, { no: 'ÖE-9', tarih: gun }, TEST_BAGLAMI, gun)
    await paketOdendi(p, 3, gun, TEST_BAGLAMI, gun)
    await uret(t('2026-10-19'))
    expect(await kayit('H9:')).toEqual([])
    await uret(t('2026-10-20'))
    const [h9] = await kayit('H9:')
    expect([h9!.anahtar, h9!.durum, tarihDb(h9!.hedefTarih), h9!.aciklama.startsWith('Gelir vergisi stopajı ve İstihkaktan kesilen damga vergisi')]).toEqual([
      'H9:sistem:muhtasar:2026-09', 'ACIK', '2026-10-26', true,
    ])
    await uret(t('2026-11-20'))
    expect((await kayit('H9:sistem:muhtasar:2026-09')).map((x) => x.durum)).toEqual(['ACIK'])
  })

  it('MALIK_BEYAN damga kaydı → H10; makbuz bağlanınca OTOMATIK_KAPANDI', async () => {
    const s = await aktifSozlesme(h, { damgaTahsil: 'MALIK_BEYAN' })
    await uret()
    const d = await prisma.damgaKaydi.findFirstOrThrow({ where: { sozlesmeId: s } })
    const [h10] = await kayit(`H10:damga:${d.id}:`)
    // Olay 2025-12-20 (imza) + 15 gün = 2026-01-04 (pazar) → 2026-01-05; bugün geçti → KRITIK.
    expect([h10!.durum, tarihDb(h10!.hedefTarih), h10!.oncelik, h10!.sozlesmeId]).toEqual(['ACIK', '2026-01-05', 'KRITIK', s])
    expect(hatirlatmaAdresi({ sozlesmeId: h10!.sozlesmeId, kural: 'H10', iliskiliTur: 'damga', iliskiliId: h10!.iliskiliId })).toBe(`/sozlesmeler/${s}?sekme=damga`)
    const belge = await prisma.belge.create({ data: { sahipTur: 'sozlesme', sahipId: s, belgeTuru: 'DAMGA_MAKBUZU', dosyaAdi: 'makbuz.pdf', sha256: 'c'.repeat(64), boyut: 10, mime: 'application/pdf', yukleyenId: 1 } })
    await damgaMakbuzBagla(d.id, d.version, belge.id, TEST_BAGLAMI)
    await uret()
    expect((await kayit(`H10:damga:${d.id}:`)).map((x) => x.durum)).toEqual(['OTOMATIK_KAPANDI'])
  })

  it('sorgusuz HESAPLANDI paket → H3 SORGU_YOK; sorgu eklenince sonraki üretimde kapanır', async () => {
    await aktifSozlesme(h)
    const p = await paketKur(h)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    await uret()
    const [h3] = await kayit(`H3:paket:${p}:`)
    expect([h3!.anahtar, h3!.durum, h3!.oncelik, h3!.baslik]).toEqual([`H3:paket:${p}:SORGU_YOK`, 'ACIK', 'YUKSEK', '22/A borç sorgusu gerekli — Şubat 2026 kira ödemeleri'])
    await sorgu()
    await uret()
    expect((await kayit(`H3:paket:${p}:`)).map((x) => [x.anahtar, x.durum])).toEqual([[`H3:paket:${p}:SORGU_YOK`, 'OTOMATIK_KAPANDI']])
    await uret(t('2026-02-06'))
    expect((await kayit(`H3:paket:${p}:2026-02-09`)).map((x) => x.durum)).toEqual(['ACIK'])
  })

  it('pano satırı iliskiliId taşır; H3 bağlantısı /odeme-paketleri/<id>', async () => {
    await aktifSozlesme(h)
    const p = await paketKur(h)
    await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
    await uret()
    const satir = (await panoVerisi(BUGUN)).listeler.tumu.find((x) => x.kural === 'H3')!
    expect([satir.iliskiliTur, satir.iliskiliId, satir.sozlesmeId]).toEqual(['paket', String(p), null])
    expect(hatirlatmaAdresi(satir)).toBe(`/odeme-paketleri/${p}`)
    expect(hatirlatmaAdresi({ sozlesmeId: null, kural: 'H9', iliskiliTur: 'sistem', iliskiliId: 'muhtasar' })).toBe('/raporlar')
  })
})
