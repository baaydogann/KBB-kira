import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Taksit } from '@/generated/prisma'
import { para } from '@/core/para'
import { tarih as t, type Tarih } from '@/core/tarih'
import { artisOnayla, artislariHesapla } from '@/server/artis/servis'
import { prisma } from '@/server/db'
import { tarihDb } from '@/server/donustur'
import { IsKuraliHatasi } from '@/server/hata'
import { sozlesmeAktiflestir } from '@/server/sozlesme/servis'
import { sozlesmeFeshet, sozlesmeYenile } from '@/server/sozlesme/yasam-dongusu'
import { taksitPlaniniGuncelle, taksitSistemDisiOdemeGeriAl, taksitSistemDisiOdendi } from '@/server/taksit/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { hazirlik, type Hazirlik } from './sozlesme-yardimci'
import { aktifSozlesme, paketKur } from './paket-yardimci'

let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

const SUBAT20 = t('2026-02-20')
const tumTaksitler = (sozlesmeId: number) => prisma.taksit.findMany({ where: { sozlesmeId }, orderBy: [{ donemBaslangic: 'asc' }, { id: 'asc' }] })
const ay = async (sozlesmeId: number, bas: string, tur: 'NORMAL' | 'FARK' = 'NORMAL') =>
  (await tumTaksitler(sozlesmeId)).find((x) => tarihDb(x.donemBaslangic) === bas && x.tur === tur && x.durum !== 'IPTAL')!
const durumYap = (x: Pick<Taksit, 'id'>, durum: 'PLANLANDI' | 'PAKETTE' | 'ODENDI') => prisma.taksit.update({ where: { id: x.id }, data: { durum } })
const plan = (sozlesmeId: number, bugun: Tarih) => prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, sozlesmeId, bugun))
const hatirlatmalar = (sozlesmeId: number) => prisma.hatirlatma.findMany({ where: { sozlesmeId, kural: 'H5_FAZLA_ODEME' }, orderBy: { id: 'asc' } })
const hata = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)

/** 2025-03-01–2027-02-28 sözleşme, aylık 10.000; Mart 2026 artışı 2026-02-20'de onaylanabilir (Mart taksiti vadesi 03-01, gelecekte). */
async function artisliSozlesme(): Promise<number> {
  return aktifSozlesme(h, { baslangic: '2025-03-01', bitis: '2027-02-28', imzaTarihi: '2025-02-20' }, SUBAT20)
}
async function martArtisiniOnayla(s: number, bugun: Tarih = SUBAT20): Promise<string> {
  await prisma.$transaction((tx) => artislariHesapla(tx, bugun, s))
  const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: s, donemBaslangic: new Date('2026-03-01') } })
  await artisOnayla(a.id, a.version, TEST_BAGLAMI, bugun)
  return a.yeniBedel!.toFixed(2)
}
const aktifToplam = (xs: Taksit[]) => xs.filter((x) => x.durum !== 'IPTAL').reduce((top, x) => top.plus(x.tutar.toString()), para('0')).toFixed(2)

