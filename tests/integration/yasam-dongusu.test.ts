import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, type Tx } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import type { MalikGirdisi } from '@/server/sozlesme/sema'
import {
  belirsizSureliyeCevir, malikleriDegistir, otomatikUzat, sozlesmeFeshet, sozlesmeSonlandir, sozlesmeYenile, taslakSil,
} from '@/server/sozlesme/yasam-dongusu'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { taksitPlaniniGuncelle } from '@/server/taksit/servis'
import { hatirlatmalariUret } from '@/core/hatirlatma'
import { hatirlatmaVerisiYukle } from '@/server/hatirlatma/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null

beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

async function aktif(ek: Record<string, unknown> = {}, bugun = t('2026-01-01')) {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
  return id
}
const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version

describe('malik değişikliği (TBK 310)', () => {
  it('eski kayıtları bir gün önce kapatır, yenileri açar; hisse toplamı denetlenir', async () => {
    const id = await aktif()
    const yeni = [
      { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
      { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null },
    ]
    await expect(malikleriDegistir(id, await surum(id), { tarih: t('2026-07-01'), malikler: yeni.slice(0, 1) }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    await malikleriDegistir(id, await surum(id), { tarih: t('2026-07-01'), malikler: yeni }, TEST_BAGLAMI)
    const m = await prisma.sozlesmeMalik.findMany({ where: { sozlesmeId: id }, orderBy: { id: 'asc' } })
    expect(m.map((x) => [x.kisiId, `${x.pay}/${x.payda}`, iso(x.gecerlilikBaslangic), iso(x.gecerlilikBitis)])).toEqual([
      [h.kisiA, '1/1', '2026-01-01', '2026-06-30'],
      [h.kisiA, '1/2', '2026-07-01', null],
      [h.kisiB, '1/2', '2026-07-01', null],
    ])
  })

  it('bilinmeyen kişi/vekil, başkasının IBAN\'ı, yinelenen kişi ve geçersiz tarih ham veritabanı hatası değil iş kuralı hatasıdır; hiçbir şey değişmez', async () => {
    const id = await aktif()
    const v = await surum(id)
    const tam = (ek: Partial<MalikGirdisi>): MalikGirdisi => ({ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null, ...ek })
    const dene = (tarih: string, malikler: MalikGirdisi[]) => malikleriDegistir(id, v, { tarih: t(tarih), malikler }, TEST_BAGLAMI)
    await expect(dene('2026-07-01', [tam({ kisiId: 999_999 })])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'KISI' })
    await expect(dene('2026-07-01', [tam({ vekilKisiId: 999_999 })])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'VEKIL' })
    await expect(dene('2026-07-01', [tam({ ibanId: 999_999 })])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'IBAN' })
    await expect(dene('2026-07-01', [tam({ ibanId: h.ibanB })])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'IBAN' })
    await expect(dene('2026-07-01', [tam({ pay: 1, payda: 2 }), tam({ pay: 1, payda: 2 })])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'MALIK' })
    await expect(dene('2026-01-01', [tam({})])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'TARIH' })
    await expect(dene('2027-01-01', [tam({})])).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'TARIH' })
    expect(await surum(id)).toBe(v)
    expect(await prisma.sozlesmeMalik.count({ where: { sozlesmeId: id } })).toBe(1)
    // Aynı gün ikinci değişiklik: ilk değişiklikle başlayan açık kayıt var.
    await dene('2026-07-01', [tam({ pay: 1, payda: 2 }), tam({ kisiId: h.kisiB, ibanId: h.ibanB, pay: 1, payda: 2 })])
    await expect(malikleriDegistir(id, await surum(id), { tarih: t('2026-07-01'), malikler: [tam({})] }, TEST_BAGLAMI)).rejects.toMatchObject({ kod: 'TARIH' })
  })
})