describe('paket iptali benzetimi (Review Focus #1)', () => {
  it('paket iptali benzetimi, FARK tahakkuk etmemiş: Mart taksiti PAKETTE iken artış onaylanır → FARK (vade 03-02); taksit PLANLANDI a döndürülüp plan çalışınca FARK IPTAL, ana tutar yeni bedel; aktif toplam = yeni bedel', async () => {
    const s = await artisliSozlesme()
    const mart = await ay(s, '2026-03-01')
    await durumYap(mart, 'PAKETTE')
    const yeni = await martArtisiniOnayla(s)
    const fark = await ay(s, '2026-03-01', 'FARK')
    expect(tarihDb(fark.vadeTarihi)).toBe('2026-03-02')
    await durumYap(mart, 'PLANLANDI')
    await plan(s, SUBAT20)
    const martlar = (await tumTaksitler(s)).filter((x) => tarihDb(x.donemBaslangic) === '2026-03-01')
    expect(martlar.find((x) => x.id === fark.id)!.durum).toBe('IPTAL')
    expect(martlar.find((x) => x.id === mart.id)!.tutar.toFixed(2)).toBe(yeni)
    expect(aktifToplam(martlar)).toBe(yeni)
  })

  it('paket iptali benzetimi, FARK ödeme sürecinde: FARK PAKETTE iken ana PLANLANDI a döner → ana 10.000 kalır, FARK sürer; aktif toplam = yeni bedel', async () => {
    const s = await artisliSozlesme()
    const mart = await ay(s, '2026-03-01')
    await durumYap(mart, 'PAKETTE')
    const yeni = await martArtisiniOnayla(s)
    const fark = await ay(s, '2026-03-01', 'FARK')
    await durumYap(fark, 'PAKETTE')
    await durumYap(mart, 'PLANLANDI')
    const ozet = await plan(s, SUBAT20)
    const martlar = (await tumTaksitler(s)).filter((x) => tarihDb(x.donemBaslangic) === '2026-03-01')
    expect(martlar.find((x) => x.id === mart.id)!.tutar.toFixed(2)).toBe('10000.00')
    expect(martlar.find((x) => x.id === fark.id)!.durum).toBe('PAKETTE')
    expect(aktifToplam(martlar)).toBe(yeni)
    expect(ozet.gecmisDokunulmadi).toBe(1)
  })

  it('fiyatı değişmeyen donmamış ana satırın tahakkuk etmemiş FARK ı da iptal edilir', async () => {
    const s = await aktifSozlesme(h)
    const mayis = await ay(s, '2026-05-01')
    const kd = await prisma.kiraDonemi.findFirstOrThrow({ where: { sozlesmeId: s } })
    const fark = await prisma.taksit.create({
      data: {
        sozlesmeId: s, tur: 'FARK', donemBaslangic: new Date('2026-05-01'), donemBitis: new Date('2026-05-31'), vadeTarihi: new Date('2026-05-15'),
        tutar: '500.00', hesapGoruntusu: {}, anaTaksitId: mayis.id, kiraDonemiId: kd.id,
      },
    })
    await plan(s, SUBAT20)
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: fark.id } })).durum).toBe('IPTAL')
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: mayis.id } })).tutar.toFixed(2)).toBe('10000.00')
  })
})

describe('fesih ve yenilemede ödeme sürecindeki satırlar', () => {
  it('fesih sonrası dönemi dışında kalan PAKETTE taksit iptal edilmez; "ödeme sürecinde" metniyle H5_FAZLA_ODEME açılır; gecmisDokunulmadi saymaz', async () => {
    const s = await aktifSozlesme(h)
    const eylul = await ay(s, '2026-09-01')
    await durumYap(eylul, 'PAKETTE')
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    await sozlesmeFeshet(s, sozlesme.version, { tarih: t('2026-06-30'), neden: 'Tahliye edildi' }, TEST_BAGLAMI, t('2026-06-01'))
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: eylul.id } })).durum).toBe('PAKETTE')
    const hs = await hatirlatmalar(s)
    const bu = hs.find((x) => x.anahtar === `H5_FAZLA:taksit:${eylul.id}:IPTAL`)!
    expect(bu.aciklama).toContain('ödeme sürecinde (PAKETTE)')
    expect((await plan(s, t('2026-06-01'))).gecmisDokunulmadi).toBe(0)
  })

  it('fesih sonrası, FARK ı tahakkuk etmemiş vadesi gelmemiş PLANLANDI satır: FARK ve ana satır iptal edilir (dondurulmaz)', async () => {
    const s = await artisliSozlesme()
    const mart = await ay(s, '2026-03-01')
    await durumYap(mart, 'PAKETTE')
    await martArtisiniOnayla(s)
    const fark = await ay(s, '2026-03-01', 'FARK')
    await durumYap(mart, 'PLANLANDI')
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    await sozlesmeFeshet(s, sozlesme.version, { tarih: t('2026-02-28'), neden: 'Tahliye edildi' }, TEST_BAGLAMI, SUBAT20)
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: mart.id } })).durum).toBe('IPTAL')
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: fark.id } })).durum).toBe('IPTAL')
  })

  it('fesih sonrası sözleşme dışında kalan, FARK ı PAKETTE olan vadesi gelmemiş ana satır: ana IPTAL, FARK için fazla ödeme hatırlatması (FARK kimliğiyle)', async () => {
    const s = await artisliSozlesme()
    const mart = await ay(s, '2026-03-01')
    await durumYap(mart, 'PAKETTE')
    await martArtisiniOnayla(s)
    const fark = await ay(s, '2026-03-01', 'FARK')
    await durumYap(fark, 'PAKETTE')
    await durumYap(mart, 'PLANLANDI')
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    await sozlesmeFeshet(s, sozlesme.version, { tarih: t('2026-02-28'), neden: 'Tahliye edildi' }, TEST_BAGLAMI, SUBAT20)
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: mart.id } })).durum).toBe('IPTAL')
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: fark.id } })).durum).toBe('PAKETTE')
    const bu = (await hatirlatmalar(s)).find((x) => x.anahtar === `H5_FAZLA:taksit:${fark.id}:IPTAL`)!
    expect(bu.aciklama).toContain('fark taksiti')
  })

  it('yenilemede önceki sözleşmenin ODENDI taksiti (dönemi yeni başlangıçtan sonra) devredilmez; tek bir DEVIR hatırlatması açılır, IPTAL ekli ikinci hatırlatma açılmaz', async () => {
    const eski = await aktifSozlesme(h)
    const subat27 = await ay(eski, '2027-02-01')
    await durumYap(subat27, 'ODENDI')
    const yeni = await sozlesmeYenile(eski, TEST_BAGLAMI, t('2026-12-01'))
    await sozlesmeAktiflestir(yeni, 0, TEST_BAGLAMI, t('2026-12-10'))
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: subat27.id } })).durum).toBe('ODENDI')
    const ilgili = (await hatirlatmalar(eski)).filter((x) => x.iliskiliId === String(subat27.id))
    expect(ilgili.map((x) => x.anahtar)).toEqual([`H5_FAZLA:taksit:${subat27.id}:DEVIR`])
    expect(ilgili[0]!.aciklama).toContain('yeni sözleşmenin')
    expect(ilgili[0]!.aciklama).toContain('ödeme sürecinde (ODENDI)')
  })

  it('TASLAK yenileme varken (aktifleştirilmemiş) fesih: hatırlatma eki IPTAL, DEVIR değil', async () => {
    const s = await aktifSozlesme(h)
    const subat27 = await ay(s, '2027-02-01')
    await durumYap(subat27, 'PAKETTE')
    await sozlesmeYenile(s, TEST_BAGLAMI, t('2026-06-01'))
    const sozlesme = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    await sozlesmeFeshet(s, sozlesme.version, { tarih: t('2026-06-30'), neden: 'Tahliye edildi' }, TEST_BAGLAMI, t('2026-06-01'))
    const anahtarlar = (await hatirlatmalar(s)).filter((x) => x.iliskiliId === String(subat27.id)).map((x) => x.anahtar)
    expect(anahtarlar).toEqual([`H5_FAZLA:taksit:${subat27.id}:IPTAL`])
  })

  it('yenileme devrinde iptal edilen ana satırın ODENDI FARK ı için DEVIR hatırlatması', async () => {
    const eski = await aktifSozlesme(h)
    const subat27 = await ay(eski, '2027-02-01')
    const kd = await prisma.kiraDonemi.findFirstOrThrow({ where: { sozlesmeId: eski } })
    const fark = await prisma.taksit.create({
      data: {
        sozlesmeId: eski, tur: 'FARK', donemBaslangic: new Date('2027-02-01'), donemBitis: new Date('2027-02-28'), vadeTarihi: new Date('2026-11-20'),
        tutar: '500.00', hesapGoruntusu: {}, anaTaksitId: subat27.id, kiraDonemiId: kd.id, durum: 'ODENDI',
      },
    })
    const yeni = await sozlesmeYenile(eski, TEST_BAGLAMI, t('2026-12-01'))
    await sozlesmeAktiflestir(yeni, 0, TEST_BAGLAMI, t('2026-12-10'))
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: subat27.id } })).durum).toBe('IPTAL')
    const bu = (await hatirlatmalar(eski)).find((x) => x.anahtar === `H5_FAZLA:taksit:${fark.id}:DEVIR`)!
    expect(bu.aciklama).toContain('fark taksiti')
  })
})