describe('fesih', () => {
  it('fesih tarihinden sonraki planlı taksitler iptal, kesişen taksit kıst olur', async () => {
    const id = await aktif()
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01'))
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([s.durum, iso(s.fesihTarihi)]).toEqual(['FESHEDILDI', '2026-06-15'])
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    // I1: Temmuz–Aralık ve ufka kadar planlanan 2027-01..2028-01.
    expect(taksitler.filter((x) => x.durum === 'IPTAL')).toHaveLength(19)
    const haziran = taksitler.find((x) => iso(x.donemBaslangic) === '2026-06-01')!
    expect([haziran.tur, iso(haziran.donemBitis), haziran.tutar.toFixed(2)]).toEqual(['KIST', '2026-06-15', '5000.00'])
  })

  it('fesih tarihinden sonraki bekleyen artış hesapları iptal edilir; önceki ve onaylı olanlar kalır', async () => {
    const id = await aktif()
    const artis = (donemBaslangic: string, durum: 'BEKLEMEDE' | 'HESAPLANDI' | 'ONAYLANDI') => prisma.artisHesabi.create({
      data: { sozlesmeId: id, donemBaslangic: new Date(donemBaslangic), referansYil: 2026, referansAy: 1, eskiBedel: '10000.00', gerekce: {}, durum },
    })
    await artis('2026-03-01', 'BEKLEMEDE')
    await artis('2026-09-01', 'BEKLEMEDE')
    await artis('2026-10-01', 'HESAPLANDI')
    await artis('2026-11-01', 'ONAYLANDI')
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01'))
    const kayitlar = await prisma.artisHesabi.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(kayitlar.map((a) => [iso(a.donemBaslangic), a.durum])).toEqual([
      ['2026-03-01', 'BEKLEMEDE'], ['2026-09-01', 'IPTAL'], ['2026-10-01', 'IPTAL'], ['2026-11-01', 'ONAYLANDI'],
    ])
  })

  it('denetim satırı, fesih tarihinden sonraki ödeme sürecindeki/ödenmiş taksit sayısını işaret olarak yazar; bu taksitler iptal edilmez', async () => {
    const id = await aktif()
    const durumla = (donem: string, durum: 'PAKETTE' | 'ODEME_EMRINDE' | 'ODENDI') =>
      prisma.taksit.updateMany({ where: { sozlesmeId: id, donemBaslangic: new Date(donem) }, data: { durum } })
    await durumla('2026-06-01', 'ODENDI') // fesih gününden önce başlıyor: sayılmaz
    await durumla('2026-07-01', 'PAKETTE')
    await durumla('2026-08-01', 'ODENDI')
    await durumla('2026-10-01', 'ODEME_EMRINDE')
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01'))
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'FESHET', varlikId: String(id) } })
    const sonra = kayit.sonra as { fesihSonrasiIslenmisTaksit: number; plan: { iptal: number } }
    // I1: ufka kadar planlanan 2027-01..2028-01 (13) de iptal olur.
    expect([sonra.fesihSonrasiIslenmisTaksit, sonra.plan.iptal]).toEqual([3, 16])
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    expect(taksitler.slice(5).map((x) => x.durum)).toEqual(['ODENDI', 'PAKETTE', 'ODENDI', 'IPTAL', 'ODEME_EMRINDE', 'IPTAL', 'IPTAL', ...Array.from({ length: 13 }, () => 'IPTAL')])
  })

  it('C1: geçmiş tarihli fesih vadesi geçmiş taksiti kıst ya da iptal yapmaz, fazla ödeme hatırlatması açar; vadesi gelmemişler iptal olur', async () => {
    const id = await aktif()
    const bugun = t('2026-07-10')
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, bugun)
    const taksitler = await prisma.taksit.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })
    const ay = (bas: string) => taksitler.find((x) => iso(x.donemBaslangic) === bas)!
    const [haziran, temmuz] = [ay('2026-06-01'), ay('2026-07-01')]
    expect([haziran.tur, iso(haziran.donemBitis), haziran.tutar.toFixed(2), haziran.durum, haziran.version]).toEqual(['NORMAL', '2026-06-30', '10000.00', 'PLANLANDI', 0])
    expect([temmuz.durum, temmuz.version]).toEqual(['PLANLANDI', 0])
    const iptal = taksitler.filter((x) => x.durum === 'IPTAL').map((x) => iso(x.donemBaslangic)!)
    expect(iptal.slice(0, 5)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])
    expect(iptal.every((x) => x >= '2026-08-01')).toBe(true)
    const hatirlatmalar = () => prisma.hatirlatma.findMany({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id }, orderBy: { iliskiliId: 'asc' } })
    const h = await hatirlatmalar()
    expect(h.map((x) => [x.iliskiliTur, x.iliskiliId, x.oncelik, x.kararGerekli, x.durum])).toEqual([
      ['taksit', String(haziran.id), 'KRITIK', true, 'ACIK'], ['taksit', String(temmuz.id), 'KRITIK', true, 'ACIK'],
    ])
    expect(h[0]!.aciklama).toContain('5.000,00')
    expect(h[1]!.aciklama).toContain('10.000,00')
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'FESHET', varlikId: String(id) } })
    expect((kayit.sonra as { plan: { iptal: number; gecmisDokunulmadi: number } }).plan).toMatchObject({ iptal: iptal.length, gecmisDokunulmadi: 2 })
    // Plan yeniden çalışınca geçmiş satırlar yine dokunulmaz; hatırlatma çoğalmaz, kullanıcının tamamladığı yeniden açılmaz.
    await prisma.hatirlatma.update({ where: { id: h[0]!.id }, data: { durum: 'TAMAMLANDI' } })
    await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, t('2026-07-11')))
    expect((await hatirlatmalar()).map((x) => [x.id, x.durum, x.hedefTarih.getTime()])).toEqual(h.map((x, i) => [x.id, i === 0 ? 'TAMAMLANDI' : 'ACIK', x.hedefTarih.getTime()]))
    expect((await prisma.taksit.findUniqueOrThrow({ where: { id: haziran.id } })).version).toBe(0)
  })

  it('neden, tarih aralığı ve durum denetlenir', async () => {
    const id = await aktif()
    const v = await surum(id)
    const dene = (tarih: string, neden: string) => sozlesmeFeshet(id, v, { tarih: t(tarih), neden }, TEST_BAGLAMI, t('2026-05-01'))
    await expect(dene('2026-06-15', ' x ')).rejects.toMatchObject({ kod: 'NEDEN' })
    await expect(dene('2025-12-31', 'Hizmet binası taşındı')).rejects.toMatchObject({ kod: 'TARIH' })
    await expect(dene('2027-01-01', 'Hizmet binası taşındı')).rejects.toMatchObject({ kod: 'TARIH' })
    expect(await surum(id)).toBe(v)
    await dene('2026-06-15', 'Hizmet binası taşındı')
    await expect(sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI)).rejects.toMatchObject({ kod: 'DURUM' })
    await expect(sozlesmeFeshet(999_999, 0, { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(BulunamadiHatasi)
  })
})

describe('yenileme', () => {
  it('aynı süre ve son bedelle taslak üretir; malikleri ve ilk kira başlangıcını taşır', async () => {
    const id = await aktif()
    const yeniId = await sozlesmeYenile(id, TEST_BAGLAMI)
    const y = await prisma.sozlesme.findUniqueOrThrow({ where: { id: yeniId }, include: { malikler: true } })
    expect([y.durum, iso(y.baslangic), iso(y.bitis), iso(y.ilkKiraBaslangici), y.bedelTutari.toFixed(2), y.oncekiSozlesmeId])
      .toEqual(['TASLAK', '2027-01-01', '2027-12-31', '2026-01-01', '10000.00', id])
    expect(y.sozlesmeNo).toMatch(/-Y1$/)
    expect(y.malikler).toHaveLength(1)
    await expect(sozlesmeYenile(id, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    await sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, t('2026-12-20'))
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum).toBe('SONA_ERDI')
  })

  it('iki kez uzamış 12 aylık sözleşme 36 ay değil 12 ay olarak yenilenir', async () => {
    const id = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await prisma.$transaction((tx) => otomatikUzat(tx, t('2027-10-01')))
    const uzamis = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([uzamis.durum, iso(uzamis.bitis), uzamis.uzamaSayisi]).toEqual(['UZADI', '2028-09-30', 2])
    const y = await prisma.sozlesme.findUniqueOrThrow({ where: { id: await sozlesmeYenile(id, TEST_BAGLAMI) } })
    expect([iso(y.baslangic), iso(y.bitis), y.uzamaSayisi]).toEqual(['2028-10-01', '2029-09-30', 0])
  })

  it('feshedilmiş sözleşme yenilenmez', async () => {
    const id = await aktif()
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01'))
    await expect(sozlesmeYenile(id, TEST_BAGLAMI)).rejects.toMatchObject({
      name: 'IsKuraliHatasi', kod: 'YENILEME', message: 'Feshedilmiş sözleşme yenilenemez; yeni sözleşme girin.',
    })
    expect(await prisma.sozlesme.count({ where: { oncekiSozlesmeId: id } })).toBe(0)
  })

  it('yenileme numarası en büyük -Yn sonekinin ardılıdır (boşluklu sonekte sıradaki serbest numara)', async () => {
    const id = await aktif()
    const { sozlesmeNo } = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await aktif({ sozlesmeNo: `${sozlesmeNo}-Y2` })
    await aktif({ sozlesmeNo: `${sozlesmeNo}-Y10` })
    await aktif({ sozlesmeNo: `${sozlesmeNo}-Yeni` })
    const y = await prisma.sozlesme.findUniqueOrThrow({ where: { id: await sozlesmeYenile(id, TEST_BAGLAMI) } })
    expect(y.sozlesmeNo).toBe(`${sozlesmeNo}-Y11`)
  })
})