describe('sistem dışı ödeme', () => {
  it('sistem dışı ödendi: PLANLANDI → ODENDI, odemeTarihi ve not yazılır; denetimde not metni yok', async () => {
    const s = await aktifSozlesme(h)
    const subat = await ay(s, '2026-02-01')
    await taksitSistemDisiOdendi(subat.id, subat.version, { odemeTarihi: t('2026-02-03'), not: 'Banka dekontu, Ahmet Yılmaz' }, TEST_BAGLAMI, t('2026-02-10'))
    const x = await prisma.taksit.findUniqueOrThrow({ where: { id: subat.id } })
    expect([x.durum, x.sistemDisiOdeme, tarihDb(x.odemeTarihi!), x.odemeNotu, x.version]).toEqual(['ODENDI', true, '2026-02-03', 'Banka dekontu, Ahmet Yılmaz', subat.version + 1])
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'taksit', varlikId: String(subat.id), eylem: 'SISTEM_DISI_ODENDI' } })
    expect(d.sonra).toMatchObject({ odemeTarihi: '2026-02-03', notGirildi: true })
    expect(JSON.stringify(d.sonra)).not.toContain('Ahmet')
  })

  it('sistem dışı ödendi: aktif paketteki taksit ve ileri tarih reddedilir', async () => {
    const s = await aktifSozlesme(h)
    const subat = await ay(s, '2026-02-01')
    await paketKur(h)
    const e = await hata(taksitSistemDisiOdendi(subat.id, subat.version, { odemeTarihi: t('2026-02-03'), not: 'dekont' }, TEST_BAGLAMI, t('2026-02-10')))
    expect((e as Error).message).toBe('Taksit bir ödeme paketinde; önce paketten çıkarın.')
    const mart = await ay(s, '2026-03-01')
    const ileri = await hata(taksitSistemDisiOdendi(mart.id, mart.version, { odemeTarihi: t('2026-02-11'), not: 'dekont' }, TEST_BAGLAMI, t('2026-02-10')))
    expect((ileri as IsKuraliHatasi).alan).toBe('odemeTarihi')
    expect(await hata(taksitSistemDisiOdendi(mart.id, mart.version, { odemeTarihi: t('2026-02-10'), not: '  ' }, TEST_BAGLAMI, t('2026-02-10')))).toBeInstanceOf(IsKuraliHatasi)
  })

  it('geri al: ODENDI (sistem dışı) → PLANLANDI ve plan yeniden fiyatlar; sistem dışı olmayan ODENDI reddedilir', async () => {
    const s = await aktifSozlesme(h)
    const mart = await ay(s, '2026-03-01')
    await taksitSistemDisiOdendi(mart.id, mart.version, { odemeTarihi: t('2026-02-09'), not: 'dekont' }, TEST_BAGLAMI, t('2026-02-10'))
    await prisma.taksit.update({ where: { id: mart.id }, data: { tutar: '1.00' } })
    const v = (await prisma.taksit.findUniqueOrThrow({ where: { id: mart.id } })).version
    await taksitSistemDisiOdemeGeriAl(mart.id, v, TEST_BAGLAMI, t('2026-02-10'))
    const x = await prisma.taksit.findUniqueOrThrow({ where: { id: mart.id } })
    expect([x.durum, x.sistemDisiOdeme, x.odemeTarihi, x.odemeNotu, x.tutar.toFixed(2)]).toEqual(['PLANLANDI', false, null, null, '10000.00'])
    const nisan = await ay(s, '2026-04-01')
    await durumYap(nisan, 'ODENDI')
    const e = await hata(taksitSistemDisiOdemeGeriAl(nisan.id, nisan.version, TEST_BAGLAMI, t('2026-02-10')))
    expect((e as Error).message).toBe('Paketle ödenen taksit buradan geri alınamaz.')
  })
})