describe('otomatik uzama (TBK 347)', () => {
  it('işyeri bir yıl uzar, kaçırılan yıllar telafi edilir; arsa uzamaz', async () => {
    const isyeri = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const eski = await aktif({ baslangic: '2023-10-01', bitis: '2024-09-30' }, t('2023-10-01'))
    const arsa = await aktif({ tasinmazId: h.arsaId, baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const sayi = await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))
    expect(sayi).toBe(2)
    const [a, b, c] = await Promise.all([isyeri, eski, arsa].map((id) => prisma.sozlesme.findUniqueOrThrow({ where: { id } })))
    expect([a!.durum, iso(a!.bitis), a!.uzamaSayisi]).toEqual(['UZADI', '2027-09-30', 1])
    expect([iso(b!.bitis), b!.uzamaSayisi]).toEqual(['2027-09-30', 3])
    expect([c!.durum, iso(c!.bitis)]).toEqual(['AKTIF', '2026-09-30'])
    // I1: uzayan işyeri planı ufka (2028-10) kadar sürer.
    expect(await prisma.taksit.count({ where: { sozlesmeId: isyeri, donemBaslangic: { gte: new Date('2026-10-01') } } })).toBe(25)
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(0)
  })

  it('sistem bağlamıyla denetim satırı yazar; bitiş geçmemiş sözleşmeye dokunmaz', async () => {
    const gecmis = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const gelecek = await aktif({ baslangic: '2026-01-01', bitis: '2026-12-31' })
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    const kayitlar = await prisma.olayGunlugu.findMany({ where: { eylem: 'OTOMATIK_UZAMA' } })
    expect(kayitlar.map((k) => [k.varlikId, k.kullaniciId])).toEqual([[String(gecmis), null]])
    const sonra = kayitlar[0]!.sonra as { bitis: string; uzamaSayisi: number; plan: { eklenen: number } }
    expect([sonra.bitis, sonra.uzamaSayisi, sonra.plan.eklenen]).toEqual(['2027-09-30', 1, 12])
    expect(iso((await prisma.sozlesme.findUniqueOrThrow({ where: { id: gelecek } })).bitis)).toBe('2026-12-31')
  })

  it('aday listesi okunduktan sonra başka işlemle değişen sözleşme atlanır (satır kilidi + yeniden denetim)', async () => {
    const id = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    let kilitAlindi!: () => void
    const kilitHazir = new Promise<void>((coz) => { kilitAlindi = coz })
    let birak!: () => void
    const bekle = new Promise<void>((coz) => { birak = coz })
    const baskasi = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
      kilitAlindi()
      await bekle
      await tx.sozlesme.update({ where: { id }, data: { durum: 'SONA_ERDI', version: { increment: 1 } } })
    })
    await kilitHazir
    const uzat = prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))
    await kilitBekleyeniBekle()
    birak()
    await baskasi
    expect(await uzat).toBe(0)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([s.durum, iso(s.bitis), s.uzamaSayisi]).toEqual(['SONA_ERDI', '2026-09-30', 0])
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'OTOMATIK_UZAMA' } })).toBe(0)
  })

  it('Şubat 29 çapalı sözleşmede bitiş başlangıca çapalı hesaplanır (zincirleme uzama bir gün erken bırakırdı)', async () => {
    // Başlangıç 2024-02-29: ilk dönem 2025-02-27'de biter (ayEkle 29 Şubat'ı 28 Şubat'a çeker, -1 gün).
    const id = await aktif({ baslangic: '2024-02-29', bitis: '2025-02-27' }, t('2024-02-29'))
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2028-02-10')))).toBe(1)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    // Zincir 2026-02-27, 2027-02-27, 2028-02-27 verirdi; çapalı hesap ayEkle('2024-02-29', 48) - 1 = 2028-02-28.
    expect([s.durum, iso(s.bitis), s.uzamaSayisi]).toEqual(['UZADI', '2028-02-28', 3])
    // Kira ayına hizalı bitiş dönemi (2028-01-29..2028-02-28) tam kalır (I1: plan bitişten sonra ufka kadar sürer).
    const son = await prisma.taksit.findFirstOrThrow({ where: { sozlesmeId: id, durum: { not: 'IPTAL' }, donemBaslangic: new Date('2028-01-29') } })
    expect([iso(son.donemBaslangic), iso(son.donemBitis), son.tur]).toEqual(['2028-01-29', '2028-02-28', 'NORMAL'])
  })

  it.each([
    { ad: '6 aylık, 31 Ağustos çapalı', baslangic: '2025-08-31', bitis: '2026-02-27', bugun: '2027-10-01', beklenen: '2028-02-28', yil: 2 },
    { ad: '11 aylık, 31 Mart çapalı', baslangic: '2025-03-31', bitis: '2026-02-27', bugun: '2027-10-01', beklenen: '2028-02-28', yil: 2 },
  ])('bitişi şubat ayına denk gelen $ad sözleşme artık yılda kaymaz', async ({ baslangic, bitis, bugun, beklenen, yil }) => {
    const id = await aktif({ baslangic, bitis }, t(baslangic))
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t(bugun)))).toBe(1)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([s.durum, iso(s.bitis), s.uzamaSayisi]).toEqual(['UZADI', beklenen, yil])
  })

  it('başlangıca çapalı olmayan bitiş zincirleme uzar (çapaya çekmek gün kaybettirirdi)', async () => {
    // 2023-03-15 başlangıçlı sözleşmenin bitişi 2025-12-31: ay ızgarasında (…-14) değil, elle verilmiş.
    const id = await aktif({ baslangic: '2023-03-15', bitis: '2025-12-31' }, t('2023-03-15'))
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-06-01')))).toBe(1)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([s.durum, iso(s.bitis), s.uzamaSayisi]).toEqual(['UZADI', '2026-12-31', 1])
  })

  it('kendiliğinden uzama sınırları: bitiş günü uzamaz, ertesi gün uzar, uzamış sözleşme ikinci yıl yine uzar; feshedilmiş uzamaz', async () => {
    const id = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const feshedilen = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await sozlesmeFeshet(feshedilen, await surum(feshedilen), { tarih: t('2026-03-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-03-01'))
    const durum = async (x: number) => {
      const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id: x } })
      return [s.durum, iso(s.bitis), s.uzamaSayisi]
    }
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-09-30')))).toBe(0)
    expect(await durum(id)).toEqual(['AKTIF', '2026-09-30', 0])
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-01')))).toBe(1)
    expect(await durum(id)).toEqual(['UZADI', '2027-09-30', 1])
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2027-09-30')))).toBe(0)
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2027-10-01')))).toBe(1)
    expect(await durum(id)).toEqual(['UZADI', '2028-09-30', 2])
    expect(await durum(feshedilen)).toEqual(['FESHEDILDI', '2026-09-30', 0])
  })

  it('uzama kullanıcıya bilgi hatırlatması yazar; satır varsa dokunulmaz, yeniden çalışmada çoğalmaz', async () => {
    const id = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const tasinmaz = await prisma.tasinmaz.findUniqueOrThrow({ where: { id: h.tasinmazId } })
    const { sozlesmeNo } = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    const satirlar = await prisma.hatirlatma.findMany({ where: { kural: 'UZAMA_BILGI' } })
    expect(satirlar).toHaveLength(1)
    const b = satirlar[0]!
    expect([b.anahtar, b.iliskiliTur, b.iliskiliId, b.sozlesmeId, b.baslik, b.aciklama]).toEqual([
      `UZAMA:sozlesme:${id}:2027-09-30`, 'sozlesme', String(id), id, `Sözleşme kendiliğinden uzadı — ${sozlesmeNo}`,
      `${tasinmaz.kisaAd}: TBK 347 uyarınca 30.09.2027 tarihine kadar uzadı.`,
    ])
    expect([iso(b.hedefTarih), iso(b.gorunurTarih), b.oncelik, b.kararGerekli, b.durum]).toEqual(['2026-10-01', '2026-10-15', 'NORMAL', false, 'ACIK'])
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(0)
    expect(await prisma.hatirlatma.count({ where: { kural: 'UZAMA_BILGI' } })).toBe(1)

    // Aynı anahtarlı satır önceden varsa (ör. kullanıcı kapatmış): uzama yine yapılır, satır olduğu gibi kalır.
    const ikinci = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await prisma.hatirlatma.create({
      data: {
        anahtar: `UZAMA:sozlesme:${ikinci}:2027-09-30`, kural: 'UZAMA_BILGI', iliskiliTur: 'sozlesme', iliskiliId: String(ikinci), sozlesmeId: ikinci,
        baslik: 'Önceden', aciklama: 'Önceden', hedefTarih: new Date('2026-10-01'), gorunurTarih: new Date('2026-10-01'), oncelik: 'NORMAL', durum: 'TAMAMLANDI',
      },
    })
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    const onceki = await prisma.hatirlatma.findUniqueOrThrow({ where: { anahtar: `UZAMA:sozlesme:${ikinci}:2027-09-30` } })
    expect([onceki.baslik, onceki.durum]).toEqual(['Önceden', 'TAMAMLANDI'])
    expect(await prisma.hatirlatma.count({ where: { kural: 'UZAMA_BILGI' } })).toBe(2)
  })

  it('sozlesmeId verilirse yalnızca o sözleşme aday olur; verilmezse hepsi uzar', async () => {
    const a = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const b = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const durum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).durum
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15'), TEST_BAGLAMI, b))).toBe(1)
    expect([await durum(a), await durum(b)]).toEqual(['AKTIF', 'UZADI'])
    // Aday olmayan (bitişi geçmemiş ya da zaten uzamış) sözleşme için filtre 0 döner.
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15'), TEST_BAGLAMI, b))).toBe(0)
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15'), TEST_BAGLAMI, 999_999))).toBe(0)
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    expect([await durum(a), await durum(b)]).toEqual(['UZADI', 'UZADI'])
  })

  it('uzatılamayan sözleşme (IsKuraliHatasi) geri alınır, KRITIK hatırlatma yazılır; diğer sözleşmeler uzar', async () => {
    const iyi1 = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const zehirli = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const iyi2 = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    // Kira dönemi olmayan sözleşmenin taksit planı üretilemez (DONEM_DISI): plan aşamasında IsKuraliHatasi.
    await prisma.kiraDonemi.deleteMany({ where: { sozlesmeId: zehirli } })
    const once = await prisma.sozlesme.findUniqueOrThrow({ where: { id: zehirli } })
    const taksitSayisi = await prisma.taksit.count({ where: { sozlesmeId: zehirli } })

    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(2)
    const durumlar = await Promise.all([iyi1, zehirli, iyi2].map(async (x) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id: x } })).durum))
    expect(durumlar).toEqual(['UZADI', 'AKTIF', 'UZADI'])
    const sonra = await prisma.sozlesme.findUniqueOrThrow({ where: { id: zehirli } })
    expect([sonra.version, iso(sonra.bitis), sonra.uzamaSayisi]).toEqual([once.version, '2026-09-30', 0])
    expect(await prisma.taksit.count({ where: { sozlesmeId: zehirli } })).toBe(taksitSayisi)
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'OTOMATIK_UZAMA', varlikId: String(zehirli) } })).toBe(0)

    const hata = await prisma.hatirlatma.findMany({ where: { kural: 'UZAMA_HATA' } })
    expect(hata).toHaveLength(1)
    const e = hata[0]!
    expect([e.anahtar, e.iliskiliTur, e.iliskiliId, e.sozlesmeId, e.baslik, e.oncelik, e.kararGerekli, e.durum]).toEqual([
      `UZAMA_HATA:sozlesme:${zehirli}:2026-09-30`, 'sozlesme', String(zehirli), zehirli, `Otomatik uzama yapılamadı — ${once.sozlesmeNo}`, 'KRITIK', true, 'ACIK',
    ])
    expect([iso(e.hedefTarih), iso(e.gorunurTarih)]).toEqual(['2026-10-01', '2026-10-15'])
    expect(e.aciklama).toContain('Taksit döneminin bir kısmı için kira bedeli tanımlı değil.')
    expect(await prisma.hatirlatma.count({ where: { kural: 'UZAMA_BILGI' } })).toBe(2)

    // Ertesi gün: sorun sürüyorsa yine bildirilir ama satır çoğalmaz.
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-16')))).toBe(0)
    expect(await prisma.hatirlatma.count({ where: { kural: 'UZAMA_HATA' } })).toBe(1)
  })
})

describe('I1: TBK 347 sözleşmelerinin planı bitişten sonra ufka kadar sürer', () => {
  const taksitler = (id: number) => prisma.taksit.findMany({ where: { sozlesmeId: id, tur: { not: 'FARK' } }, orderBy: { donemBaslangic: 'asc' } })
  const ay = (d: Date) => iso(d)!.slice(0, 7)

  it('1 yıllık işyeri sözleşmesinin taksitleri bitişten sonra TAKVIM_UFUK_AY ufkuna kadar son bedelle planlanır; arsa planlanmaz', async () => {
    const isyeri = await aktif()
    const x = await taksitler(isyeri)
    expect([ay(x[0]!.donemBaslangic), ay(x.at(-1)!.donemBaslangic), x.length]).toEqual(['2026-01', '2028-01', 25])
    expect(x.every((t) => t.durum === 'PLANLANDI' && t.tur === 'NORMAL' && t.tutar.toFixed(2) === '10000.00')).toBe(true)
    expect(x.filter((t) => iso(t.donemBaslangic)! > '2026-12-31')).toHaveLength(13)
    const arsa = await aktif({ tasinmazId: h.arsaId })
    const a = await taksitler(arsa)
    expect([ay(a.at(-1)!.donemBaslangic), a.length]).toEqual(['2026-12', 12])
  })

  it('bitişi ay ortasında biten işyeri sözleşmesinin son dönemi kıst kesilmez (uzayacağı varsayılır)', async () => {
    const id = await aktif({ baslangic: '2026-01-15', bitis: '2026-12-31' })
    const aralik = (await taksitler(id)).find((t) => iso(t.donemBaslangic) === '2026-12-15')!
    expect([aralik.tur, iso(aralik.donemBitis), aralik.tutar.toFixed(2)]).toEqual(['NORMAL', '2027-01-14', '10000.00'])
  })

  it('otomatik uzama yinelenen satır üretmez; fesih ufka kadar planlanan satırları iptal eder', async () => {
    const id = await aktif()
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2027-01-05')))).toBe(1)
    const x = await taksitler(id)
    const aktifler = x.filter((t) => t.durum !== 'IPTAL')
    expect(new Set(aktifler.map((t) => iso(t.donemBaslangic))).size).toBe(aktifler.length)
    expect([x.filter((t) => t.durum === 'IPTAL').length, ay(aktifler.at(-1)!.donemBaslangic)]).toEqual([0, '2029-01'])
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'OTOMATIK_UZAMA', varlikId: String(id) } })
    expect((kayit.sonra as { plan: { eklenen: number; guncellenen: number; iptal: number } }).plan).toMatchObject({ eklenen: 12, guncellenen: 0, iptal: 0 })

    const fesihli = await aktif()
    await sozlesmeFeshet(fesihli, await surum(fesihli), { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01'))
    const f = await taksitler(fesihli)
    expect(f.filter((t) => t.durum !== 'IPTAL').map((t) => ay(t.donemBaslangic)).at(-1)).toBe('2026-06')
    expect(f.filter((t) => t.durum === 'IPTAL')).toHaveLength(19)
  })

  it('yenileme ile kapanan sözleşmenin ufka kadar planlanan satırları iptal olur; yenilemenin satırlarıyla çakışmaz', async () => {
    const eski = await aktif()
    const yeni = await sozlesmeYenile(eski, TEST_BAGLAMI)
    await sozlesmeAktiflestir(yeni, 0, TEST_BAGLAMI, t('2026-12-20'))
    const e = await taksitler(eski)
    expect(e.filter((t) => t.durum !== 'IPTAL').map((t) => ay(t.donemBaslangic)).at(-1)).toBe('2026-12')
    expect(e.filter((t) => t.durum === 'IPTAL').every((t) => iso(t.donemBaslangic)! >= '2027-01-01')).toBe(true)
    expect(ay((await taksitler(yeni))[0]!.donemBaslangic)).toBe('2027-01')
  })

  it('sonraki kira yılının ilk taksiti H1 (7 gün önce) ve H2 hatırlatmasını önceden alır', async () => {
    const id = await aktif()
    const ocak = (await taksitler(id)).find((t) => iso(t.donemBaslangic) === '2027-01-01')!
    const adaylar = hatirlatmalariUret(await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, t('2026-12-25'))))
    expect(adaylar.filter((x) => x.iliskiliTur === 'taksit' && x.iliskiliId === String(ocak.id)).map((x) => x.kural).sort()).toEqual(['H1', 'H2'])
  })
})

describe('geç aktifleştirilen yenileme: önceki sözleşmenin çakışan planlı taksitleri devredilir', () => {
  const taksitler = (id: number) => prisma.taksit.findMany({ where: { sozlesmeId: id, tur: { not: 'FARK' } }, orderBy: { donemBaslangic: 'asc' } })

  /** 2025-11-01..2026-10-31 işyeri sözleşmesi (plan ufka, 2027-11'e kadar); yenilemesi 2026-11-01'de başlar, 2026-12-10'da aktifleştirilir. */
  async function gecYenileme(oncesinde?: (eski: number) => Promise<void>) {
    const eski = await aktif({ baslangic: '2025-11-01', bitis: '2026-10-31' }, t('2025-11-01'))
    await oncesinde?.(eski)
    const yeni = await sozlesmeYenile(eski, TEST_BAGLAMI)
    await sozlesmeAktiflestir(yeni, 0, TEST_BAGLAMI, t('2026-12-10'))
    return { eski, yeni }
  }

  it('her dönem için önceki ve yeni sözleşmede toplam tek etkin taksit kalır; devredilenler denetime yazılır', async () => {
    const { eski, yeni } = await gecYenileme()
    const hepsi = [...await taksitler(eski), ...await taksitler(yeni)].filter((x) => x.durum !== 'IPTAL')
    const sayilar = new Map<string, number>()
    for (const x of hepsi) sayilar.set(iso(x.donemBaslangic)!, (sayilar.get(iso(x.donemBaslangic)!) ?? 0) + 1)
    expect([...sayilar.values()].every((n) => n === 1)).toBe(true)
    expect([...sayilar.keys()].sort()[0]).toBe('2025-11-01')
    const devredilen = (await taksitler(eski)).filter((x) => iso(x.donemBaslangic)! >= '2026-11-01')
    expect(devredilen.every((x) => x.durum === 'IPTAL')).toBe(true)
    expect(devredilen.map((x) => iso(x.donemBaslangic)!.slice(0, 7))).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11',
    ])
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'YENILEME_ILE_SONA_ERDI', varlikId: String(eski) } })
    expect(kayit.sonra).toMatchObject({ durum: 'SONA_ERDI', devredilenTaksitIdleri: devredilen.map((x) => x.id), plan: { iptal: 0, gecmisDokunulmadi: 0 } })
  })

  it('vadesi geçmiş devredilen taksit için mahsup hatırlatması açılır; vadesi gelmemiş taksit için açılmaz; ödeme sürecindeki taksit için ödeme sürecinde metniyle açılır', async () => {
    const { eski } = await gecYenileme(async (id) => {
      // Ocak 2027 ödeme sürecinde: dokunulmaz, devredilmez; F2: plan yeni sözleşmenin dönemine düşen bu satır için DEVIR hatırlatması açar.
      await prisma.taksit.updateMany({ where: { sozlesmeId: id, donemBaslangic: new Date('2027-01-01') }, data: { durum: 'PAKETTE' } })
    })
    const x = await taksitler(eski)
    const ay = (bas: string) => x.find((y) => iso(y.donemBaslangic) === bas)!
    expect([ay('2026-11-01').durum, ay('2026-12-01').durum, ay('2027-01-01').durum, ay('2027-02-01').durum]).toEqual(['IPTAL', 'IPTAL', 'PAKETTE', 'IPTAL'])
    const h = await prisma.hatirlatma.findMany({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: eski }, orderBy: { iliskiliId: 'asc' } })
    const { sozlesmeNo } = await prisma.sozlesme.findUniqueOrThrow({ where: { id: eski } })
    expect(h.map((k) => [k.anahtar, k.iliskiliTur, k.oncelik, k.kararGerekli, k.durum])).toEqual([
      [`H5_FAZLA:taksit:${ay('2026-11-01').id}:DEVIR`, 'taksit', 'KRITIK', true, 'ACIK'],
      [`H5_FAZLA:taksit:${ay('2026-12-01').id}:DEVIR`, 'taksit', 'KRITIK', true, 'ACIK'],
      [`H5_FAZLA:taksit:${ay('2027-01-01').id}:DEVIR`, 'taksit', 'KRITIK', true, 'ACIK'],
    ])
    expect(h[0]!.baslik).toBe(`Fazla ödeme kontrolü — ${sozlesmeNo}`)
    expect(h[0]!.aciklama).toBe(
      `Önceki sözleşmenin 01.11.2026 – 30.11.2026 taksiti (vade 01.11.2026) yeni sözleşmeye (${sozlesmeNo}-Y1) devredildi; ödendiyse yeni sözleşmenin aynı dönem taksitinden mahsup edin.`,
    )
    expect(h[2]!.aciklama).toBe(
      `Önceki sözleşmenin 01.01.2027 – 31.01.2027 taksiti (vade 01.01.2027) ödeme sürecinde (PAKETTE); yeni sözleşmenin (${sozlesmeNo}-Y1) aynı dönem taksitinden mahsup edin ya da paket kesinleşmediyse iptal edin.`,
    )
  })
})

describe('yenilemeyle kapanan sözleşmenin uzama yılları', () => {
  it.each([
    { yeniBaslangic: '2024-10-01', yeniBitis: '2025-09-30', uzama: 0, bitis: '2024-09-30' },
    { yeniBaslangic: '2025-10-01', yeniBitis: '2026-09-30', uzama: 1, bitis: '2025-09-30' },
    { yeniBaslangic: '2026-01-01', yeniBitis: '2026-12-31', uzama: 2, bitis: '2025-12-31' },
  ])('yenileme $yeniBaslangic tarihinde başlayınca kesimden sonra başlayan uzama yılları geri alınır', async ({ yeniBaslangic, yeniBitis, uzama, bitis }) => {
    // 2023-10-01..2024-09-30 sözleşmesi üç kez uzadı: bitiş 2027-09-30, uzamaSayisi 3.
    const id = await aktif({ baslangic: '2023-10-01', bitis: '2024-09-30' }, t('2023-10-01'))
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    const yeniId = await sozlesmeYenile(id, TEST_BAGLAMI)
    await prisma.sozlesme.update({ where: { id: yeniId }, data: { baslangic: new Date(yeniBaslangic), bitis: new Date(yeniBitis) } })
    await prisma.sozlesmeMalik.updateMany({ where: { sozlesmeId: yeniId }, data: { gecerlilikBaslangic: new Date(yeniBaslangic) } })
    await sozlesmeAktiflestir(yeniId, 0, TEST_BAGLAMI, t('2026-10-20'))
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    expect([s.durum, iso(s.bitis), s.uzamaSayisi]).toEqual(['SONA_ERDI', bitis, uzama])
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'YENILEME_ILE_SONA_ERDI', varlikId: String(id) } })
    expect([(kayit.once as { uzamaSayisi: number }).uzamaSayisi, (kayit.sonra as { uzamaSayisi: number }).uzamaSayisi]).toEqual([3, uzama])
  })
})

describe('arsa kararları ve taslak silme', () => {
  it('süresi dolan arsa belirsiz süreliye çevrilir veya sona erdirilir', async () => {
    const a = await aktif({ tasinmazId: h.arsaId, baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await belirsizSureliyeCevir(a, await surum(a), TEST_BAGLAMI, t('2026-10-15'))
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id: a } })
    expect(s.bitis).toBeNull()
    expect(await prisma.taksit.count({ where: { sozlesmeId: a, donemBaslangic: { gte: new Date('2026-10-01') } } })).toBe(25)
    const b = await aktif({ tasinmazId: h.arsaId, baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await expect(sozlesmeSonlandir(b, await surum(b), TEST_BAGLAMI, t('2026-09-01'))).rejects.toBeInstanceOf(IsKuraliHatasi)
    await sozlesmeSonlandir(b, await surum(b), TEST_BAGLAMI, t('2026-10-15'))
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: b } })).durum).toBe('SONA_ERDI')
  })

  it('arsa kararları yalnızca bitişi geçmiş arsa kirası içindir (konut/çatılı işyeri kendiliğinden uzar)', async () => {
    const isyeri = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const v = await surum(isyeri)
    await expect(belirsizSureliyeCevir(isyeri, v, TEST_BAGLAMI, t('2026-10-15'))).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'TUR' })
    await expect(sozlesmeSonlandir(isyeri, v, TEST_BAGLAMI, t('2026-10-15'))).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'TUR' })
    const arsa = await aktif({ tasinmazId: h.arsaId, baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const va = await surum(arsa)
    // Bitiş günü dahil süre dolmamıştır: karar bitişten sonraki günden itibaren verilir.
    await expect(belirsizSureliyeCevir(arsa, va, TEST_BAGLAMI, t('2026-09-30'))).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DURUM' })
    await expect(sozlesmeSonlandir(arsa, va, TEST_BAGLAMI, t('2026-09-30'))).rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DURUM' })
    expect(await surum(isyeri)).toBe(v)
    expect(await surum(arsa)).toBe(va)
    await belirsizSureliyeCevir(arsa, va, TEST_BAGLAMI, t('2026-10-01'))
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id: arsa } })).bitis).toBeNull()
  })

  it('yalnızca taslak silinir', async () => {
    const taslak = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await taslakSil(taslak, 0, TEST_BAGLAMI)
    expect(await prisma.sozlesme.count({ where: { id: taslak } })).toBe(0)
    const a = await aktif()
    await expect(taslakSil(a, await surum(a), TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('eski sürümle hiçbir yaşam döngüsü işlemi uygulanmaz (CakismaHatasi)', async () => {
    const taslak = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await expect(taslakSil(taslak, 7, TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    expect(await prisma.sozlesme.count({ where: { id: taslak } })).toBe(1)
    const a = await aktif({ tasinmazId: h.arsaId, baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    await expect(sozlesmeSonlandir(a, 7, TEST_BAGLAMI, t('2026-10-15'))).rejects.toBeInstanceOf(CakismaHatasi)
    await expect(belirsizSureliyeCevir(a, 7, TEST_BAGLAMI, t('2026-10-15'))).rejects.toBeInstanceOf(CakismaHatasi)
    await expect(sozlesmeFeshet(a, 7, { tarih: t('2026-06-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI)).rejects.toBeInstanceOf(CakismaHatasi)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id: a } })
    expect([s.durum, iso(s.bitis)]).toEqual(['AKTIF', '2026-09-30'])
  })
})

describe('denetim satırları (KVKK)', () => {
  it('serbest metin, kişi adı, kimlik ve IBAN değeri yazılmaz; ids ve değişen alan adları yazılır', async () => {
    const taslak = await sozlesmeTaslakKaydet(girdi(h, { notlar: 'Ahmet Yılmaz 0532 111 22 33 ile görüşüldü' }), TEST_BAGLAMI)
    await taslakSil(taslak, 0, TEST_BAGLAMI)
    const id = await aktif({ notlar: 'Mehmet Kaya adresi: Örnek Mah.' })
    await malikleriDegistir(id, await surum(id), {
      tarih: t('2026-07-01'),
      malikler: [
        { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
        { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null },
      ],
    }, TEST_BAGLAMI, t('2026-05-01'))
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2026-09-15'), neden: 'Ayşe Demir 0555 999 88 77 talebiyle' }, TEST_BAGLAMI, t('2026-05-01'))
    // Feshedilmiş sözleşme yenilenmez: yenileme denetim satırı başka bir sözleşmeden üretilir.
    const yeniId = await sozlesmeYenile(await aktif({ notlar: 'Zeynep Arslan 0544 000 11 22' }), TEST_BAGLAMI)

    const kayitlar = await prisma.olayGunlugu.findMany({ where: { varlik: 'sozlesme', varlikId: { in: [String(taslak), String(id), String(yeniId)] } }, orderBy: { id: 'asc' } })
    expect(kayitlar.map((k) => k.eylem)).toEqual(['OLUSTUR', 'TASLAK_SILINDI', 'OLUSTUR', 'AKTIFLESTIR', 'MALIK_DEGISTI', 'FESHET', 'YENILEME_TASLAGI'])
    const metin = JSON.stringify(kayitlar)
    const kisiler = await prisma.kisi.findMany()
    const ibanlar = await prisma.iban.findMany()
    const yasaklar = ['Ahmet', 'Yılmaz', '0532', 'Mehmet', 'Örnek Mah.', 'Ayşe', 'Demir', '0555', 'talebiyle', 'Zeynep', 'Arslan', '0544',
      ...kisiler.flatMap((k) => [k.tckn!, k.soyad!]), ...ibanlar.map((i) => i.iban)]
    for (const yasak of yasaklar) expect(metin).not.toContain(yasak)

    const silinen = kayitlar[1]!.once as { sozlesmeNo: string; tasinmazId: number; malikler: unknown[] }
    expect([silinen.tasinmazId, silinen.malikler]).toEqual([h.tasinmazId, [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null }]])
    const malik = kayitlar[4]!.sonra as { degisenAlanlar: string[]; malikler: unknown[]; plan: { eklenen: number } }
    // I1: işyeri planı her çalışmada ufka kadar uzar (2026-05-01 + 24 ay: 2028-02..2028-05).
    expect([malik.degisenAlanlar, malik.malikler, malik.plan.eklenen]).toEqual([['malikler'], [
      { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
      { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null },
    ], 4])
    const fesih = kayitlar[5]!.sonra as { degisenAlanlar: string[]; fesihTarihi: string; plan: { iptal: number } }
    // I1: Ekim–Aralık ve ufka kadar planlanan 2027-01..2028-05.
    expect([fesih.degisenAlanlar, fesih.fesihTarihi, fesih.plan.iptal]).toEqual([['durum', 'fesihTarihi', 'fesihNedeni'], '2026-09-15', 20])
  })
})

describe('eşzamanlılık (sözleşme satır kilidi ilk ifade)', () => {
  it('aynı sürümle yarışan malik değişikliği ve fesih serileşir: biri uygulanır, diğeri CakismaHatasi alır (kilitlenme yok)', async () => {
    for (let tur = 0; tur < 4; tur++) {
      const id = await aktif()
      const v = await surum(id)
      const sonuclar = await Promise.allSettled([
        malikleriDegistir(id, v, {
          tarih: t('2026-07-01'),
          malikler: [
            { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
            { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null },
          ],
        }, TEST_BAGLAMI, t('2026-05-01')),
        sozlesmeFeshet(id, v, { tarih: t('2026-09-15'), neden: 'Hizmet binası taşındı' }, TEST_BAGLAMI, t('2026-05-01')),
      ])
      expect(sonuclar.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
      const red = sonuclar.find((s): s is PromiseRejectedResult => s.status === 'rejected')
      expect(red?.reason).toBeInstanceOf(CakismaHatasi)
      expect(await surum(id)).toBe(v + 1)
    }
  })

  it('malik değişikliği kilidi alt satır eklemeden önce alır: sürümü artırıp tam kilide yükselten eşzamanlı işlem kilitlenmez', async () => {
    const id = await aktif()
    const v = await surum(id)
    let tutuyor!: () => void
    const tutuyorSoz = new Promise<void>((coz) => { tutuyor = coz })
    let birak!: () => void
    const birakSoz = new Promise<void>((coz) => { birak = coz })
    // Başka bir yaşam döngüsü işleminin "sürümü artırdı (FOR NO KEY UPDATE), plan için FOR UPDATE'e yükseltiyor" anı.
    const baska = prisma.$transaction(async (tx) => {
      await tx.sozlesme.update({ where: { id }, data: { version: { increment: 1 } } })
      tutuyor()
      await birakSoz
      await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
    })
    await tutuyorSoz
    // Kilidi ilk ifadede almayan işlem sürüm kontrolünü geçer, malik satırı ekleyip (FOR KEY SHARE) sürüm güncellemesinde bekler;
    // diğer işlemin FOR UPDATE'i onu bekleyince karşılıklı bekleme (40P01) oluşur. Doğru sıra: ilk ifade bekler, hiçbir şey tutmaz.
    const malik = malikleriDegistir(id, v, {
      tarih: t('2026-07-01'),
      malikler: [
        { kisiId: h.kisiA, pay: 1, payda: 2, ibanId: h.ibanA, vekilKisiId: null },
        { kisiId: h.kisiB, pay: 1, payda: 2, ibanId: h.ibanB, vekilKisiId: null },
      ],
    }, TEST_BAGLAMI, t('2026-05-01')).then(() => null, (e: unknown) => e)
    await kilitBekleyeniBekle()
    birak()
    await baska
    expect(await malik).toBeInstanceOf(CakismaHatasi)
    expect(await prisma.sozlesmeMalik.count({ where: { sozlesmeId: id } })).toBe(1)
  })

  it('aynı sözleşmeyi eşzamanlı yenilemeye çalışan ikinci işlem benzersizlik hatası değil yenileme iş kuralı hatası alır', async () => {
    const id = await aktif()
    const sonuclar = await Promise.allSettled([sozlesmeYenile(id, TEST_BAGLAMI), sozlesmeYenile(id, TEST_BAGLAMI)])
    expect(sonuclar.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    const red = sonuclar.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    expect(red?.reason).toMatchObject({ name: 'IsKuraliHatasi', kod: 'YENILEME' })
    expect(await prisma.sozlesme.count({ where: { oncekiSozlesmeId: id } })).toBe(1)
  })

})

describe('toplu uzama: sözleşme başına CakismaHatasi', () => {
  it('bir sözleşmenin yazıları geri alınır, toplu işlem sonrakiyle devam eder; atlanan ertesi çalışmada yine aday olur', async () => {
    const a = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const b = await aktif({ baslangic: '2025-10-01', bitis: '2026-09-30' }, t('2025-10-01'))
    const oncekiTaksit = await prisma.taksit.count({ where: { sozlesmeId: a } })
    const sayi = await prisma.$transaction((tx) => otomatikUzat(taksitEklemedeCakisma(tx, a, 3), t('2026-10-15')))
    expect(sayi).toBe(1)
    const sa = await prisma.sozlesme.findUniqueOrThrow({ where: { id: a } })
    // Sürüm artışı, durum, bitiş, eklenen ilk iki taksit ve denetim satırı geri alındı.
    expect([sa.durum, iso(sa.bitis), sa.uzamaSayisi, sa.version]).toEqual(['AKTIF', '2026-09-30', 0, 1])
    expect(await prisma.taksit.count({ where: { sozlesmeId: a } })).toBe(oncekiTaksit)
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'OTOMATIK_UZAMA', varlikId: String(a) } })).toBe(0)
    const sb = await prisma.sozlesme.findUniqueOrThrow({ where: { id: b } })
    expect([sb.durum, iso(sb.bitis), sb.uzamaSayisi]).toEqual(['UZADI', '2027-09-30', 1])
    // Geri alınan sözleşme için KRITIK uyarı yazılır (bilgi satırı yalnızca uzayan sözleşme içindir).
    const hata = await prisma.hatirlatma.findMany({ where: { kural: 'UZAMA_HATA' } })
    expect(hata.map((x) => [x.sozlesmeId, x.oncelik, x.kararGerekli, x.aciklama])).toEqual([[a, 'KRITIK', true, new CakismaHatasi().message]])
    expect((await prisma.hatirlatma.findMany({ where: { kural: 'UZAMA_BILGI' } })).map((x) => x.sozlesmeId)).toEqual([b])
    expect(await prisma.$transaction((tx) => otomatikUzat(tx, t('2026-10-15')))).toBe(1)
    expect(iso((await prisma.sozlesme.findUniqueOrThrow({ where: { id: a } })).bitis)).toBe('2027-09-30')
    expect((await prisma.hatirlatma.findMany({ where: { kural: 'UZAMA_BILGI' }, orderBy: { sozlesmeId: 'asc' } })).map((x) => x.sozlesmeId)).toEqual([a, b])
  })
})

/** Plan yazımı sırasında CakismaHatasi taklidi: verilen sözleşmenin `sira`. taksit eklemesi başarısız olur. */
function taksitEklemedeCakisma(tx: Tx, sozlesmeId: number, sira: number): Tx {
  let n = 0
  return new Proxy(tx, {
    get(hedef, ad) {
      const deger: unknown = Reflect.get(hedef, ad)
      if (ad !== 'taksit') return typeof deger === 'function' ? deger.bind(hedef) : deger
      return new Proxy(deger as Tx['taksit'], {
        get(delege, yontem) {
          const f: unknown = Reflect.get(delege, yontem)
          if (yontem !== 'create') return f
          return (arg: { data: { sozlesmeId: number } }) => {
            if (arg.data.sozlesmeId === sozlesmeId && ++n === sira) throw new CakismaHatasi()
            return Reflect.apply(f as (...a: unknown[]) => unknown, delege, [arg])
          }
        },
      })
    },
  })
}

/** Başka bir oturum satır kilidinde bekleyene kadar bekler (pg_stat_activity). */
async function kilitBekleyeniBekle(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [satir] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`
    if (satir !== undefined && satir.n > 0n) return
    await new Promise((coz) => setTimeout(coz, 50))
  }
  throw new Error('Kilit bekleyen oturum görülmedi.')
}
