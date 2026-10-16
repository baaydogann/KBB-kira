import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Server action'lar doğrudan çağrılır: oturum ve önbellek taklit edilir, veritabanı ve servisler gerçektir.
vi.mock('@/server/auth/gerekli', () => ({
  kullaniciGerekli: async () => ({ id: 1 }),
  islemBaglami: async (k: { id: number }) => ({ kullaniciId: k.id, ip: null }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { endeksElleGirAction, endeksOnaylaAction } from '@/app/(uygulama)/endeksler/actions'
import { prisma } from '@/server/db'
import { para } from '@/core/para'
import { ayEkle, ayinIlkGunu, ayKaydir, bugunIstanbul, gunEkle, tarih as t, tarihinAyi, type Tarih } from '@/core/tarih'
import { artisElleOranGir, artisOnayla, artislariHesapla, kiraBedeliDegistir } from '@/server/artis/servis'
import { endeksElleGir } from '@/server/endeks/servis'
import { hatirlatmalariUret } from '@/core/hatirlatma'
import { hatirlatmaVerisiYukle } from '@/server/hatirlatma/servis'
import { sozlesmeFeshet, sozlesmeYenile } from '@/server/sozlesme/yasam-dongusu'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { taksitPlaniniGuncelle } from '@/server/taksit/servis'
import { CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null
const BUGUN = t('2026-10-20')

beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

async function sozlesme(ek: Record<string, unknown> = {}, aktifBugun: Tarih = t('2025-11-01')) {
  const id = await sozlesmeTaslakKaydet(girdi(h, { baslangic: '2025-11-01', bitis: '2027-10-31', ...ek }), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, aktifBugun)
  return id
}
const hesapla = () => prisma.$transaction((tx) => artislariHesapla(tx, BUGUN))
const taksit = (sozlesmeId: number, ay: string) => prisma.taksit.findFirstOrThrow({ where: { sozlesmeId, donemBaslangic: new Date(`${ay}-01`), tur: { not: 'FARK' } } })
const tufe12Gir = (ay: number, deger: string) => endeksElleGir({ seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay }, deger: para(deger) }, TEST_BAGLAMI, BUGUN)

describe('Review Focus #3: endeks yayımlanmadan başlayan dönem', () => {
  it('BEKLEMEDE kalır, taksit tahmini işaretlidir; endeks + onay sonrası taksit yeni bedelle yeniden hesaplanır', async () => {
    const id = await sozlesme()
    await prisma.$transaction((tx) => artislariHesapla(tx, BUGUN))
    const a1 = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    expect([iso(a1.donemBaslangic), a1.durum, a1.referansAy]).toEqual(['2026-11-01', 'BEKLEMEDE', 10])
    const kasim = await taksit(id, '2026-11')
    expect((kasim.hesapGoruntusu as { artisBekleniyor: boolean }).artisBekleniyor).toBe(true)
    expect(kasim.tutar.toFixed(2)).toBe('10000.00')

    await tufe12Gir(10, '31.20')
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    const a2 = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a1.id } })
    expect([a2.durum, a2.uygulananOran?.toString(), a2.yeniBedel?.toFixed(2)]).toEqual(['HESAPLANDI', '31.2', '13120.00'])

    await artisOnayla(a2.id, a2.version, TEST_BAGLAMI, BUGUN)
    const kd = await prisma.kiraDonemi.findMany({ where: { sozlesmeId: id }, orderBy: { baslangic: 'asc' } })
    expect(kd.map((k) => [k.kaynak, iso(k.baslangic), iso(k.bitis), k.bedelTutari.toFixed(2)])).toEqual([
      ['ILK', '2025-11-01', '2026-10-31', '10000.00'],
      ['ARTIS', '2026-11-01', null, '13120.00'],
    ])
    const kasimSonra = await taksit(id, '2026-11')
    expect(kasimSonra.tutar.toFixed(2)).toBe('13120.00')
    expect((kasimSonra.hesapGoruntusu as { artisBekleniyor: boolean }).artisBekleniyor).toBe(false)
    expect((await taksit(id, '2026-10')).tutar.toFixed(2)).toBe('10000.00')
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a1.id } })).durum).toBe('ONAYLANDI')
  })
})

describe('fark taksiti ve fazla ödeme', () => {
  it('eski bedelle ödenmiş taksit için FARK taksiti oluşur', async () => {
    const id = await sozlesme()
    await prisma.taksit.update({ where: { id: (await taksit(id, '2026-11')).id }, data: { durum: 'ODENDI' } })
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    const fark = await prisma.taksit.findFirstOrThrow({ where: { sozlesmeId: id, tur: 'FARK' } })
    expect([fark.tutar.toFixed(2), iso(fark.vadeTarihi), fark.artisHesabiId, fark.durum]).toEqual(['3120.00', '2026-10-30', a.id, 'PLANLANDI'])
  })

  it('bedel düşerse fark taksiti yerine kalıcı fazla ödeme hatırlatması açılır', async () => {
    const id = await sozlesme()
    await prisma.taksit.update({ where: { id: (await taksit(id, '2026-11')).id }, data: { durum: 'ODENDI' } })
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await kiraBedeliDegistir(id, s.version, { baslangic: t('2026-11-01'), bedel: para('9000'), kaynak: 'TESPIT', aciklama: 'Kira tespit davası kararı' }, TEST_BAGLAMI, BUGUN)
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(0)
    const h5 = await prisma.hatirlatma.findFirstOrThrow({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id } })
    expect([h5.oncelik, h5.kararGerekli]).toEqual(['KRITIK', true])
    expect((await taksit(id, '2026-12')).tutar.toFixed(2)).toBe('9000.00')
  })
})

describe('C1: vadesi geçmiş PLANLANDI taksit tahakkuk etmiş sayılır', () => {
  const tespit = (id: number, v: number, baslangic: string, bedel: string) =>
    kiraBedeliDegistir(id, v, { baslangic: t(baslangic), bedel: para(bedel), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN)
  const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version

  it('aylık peşin vadeden sonra onaylanan artış: geçmiş Ocak taksiti eski tutarında kalır, fark FARK taksiti olur; gelecek taksit yeniden fiyatlanır', async () => {
    const id = await sozlesme({ baslangic: '2025-01-01', bitis: '2026-12-31' }, t('2025-01-01'))
    const bugun = t('2026-01-10')
    await prisma.$transaction((tx) => artislariHesapla(tx, bugun))
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    expect([iso(a.donemBaslangic), a.durum, a.yeniBedel?.toFixed(2)]).toEqual(['2026-01-01', 'HESAPLANDI', '13488.00'])
    const ocakOnce = await taksit(id, '2026-01')
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, bugun)
    const ocak = await taksit(id, '2026-01')
    expect([ocak.durum, ocak.tutar.toFixed(2), ocak.version]).toEqual(['PLANLANDI', '10000.00', ocakOnce.version])
    const kd = await prisma.kiraDonemi.findFirstOrThrow({ where: { artisHesabiId: a.id } })
    const farklar = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' } })
    expect(farklar.map((f) => [f.anaTaksitId, f.tutar.toFixed(2), iso(f.vadeTarihi), f.kiraDonemiId, f.artisHesabiId, f.durum]))
      .toEqual([[ocak.id, '3488.00', '2026-01-20', kd.id, a.id, 'PLANLANDI']])
    expect((await taksit(id, '2026-02')).tutar.toFixed(2)).toBe('13488.00')
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'ARTIS_ONAY', varlikId: String(id) } })
    expect(kayit.sonra).toMatchObject({ plan: { gecmisDokunulmadi: 1 }, farkTaksiti: 1 })
    // Yeniden çalışan plan geçmiş satıra yine dokunmaz; FARK çoğalmaz.
    await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, bugun))
    expect((await taksit(id, '2026-01')).tutar.toFixed(2)).toBe('10000.00')
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(1)
  })

  it('geriye işleyen yüksek tespit: vadesi geçmiş taksitler değişmez, her biri için FARK açılır', async () => {
    const id = await sozlesme()
    const [eylul, ekim] = [await taksit(id, '2026-09'), await taksit(id, '2026-10')]
    await tespit(id, await surum(id), '2026-09-01', '12000')
    for (const x of [eylul, ekim]) expect((await taksit(id, iso(x.donemBaslangic)!.slice(0, 7))).tutar.toFixed(2)).toBe('10000.00')
    const farklar = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' }, orderBy: { anaTaksitId: 'asc' } })
    expect(farklar.map((f) => [f.anaTaksitId, f.tutar.toFixed(2), f.durum])).toEqual([[eylul.id, '2000.00', 'PLANLANDI'], [ekim.id, '2000.00', 'PLANLANDI']])
    expect((await taksit(id, '2026-11')).tutar.toFixed(2)).toBe('12000.00')
  })

  it('geriye işleyen düşük tespit: vadesi geçmiş taksitler değişmez, her biri için tek fazla ödeme hatırlatması açılır (plan yeniden çalışsa da çoğalmaz)', async () => {
    const id = await sozlesme()
    const [eylul, ekim] = [await taksit(id, '2026-09'), await taksit(id, '2026-10')]
    await tespit(id, await surum(id), '2026-09-01', '9000')
    expect((await taksit(id, '2026-09')).tutar.toFixed(2)).toBe('10000.00')
    expect((await taksit(id, '2026-10')).tutar.toFixed(2)).toBe('10000.00')
    expect((await taksit(id, '2026-11')).tutar.toFixed(2)).toBe('9000.00')
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(0)
    await prisma.$transaction((tx) => taksitPlaniniGuncelle(tx, id, BUGUN))
    const h = await prisma.hatirlatma.findMany({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id }, orderBy: { iliskiliId: 'asc' } })
    expect(h.map((x) => [x.iliskiliId, x.oncelik, x.kararGerekli])).toEqual([[String(eylul.id), 'KRITIK', true], [String(ekim.id), 'KRITIK', true]])
    expect(h.every((x) => x.aciklama.includes('1.000,00'))).toBe(true)
  })

  it('vadesi geçmiş PLANLANDI FARK tahakkuk etmiş sayılır: iptal edilmez, yeni fark yalnızca kalan için açılır', async () => {
    const id = await sozlesme()
    const ekim = await taksit(id, '2026-10')
    // İlk tespit 2026-10-05'te girilir: Eylül ve Ekim vadesi geçmiştir, FARK'ları (vade 2026-10-15) ikinci tespitte de vadesi geçmiş olur.
    await kiraBedeliDegistir(id, await surum(id), { baslangic: t('2026-09-01'), bedel: para('12000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, t('2026-10-05'))
    const [ilk] = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK', anaTaksitId: ekim.id } })
    expect([ilk?.tutar.toFixed(2), iso(ilk!.vadeTarihi)]).toEqual(['2000.00', '2026-10-15'])
    await tespit(id, await surum(id), '2026-10-01', '13000')
    const ekimFarklari = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK', anaTaksitId: ekim.id }, orderBy: { id: 'asc' } })
    // Ekim'in ilk FARK'ı (2.000) vadesi geçtiği için tahakkuk etmiş sayılır: iptal edilmez, kalan 1.000 yeni FARK olur (3.000 değil).
    expect(ekimFarklari.map((f) => [f.id === ilk!.id, f.tutar.toFixed(2), f.durum])).toEqual([[true, '2000.00', 'PLANLANDI'], [false, '1000.00', 'PLANLANDI']])
    expect((await taksit(id, '2026-10')).tutar.toFixed(2)).toBe('10000.00')
  })
})

describe('I2: ileri tarihli fesih ve sona erme bitişe kadar yürürlüktedir', () => {
  const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version
  const h5 = async (id: number, bugun: Tarih) =>
    hatirlatmalariUret(await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, bugun))).filter((x) => x.kural === 'H5' && x.sozlesmeId === String(id))

  it('ileri tarihli fesihten önceki artış hesaplanır, hatırlatılır ve onaylanır', async () => {
    const id = await sozlesme()
    await sozlesmeFeshet(id, await surum(id), { tarih: t('2027-03-31'), neden: 'Hizmet binası taşınacak' }, TEST_BAGLAMI, BUGUN)
    expect((await h5(id, BUGUN)).map((x) => [x.anahtar, x.baslik])).toEqual([[`H5:sozlesme:${id}:2026-11-01`, expect.stringContaining('yaklaşıyor')]])
    await tufe12Gir(10, '31.20')
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    expect((await h5(id, BUGUN)).map((x) => x.kararGerekli)).toEqual([true])
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).durum).toBe('ONAYLANDI')
    expect((await taksit(id, '2026-11')).tutar.toFixed(2)).toBe('13120.00')
    expect(await h5(id, BUGUN)).toEqual([])
  })

  it('fesih tarihinden sonra başlayan artış hesaplanmaz; fesih tarihi geçince sözleşme hesaptan, onaydan ve hatırlatmadan düşer', async () => {
    const sonra = await sozlesme()
    await sozlesmeFeshet(sonra, await surum(sonra), { tarih: t('2026-10-31'), neden: 'Hizmet binası taşınacak' }, TEST_BAGLAMI, BUGUN)
    expect(await h5(sonra, BUGUN)).toEqual([])
    const once = await sozlesme()
    await sozlesmeFeshet(once, await surum(once), { tarih: t('2026-11-15'), neden: 'Hizmet binası taşınacak' }, TEST_BAGLAMI, BUGUN)
    await tufe12Gir(10, '31.20')
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: sonra } })).toBe(0)
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: once } })
    const ertesi = t('2026-11-16')
    await expect(artisOnayla(a.id, a.version, TEST_BAGLAMI, ertesi)).rejects.toMatchObject({ kod: 'DURUM' })
    expect(await prisma.$transaction((tx) => artislariHesapla(tx, ertesi))).toEqual({ hesaplanan: 0, bekleyen: 0 })
    expect((await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, ertesi))).sozlesmeler.map((x) => x.id)).not.toContain(String(once))
    // Fesih günü dahil yürürlüktedir.
    expect((await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, t('2026-11-15')))).sozlesmeler.find((x) => x.id === String(once)))
      .toMatchObject({ sonaErmekte: true, bitisEtkin: '2026-11-15' })
  })

  it('bitişi gelmemiş SONA_ERDI sözleşmenin bitişe kadarki artışı hesaplanır ve onaylanır; ELLE oran girilebilir', async () => {
    const id = await sozlesme({ artisKurali: 'ELLE', baslangic: '2025-10-01', bitis: '2027-09-30' })
    await prisma.sozlesme.update({ where: { id }, data: { durum: 'SONA_ERDI', bitis: new Date('2026-12-31'), version: { increment: 1 } } })
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisElleOranGir(a.id, a.version, { oran: para('20'), gerekce: 'Malikle yazılı anlaşma' }, TEST_BAGLAMI, BUGUN)
    const b = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })
    expect([b.durum, b.yeniBedel?.toFixed(2)]).toEqual(['HESAPLANDI', '12000.00'])
    await artisOnayla(b.id, b.version, TEST_BAGLAMI, BUGUN)
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(2)
  })
})

describe('I3 + I8: var olan kira döneminin bedeli değişir', () => {
  const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version
  const donemler = (id: number) => prisma.kiraDonemi.findMany({ where: { sozlesmeId: id }, orderBy: { baslangic: 'asc' } })
  const h5 = async (id: number, bugun: Tarih) =>
    hatirlatmalariUret(await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, bugun))).filter((x) => x.kural === 'H5' && x.sozlesmeId === String(id))
  const tespitTekrar = async (id: number) =>
    kiraBedeliDegistir(id, await surum(id), { baslangic: t('2026-11-01'), bedel: para('15000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN)

  it('I3: kira yılı sınırında başlayan yenilemenin ilk günündeki artış hesaplanır, hatırlatılır, onaylanınca ILK dönemin bedeli değişir', async () => {
    const eski = await sozlesme({ baslangic: '2025-11-01', bitis: '2026-10-31' })
    const yeni = await sozlesmeYenile(eski, TEST_BAGLAMI)
    await sozlesmeAktiflestir(yeni, 0, TEST_BAGLAMI, BUGUN)
    expect((await donemler(yeni)).map((k) => [k.kaynak, iso(k.baslangic), k.bedelTutari.toFixed(2)])).toEqual([['ILK', '2026-11-01', '10000.00']])
    expect((await h5(yeni, BUGUN)).map((x) => x.anahtar)).toEqual([`H5:sozlesme:${yeni}:2026-11-01`])
    await tufe12Gir(10, '31.20')
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    // Önceki sözleşme (bitişi 2026-10-31) bu artışı hesaplamaz; yenileme hesaplar ve önceki bedel öncekinin son bedelidir.
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: eski } })).toBe(0)
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: yeni } })
    expect([iso(a.donemBaslangic), a.durum, a.eskiBedel.toFixed(2), a.yeniBedel?.toFixed(2)]).toEqual(['2026-11-01', 'HESAPLANDI', '10000.00', '13120.00'])
    expect((await h5(yeni, BUGUN)).map((x) => x.kararGerekli)).toEqual([true])

    // Kasım vadesi geçtikten sonra onay: Kasım taksiti FARK alır, Aralık yeniden fiyatlanır; yeni dönem açılmaz.
    const onayGunu = t('2026-11-10')
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, onayGunu)
    expect((await donemler(yeni)).map((k) => [k.kaynak, iso(k.baslangic), iso(k.bitis), k.bedelTutari.toFixed(2), k.artisHesabiId])).toEqual([
      ['ARTIS', '2026-11-01', null, '13120.00', a.id],
    ])
    const kasim = await taksit(yeni, '2026-11')
    expect(kasim.tutar.toFixed(2)).toBe('10000.00')
    const [fark] = await prisma.taksit.findMany({ where: { sozlesmeId: yeni, tur: 'FARK' } })
    expect([fark?.anaTaksitId, fark?.tutar.toFixed(2), fark?.artisHesabiId]).toEqual([kasim.id, '3120.00', a.id])
    expect((await taksit(yeni, '2026-12')).tutar.toFixed(2)).toBe('13120.00')
    expect(await h5(yeni, onayGunu)).toEqual([])
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'ARTIS_ONAY', varlikId: String(yeni) } })
    expect(kayit.sonra).toMatchObject({ degistirilenDonem: { oncekiBedel: '10000.00', oncekiKaynak: 'ILK' }, farkTaksiti: 1 })
    // Sıradaki artış ILK dönemden değil, yeni bedelden hesaplanır (bitiş sonrası artış hesaplanmadığından süre uzatılır).
    await prisma.sozlesme.update({ where: { id: yeni }, data: { bitis: new Date('2028-10-31') } })
    expect(await prisma.$transaction((tx) => artislariHesapla(tx, t('2027-10-01')))).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const sonraki = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: yeni, durum: 'BEKLEMEDE' } })
    expect([iso(sonraki.donemBaslangic), sonraki.eskiBedel.toFixed(2)]).toEqual(['2027-11-01', '13120.00'])
  })

  it('I8: onaylı artışın başlangıcından işleyen tespit o dönemin bedelini değiştirir; tahakkuk etmiş taksitler FARK alır', async () => {
    const id = await sozlesme()
    const kasim = await taksit(id, '2026-11')
    await prisma.taksit.update({ where: { id: kasim.id }, data: { durum: 'ODENDI' } })
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    // Artış FARK'ı ödendi: tahakkuk etmiştir.
    const [artisFarki] = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' } })
    await prisma.taksit.update({ where: { id: artisFarki!.id }, data: { durum: 'ODENDI' } })

    await kiraBedeliDegistir(id, await surum(id), { baslangic: t('2026-11-01'), bedel: para('14000'), kaynak: 'TESPIT', aciklama: 'Tespit kararı 2026/9' }, TEST_BAGLAMI, BUGUN)
    const kd = await donemler(id)
    expect(kd.map((k) => [k.kaynak, iso(k.baslangic), iso(k.bitis), k.bedelTutari.toFixed(2), k.artisHesabiId, k.aciklama])).toEqual([
      ['ILK', '2025-11-01', '2026-10-31', '10000.00', null, null],
      ['TESPIT', '2026-11-01', null, '14000.00', null, 'Tespit kararı 2026/9'],
    ])
    const farklar = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' }, orderBy: { id: 'asc' } })
    // 14.000 − (10.000 + ödenmiş 3.120) = 880; aynı kira dönemine bağlı, artış hesabı boş.
    expect(farklar.map((f) => [f.anaTaksitId, f.tutar.toFixed(2), f.durum, f.kiraDonemiId, f.artisHesabiId])).toEqual([
      [kasim.id, '3120.00', 'ODENDI', kd[1]!.id, a.id], [kasim.id, '880.00', 'PLANLANDI', kd[1]!.id, null],
    ])
    expect((await taksit(id, '2026-12')).tutar.toFixed(2)).toBe('14000.00')
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).durum).toBe('ONAYLANDI')
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { eylem: 'KIRA_BEDELI_DEGISTI', varlikId: String(id) } })
    expect(kayit.sonra).toMatchObject({
      baslangic: '2026-11-01', bedel: '14000.00', kaynak: 'TESPIT', farkTaksiti: 1,
      degistirilenDonem: { kiraDonemiId: kd[1]!.id, oncekiBedel: '13120.00', oncekiKaynak: 'ARTIS', oncekiArtisHesabiId: a.id },
    })
    // Dönem artık tespit dönemidir: aynı tarihe ikinci değişiklik yeni dönem gibi reddedilir.
    await expect(tespitTekrar(id)).rejects.toMatchObject({ kod: 'SIRA' })
  })

  it('I8: aynı tarihe tespit dışı (anlaşma, düzeltme) değişiklik ve son dönem artış dönemi değilse tespit yine SIRA ile reddedilir', async () => {
    const id = await sozlesme()
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    for (const kaynak of ['ANLASMA', 'ELLE'] as const) {
      await expect(kiraBedeliDegistir(id, await surum(id), { baslangic: t('2026-11-01'), bedel: para('14000'), kaynak, aciklama: 'Protokol' }, TEST_BAGLAMI, BUGUN))
        .rejects.toMatchObject({ kod: 'SIRA' })
    }
    // İlk dönemin başlangıcına tespit (ILK dönem son dönem ve artış dönemi değil) reddedilir.
    await expect(kiraBedeliDegistir(id, await surum(id), { baslangic: t('2025-11-01'), bedel: para('14000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN))
      .rejects.toMatchObject({ kod: 'SIRA' })
    expect((await donemler(id)).map((k) => [k.kaynak, k.bedelTutari.toFixed(2)])).toEqual([['ILK', '10000.00'], ['ARTIS', '13120.00']])
  })
})

describe('sıra ve elle oran', () => {
  it('son kira döneminden önceki bir tarihe bedel değişikliği reddedilir', async () => {
    const id = await sozlesme()
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await expect(kiraBedeliDegistir(id, s.version, { baslangic: t('2025-11-01'), bedel: para('1'), kaynak: 'ELLE', aciklama: 'deneme' }, TEST_BAGLAMI, BUGUN))
      .rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('ELLE kuralında oran girilene kadar bekler; girilen oran tavana tabidir', async () => {
    const id = await sozlesme({ artisKurali: 'ELLE', baslangic: '2025-10-01', bitis: '2027-09-30' })
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    expect([iso(a.donemBaslangic), a.durum]).toEqual(['2026-10-01', 'BEKLEMEDE'])
    await artisElleOranGir(a.id, a.version, { oran: para('40'), gerekce: 'Malikle yazılı anlaşma' }, TEST_BAGLAMI, BUGUN)
    const b = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })
    expect([b.durum, b.uygulananOran?.toString(), b.yeniBedel?.toFixed(2)]).toEqual(['HESAPLANDI', '31.49', '13149.00'])
  })
})

describe('spec §8: endeks onayı bekleyen artışı hesaplatır', () => {
  const BOS = { hata: null, alanHatalari: {}, tamam: false }
  const form = (alanlar: Record<string, string>) => {
    const f = new FormData()
    for (const [ad, deger] of Object.entries(alanlar)) f.set(ad, deger)
    return f
  }

  /**
   * Action'lar gerçek saati kullanır; bu yüzden tarihler gerçek bugüne göre kurulur: bir sonraki ayın 1'i artış tarihidir (45 gün ufkunun içinde),
   * referans ay bu aydır. Tohum TÜFE12 verisi 2026-09'da biter; çalıştırma tarihi 2026-10 veya sonrasıdır.
   */
  async function bekleyenArtisli() {
    await prisma.kullanici.create({ data: { id: 1, kullaniciAdi: 'test', adSoyad: 'Test', sifreHash: 'x' } })
    const bugun = bugunIstanbul()
    const referans = tarihinAyi(bugun)
    const artisTarihi = ayinIlkGunu(ayKaydir(referans, 1))
    const baslangic = ayEkle(artisTarihi, -12)
    const id = await sozlesme({ baslangic, bitis: gunEkle(ayEkle(artisTarihi, 12), -1) }, baslangic)
    expect(await prisma.$transaction((tx) => artislariHesapla(tx, bugun))).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    expect([iso(a.donemBaslangic), a.durum]).toEqual([artisTarihi, 'BEKLEMEDE'])
    return { id, referans, artisId: a.id }
  }

  it('eksik TÜFE12 ayı onaylanınca BEKLEMEDE artış HESAPLANDI olur (onay action)', async () => {
    const { id, referans, artisId } = await bekleyenArtisli()
    const e = await prisma.endeksDegeri.create({
      data: { seri: 'TUFE_12AY_ORT', yil: referans.yil, ay: referans.ay, deger: '31.2000', evdsDegeri: '31.2000', kaynak: 'EVDS', onayDurumu: 'BEKLIYOR' },
    })
    const r = await endeksOnaylaAction(BOS, form({ id: String(e.id), gorulenDeger: '31.2' }))
    expect(r).toMatchObject({ tamam: true, hata: null, mesaj: 'Endeks onaylandı.' })
    expect(r.uyari).toBeUndefined()
    const a = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: artisId } })
    expect([a.durum, a.uygulananOran?.toString(), a.yeniBedel?.toFixed(2)]).toEqual(['HESAPLANDI', '31.2', '13120.00'])
    // İlk satır önkoşulu kuran sistem çalıştırması (bağlamsız), ikincisi onay veren kullanıcının tetiklediği hesap.
    const g = await prisma.olayGunlugu.findMany({ where: { varlik: 'sozlesme', varlikId: String(id), eylem: 'ARTIS_HESAPLA' }, orderBy: { id: 'asc' } })
    expect(g.map((x) => x.kullaniciId)).toEqual([null, 1])
  })

  it('elle girilen onaylı değer de aynı hesabı tetikler', async () => {
    const { referans, artisId } = await bekleyenArtisli()
    const ay = `${referans.yil}-${String(referans.ay).padStart(2, '0')}`
    const r = await endeksElleGirAction(BOS, form({ seri: 'TUFE_12AY_ORT', ay, deger: '31,20' }))
    expect(r).toMatchObject({ tamam: true, hata: null })
    expect(r.uyari).toBeUndefined()
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: artisId } })).durum).toBe('HESAPLANDI')
  })

  it('artış hesabı başarısız olursa onay geri alınmaz; kullanıcıya uyarı verilir', async () => {
    const { referans, artisId } = await bekleyenArtisli()
    await prisma.parametre.deleteMany({ where: { anahtar: 'ARTIS_HESAP_UFUK_GUN' } })
    const e = await prisma.endeksDegeri.create({
      data: { seri: 'TUFE_12AY_ORT', yil: referans.yil, ay: referans.ay, deger: '31.2000', evdsDegeri: '31.2000', kaynak: 'EVDS', onayDurumu: 'BEKLIYOR' },
    })
    const r = await endeksOnaylaAction(BOS, form({ id: String(e.id), gorulenDeger: '31.2' }))
    expect(r).toMatchObject({ tamam: true, hata: null, mesaj: 'Endeks onaylandı.' })
    expect(r.uyari).toContain('ARTIS_HESAP_UFUK_GUN')
    expect((await prisma.endeksDegeri.findUniqueOrThrow({ where: { id: e.id } })).onayDurumu).toBe('ONAYLANDI')
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: artisId } })).durum).toBe('BEKLEMEDE')
  })
})

describe('onay kuralları', () => {
  async function hesaplanmis() {
    const id = await sozlesme()
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    return { id, a }
  }

  it('eski sürümle onay çakışma verir; ikinci onay durum hatası verir; hiçbir şey yazılmaz', async () => {
    const { id, a } = await hesaplanmis()
    await expect(artisOnayla(a.id, a.version + 1, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    await expect(artisOnayla(a.id, a.version + 1, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'DURUM' })
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(2)
  })

  it('yürürlükte olmayan sözleşmenin artışı onaylanmaz', async () => {
    const { id, a } = await hesaplanmis()
    await prisma.sozlesme.update({ where: { id }, data: { durum: 'FESHEDILDI', version: { increment: 1 } } })
    await expect(artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'DURUM' })
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).durum).toBe('HESAPLANDI')
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
  })

  it('olmayan artış hesabı bulunamadı hatası verir', async () => {
    await expect(artisOnayla(999_999, 0, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ name: 'BulunamadiHatasi' })
  })

  it('denetim satırı artış bilgisini taşır, serbest metin içermez', async () => {
    const id = await sozlesme({ artisKurali: 'ELLE', baslangic: '2025-10-01', bitis: '2027-09-30' })
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisElleOranGir(a.id, a.version, { oran: para('20'), gerekce: 'Ahmet Yılmaz ile telefonda görüşüldü' }, TEST_BAGLAMI, BUGUN)
    const b = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })
    expect(b.elleOranGerekcesi).toBe('Ahmet Yılmaz ile telefonda görüşüldü')
    await artisOnayla(b.id, b.version, TEST_BAGLAMI, BUGUN)
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await kiraBedeliDegistir(id, s.version, { baslangic: t('2026-12-01'), bedel: para('15000'), kaynak: 'TESPIT', aciklama: 'Ayşe Demir adına karar no 2026/55' }, TEST_BAGLAMI, BUGUN)
    const kayitlar = await prisma.olayGunlugu.findMany({ where: { varlik: 'sozlesme', varlikId: String(id) }, orderBy: { id: 'asc' } })
    const eylemler = kayitlar.map((k) => k.eylem).filter((e) => e.startsWith('ARTIS') || e.startsWith('KIRA'))
    expect(eylemler).toEqual(['ARTIS_HESAPLA', 'ARTIS_ELLE_ORAN', 'ARTIS_HESAPLA', 'ARTIS_ONAY', 'KIRA_BEDELI_DEGISTI'])
    expect(JSON.stringify(kayitlar.map((k) => k.sonra))).not.toMatch(/Ahmet|Ayşe|Yılmaz|Demir|telefon/)
    const elle = kayitlar.find((k) => k.eylem === 'ARTIS_ELLE_ORAN')!.sonra as { oran: string; gerekceYazildi: boolean }
    expect([elle.oran, elle.gerekceYazildi]).toEqual(['20', true])
  })

  it('elle oran: gerekçe, aralık ve ondalık denetlenir; yalnızca bekleyen ELLE artışa girilir', async () => {
    const id = await sozlesme({ artisKurali: 'ELLE', baslangic: '2025-10-01', bitis: '2027-09-30' })
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const dene = (oran: string, gerekce = 'Protokol') => artisElleOranGir(a.id, a.version, { oran: para(oran), gerekce }, TEST_BAGLAMI, BUGUN)
    await expect(dene('20', ' a ')).rejects.toMatchObject({ kod: 'GEREKCE' })
    await expect(dene('-1')).rejects.toMatchObject({ kod: 'ORAN' })
    await expect(dene('1000.01')).rejects.toMatchObject({ kod: 'ORAN' })
    await expect(dene('20.12345')).rejects.toMatchObject({ kod: 'ORAN' })
    await expect(dene('20', 'x'.repeat(501))).rejects.toMatchObject({ kod: 'GEREKCE' })
    await expect(artisElleOranGir(a.id, a.version + 1, { oran: para('20'), gerekce: 'Protokol' }, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).elleOran).toBeNull()

    const tufe = await sozlesme({ baslangic: '2025-11-01', bitis: '2027-10-31' })
    await hesapla()
    const b = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: tufe } })
    await expect(artisElleOranGir(b.id, b.version, { oran: para('20'), gerekce: 'Protokol' }, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'DURUM' })
  })
})

describe('toplu hesap: sözleşme başına yalıtım ve sessiz yeniden çalışma', () => {
  it('kira dönemi tutarsız bir sözleşme toplu işi durdurmaz; tek sözleşme çağrısında hata yükselir', async () => {
    const bozuk = await sozlesme({ sozlesmeNo: 'BOZUK-1' })
    const saglam = await sozlesme({ sozlesmeNo: 'SAGLAM-1' })
    await tufe12Gir(10, '31.20')
    // Son kira döneminin bitişi geçmişte kalırsa artış tarihinden önceki gün hiçbir dönemde bulunmaz.
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: bozuk }, data: { bitis: new Date('2026-06-30') } })

    const sonuc = await prisma.$transaction((tx) => artislariHesapla(tx, BUGUN))
    expect(sonuc.hesaplanan).toBe(1)
    expect(sonuc.hatalar).toHaveLength(1)
    expect(sonuc.hatalar?.[0]).toContain('BOZUK-1')
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: bozuk } })).toBe(0)
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: saglam } })).durum).toBe('HESAPLANDI')

    await expect(prisma.$transaction((tx) => artislariHesapla(tx, BUGUN, bozuk))).rejects.toMatchObject({ kod: 'DONEM' })

    // İş kuralı hatası kalıcı, karar gerektiren KRITIK hatırlatma olarak görünür; sağlam sözleşmeler için satır açılmaz.
    const h = await prisma.hatirlatma.findMany({ where: { kural: 'ARTIS_HESAP_HATA' } })
    expect(h).toHaveLength(1)
    expect([h[0]?.anahtar, h[0]?.iliskiliTur, h[0]?.iliskiliId, h[0]?.sozlesmeId, h[0]?.baslik, h[0]?.oncelik, h[0]?.kararGerekli, h[0]?.durum]).toEqual([
      `ARTIS_HESAP_HATA:sozlesme:${bozuk}:2026-11-01`, 'sozlesme', String(bozuk), bozuk, 'Kira artışı hesaplanamadı — BOZUK-1', 'KRITIK', true, 'ACIK',
    ])
    expect(h[0]?.aciklama).toBe(sonuc.hatalar?.[0])
  })

  it('tek sözleşme çağrısı da iş kuralı hatasında ARTIS_HESAP_HATA yazar ve hatayı yükseltir; işlem içinde yakalanırsa hatırlatma kalıcı olur', async () => {
    const bozuk = await sozlesme({ sozlesmeNo: 'BOZUK-3' })
    await tufe12Gir(10, '31.20')
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: bozuk }, data: { bitis: new Date('2026-06-30') } })

    // Çağıran yakalamazsa işlem geri alınır: yarım yazı ve hatırlatma kalmaz (kullanıcı eylemleri iletiyi gösterir).
    await expect(prisma.$transaction((tx) => artislariHesapla(tx, BUGUN, bozuk))).rejects.toMatchObject({ kod: 'DONEM' })
    expect(await prisma.hatirlatma.count({ where: { kural: 'ARTIS_HESAP_HATA' } })).toBe(0)

    // Gece işi hatayı işlem içinde yakalar: savepoint yarım yazıyı geri almıştır, hatırlatma işlemle birlikte kalıcı olur.
    const yakalanan = await prisma.$transaction(async (tx) => {
      try {
        await artislariHesapla(tx, BUGUN, bozuk)
        return null
      } catch (e) {
        return e
      }
    })
    expect(yakalanan).toMatchObject({ name: 'IsKuraliHatasi', kod: 'DONEM' })
    const h = await prisma.hatirlatma.findMany({ where: { kural: 'ARTIS_HESAP_HATA' } })
    expect(h.map((x) => [x.anahtar, x.sozlesmeId, x.oncelik, x.kararGerekli])).toEqual([[`ARTIS_HESAP_HATA:sozlesme:${bozuk}:2026-11-01`, bozuk, 'KRITIK', true]])
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: bozuk } })).toBe(0)
  })

  it('hata hatırlatması yeniden çalışmada tekrarlanmaz; yalnızca iletisi güncellenir (kapatılmış kayıt açılmaz)', async () => {
    const bozuk = await sozlesme({ sozlesmeNo: 'BOZUK-2' })
    await prisma.kiraDonemi.updateMany({ where: { sozlesmeId: bozuk }, data: { bitis: new Date('2026-06-30') } })
    await hesapla()
    const [ilk] = await prisma.hatirlatma.findMany({ where: { kural: 'ARTIS_HESAP_HATA' } })
    await prisma.hatirlatma.update({ where: { id: ilk!.id }, data: { durum: 'TAMAMLANDI', aciklama: 'eski ileti' } })
    await hesapla()
    const hepsi = await prisma.hatirlatma.findMany({ where: { kural: 'ARTIS_HESAP_HATA' } })
    expect(hepsi.map((x) => [x.id, x.durum, x.aciklama?.startsWith('BOZUK-2')])).toEqual([[ilk!.id, 'TAMAMLANDI', true]])
  })

  it('sıralı artış: her çalışmada yalnız sıradaki artış hesaplanır; sonraki, öncekinin onaylı bedeline dayanır', async () => {
    // 2023-11-01 başlangıçlı sözleşmede 2024-11-01, 2025-11-01 ve 2026-11-01 artış tarihleri ufuk (BUGUN + 45 gün) içindedir.
    const id = await sozlesme({ baslangic: '2023-11-01', bitis: '2027-10-31' }, t('2023-11-01'))
    const artislar = () => prisma.artisHesabi.findMany({ where: { sozlesmeId: id }, orderBy: { donemBaslangic: 'asc' } })

    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    const [d1] = await artislar()
    expect([iso(d1!.donemBaslangic), d1!.durum, d1!.eskiBedel.toFixed(2), d1!.yeniBedel?.toFixed(2)]).toEqual(['2024-11-01', 'HESAPLANDI', '10000.00', '16202.00'])
    expect(await artislar()).toHaveLength(1)

    // d1 onay beklerken sonraki çalışma d2'yi hesaplamaz.
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 0 })
    expect(await artislar()).toHaveLength(1)

    await artisOnayla(d1!.id, d1!.version, TEST_BAGLAMI, BUGUN)
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    const [, d2] = await artislar()
    expect([iso(d2!.donemBaslangic), d2!.durum, d2!.eskiBedel.toFixed(2), d2!.yeniBedel?.toFixed(2)]).toEqual(['2025-11-01', 'HESAPLANDI', '16202.00', '22221.04'])
    expect(await artislar()).toHaveLength(2)

    // d2 onaylanınca sıra 2026-11-01'e gelir; referans ay (2026-10) için onaylı endeks yok.
    await artisOnayla(d2!.id, d2!.version, TEST_BAGLAMI, BUGUN)
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const [, , d3] = await artislar()
    expect([iso(d3!.donemBaslangic), d3!.durum, d3!.eskiBedel.toFixed(2)]).toEqual(['2026-11-01', 'BEKLEMEDE', '22221.04'])
  })

  it('değişmeyen BEKLEMEDE kaydı yeniden çalışmada sürüm artırmaz, denetim satırı yazmaz', async () => {
    const id = await sozlesme()
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const once = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const denetimOnce = await prisma.olayGunlugu.count({ where: { eylem: 'ARTIS_HESAPLA' } })
    expect(denetimOnce).toBe(1)
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 1 })
    const sonra = await prisma.artisHesabi.findUniqueOrThrow({ where: { id: once.id } })
    expect(sonra.version).toBe(once.version)
    expect(await prisma.olayGunlugu.count({ where: { eylem: 'ARTIS_HESAPLA' } })).toBe(1)
    // Endeks gelince aynı kayıt güncellenir (yeni satır açılmaz), sürüm artar.
    await tufe12Gir(10, '31.20')
    expect(await hesapla()).toEqual({ hesaplanan: 1, bekleyen: 0 })
    expect(await prisma.artisHesabi.count({ where: { sozlesmeId: id } })).toBe(1)
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: once.id } })).version).toBe(once.version + 1)
  })

  it('yürürlükte olmayan ve artışsız sözleşmeler hesaplanmaz', async () => {
    const feshedilen = await sozlesme({ sozlesmeNo: 'FESIH-1' })
    await prisma.sozlesme.update({ where: { id: feshedilen }, data: { durum: 'FESHEDILDI', version: { increment: 1 } } })
    await sozlesme({ sozlesmeNo: 'YOK-1', artisKurali: 'YOK' })
    expect(await hesapla()).toEqual({ hesaplanan: 0, bekleyen: 0 })
    expect(await prisma.artisHesabi.count()).toBe(0)
  })
})

describe('fark taksitleri: ayrıntılar', () => {
  it('ödeme sürecindeki (PAKETTE) taksit için artış farkı FARK taksiti olur; PLANLANDI taksit yeniden fiyatlanır, fark açılmaz', async () => {
    const id = await sozlesme()
    await prisma.taksit.update({ where: { id: (await taksit(id, '2026-11')).id }, data: { durum: 'PAKETTE' } })
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    const farklar = await prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' } })
    expect(farklar.map((f) => [f.anaTaksitId, f.artisHesabiId])).toEqual([[(await taksit(id, '2026-11')).id, a.id]])
    // Eski bedelle PAKETTE kalan taksite dokunulmadı; sonraki PLANLANDI taksit yeni bedelle yeniden hesaplandı.
    expect((await taksit(id, '2026-11')).tutar.toFixed(2)).toBe('10000.00')
    expect((await taksit(id, '2026-12')).tutar.toFixed(2)).toBe('13120.00')
  })

  /** Üç aylık, peşin sözleşme: 2026-11-01..2027-01-31 dönemi (3 × 10.000) ödenmiş. */
  async function odenmisUcAylik() {
    const id = await sozlesme({ odemePeriyoduAy: 3 })
    const ana = await taksit(id, '2026-11')
    await prisma.taksit.update({ where: { id: ana.id }, data: { durum: 'ODENDI' } })
    return { id, ana }
  }
  const farklar = (id: number) => prisma.taksit.findMany({ where: { sozlesmeId: id, tur: 'FARK' }, orderBy: { id: 'asc' } })
  const surum = async (id: number) => (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version
  async function artisiOnayla(id: number) {
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    return a
  }
  const tespit = (id: number, v: number, baslangic: string, bedel: string) =>
    kiraBedeliDegistir(id, v, { baslangic: t(baslangic), bedel: para(bedel), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN)

  it('FARK taksiti artıştan gelince hem artış hesabına hem artışı uygulayan kira dönemine bağlanır', async () => {
    const { id, ana } = await odenmisUcAylik()
    const a = await artisiOnayla(id)
    const [fark] = await farklar(id)
    const kd = await prisma.kiraDonemi.findFirstOrThrow({ where: { artisHesabiId: a.id } })
    expect([fark?.tutar.toFixed(2), fark?.anaTaksitId, fark?.artisHesabiId, fark?.kiraDonemiId, fark?.durum]).toEqual(['9360.00', ana.id, a.id, kd.id, 'PLANLANDI'])
  })

  it('tespit dönem başından geriye işler: ödenmiş taksitler için artış hesabı olmayan, kira dönemine bağlı pozitif FARK taksitleri açılır; yeniden çalıştırma tekrarlamaz', async () => {
    const id = await sozlesme()
    const kasim = await taksit(id, '2026-11')
    const aralik = await taksit(id, '2026-12')
    await prisma.taksit.updateMany({ where: { id: { in: [kasim.id, aralik.id] } }, data: { durum: 'ODENDI' } })
    const v = await surum(id)
    await tespit(id, v, '2026-11-01', '12000')
    const kd = await prisma.kiraDonemi.findFirstOrThrow({ where: { sozlesmeId: id, kaynak: 'TESPIT' } })
    const fark = await farklar(id)
    expect(fark.map((f) => [f.anaTaksitId, f.tutar.toFixed(2), iso(f.vadeTarihi), f.artisHesabiId, f.kiraDonemiId, f.durum]))
      .toEqual([[kasim.id, '2000.00', '2026-10-30', null, kd.id, 'PLANLANDI'], [aralik.id, '2000.00', '2026-10-30', null, kd.id, 'PLANLANDI']])
    // Ödeme sürecine girmeyen sonraki taksit yeniden fiyatlandı, FARK açılmadı.
    expect((await taksit(id, '2027-01')).tutar.toFixed(2)).toBe('12000.00')
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(2)

    // Aynı değişiklik yeniden gönderilirse kira dönemi zaten var: reddedilir, fark taksitleri değişmez.
    await expect(tespit(id, await surum(id), '2026-11-01', '12000')).rejects.toMatchObject({ kod: 'SIRA' })
    // Plan ve artış hesabı yeniden çalışınca FARK taksitleri aynen kalır.
    await prisma.$transaction(async (tx) => {
      await taksitPlaniniGuncelle(tx, id, BUGUN)
      await artislariHesapla(tx, BUGUN)
    })
    const sonra = await farklar(id)
    expect(sonra.map((f) => [f.id, f.tutar.toFixed(2), f.version, f.durum])).toEqual(fark.map((f) => [f.id, f.tutar.toFixed(2), f.version, f.durum]))
  })

  it('aynı ödenmiş taksit üzerinde art arda iki bedel değişikliği çakışmadan ikisi için de FARK üretir', async () => {
    const { id, ana } = await odenmisUcAylik()
    await tespit(id, await surum(id), '2026-11-01', '12000')
    const [ilk] = await farklar(id)
    expect(ilk?.tutar.toFixed(2)).toBe('6000.00')
    // İlk fark ödendi: tahakkuk etmiş sayılır.
    await prisma.taksit.update({ where: { id: ilk!.id }, data: { durum: 'ODENDI' } })
    // Dönem toplamı 12.000 + 2 × 15.000 = 42.000; tahakkuk 30.000 + 6.000 = 36.000.
    await tespit(id, await surum(id), '2026-12-01', '15000')
    const hepsi = await farklar(id)
    expect(hepsi.map((f) => [f.anaTaksitId, f.tutar.toFixed(2), f.durum])).toEqual([[ana.id, '6000.00', 'ODENDI'], [ana.id, '6000.00', 'PLANLANDI']])
    expect(new Set(hepsi.map((f) => f.kiraDonemiId)).size).toBe(2)
  })

  it('ödenmiş önceki FARK tahakkuk etmiş sayılır: ikinci değişiklik fazla ödeme çıkarırsa fark çift sayılmaz', async () => {
    const { id } = await odenmisUcAylik()
    await artisiOnayla(id)
    const [fark1] = await farklar(id)
    expect(fark1?.tutar.toFixed(2)).toBe('9360.00')
    await prisma.taksit.update({ where: { id: fark1!.id }, data: { durum: 'ODENDI' } })
    // Aralıktan itibaren 9.000: dönem toplamı 13.120 + 2 × 9.000 = 31.120; ödenen 30.000 + 9.360 = 39.360 → 8.240 fazla.
    await tespit(id, await surum(id), '2026-12-01', '9000')
    const h5 = await prisma.hatirlatma.findFirstOrThrow({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id } })
    expect(h5.aciklama).toContain('8.240,00')
    expect((await farklar(id)).map((f) => [f.id, f.durum])).toEqual([[fark1!.id, 'ODENDI']])
  })

  it('henüz PLANLANDI olan önceki FARK tahakkuk etmemiştir: iptal edilir, kalan farkın tamamı tek yeni FARK olur', async () => {
    const { id, ana } = await odenmisUcAylik()
    await artisiOnayla(id)
    const [fark1] = await farklar(id)
    expect([fark1?.tutar.toFixed(2), fark1?.durum]).toEqual(['9360.00', 'PLANLANDI'])
    // Aralıktan itibaren 9.000: dönem toplamı 31.120; ödenen yalnızca 30.000 → 1.120 eksik (9.360 FARK hiç ödenmedi).
    await tespit(id, await surum(id), '2026-12-01', '9000')
    const hepsi = await farklar(id)
    expect(hepsi.map((f) => [f.id === fark1!.id, f.tutar.toFixed(2), f.durum, f.artisHesabiId === null])).toEqual([[true, '9360.00', 'IPTAL', false], [false, '1120.00', 'PLANLANDI', true]])
    expect(hepsi[1]?.anaTaksitId).toBe(ana.id)
    expect(await prisma.hatirlatma.count({ where: { kural: 'H5_FAZLA_ODEME' } })).toBe(0)
  })

  it('PLANLANDI FARK iptal edilince fazla ödeme yalnızca ödenen tutara göre hesaplanır', async () => {
    const { id } = await odenmisUcAylik()
    await artisiOnayla(id)
    const [fark1] = await farklar(id)
    // Aralıktan itibaren 8.000: dönem toplamı 13.120 + 2 × 8.000 = 29.120; ödenen 30.000 → 880 fazla (FARK dahil sayılsaydı 10.240).
    await tespit(id, await surum(id), '2026-12-01', '8000')
    const h5 = await prisma.hatirlatma.findFirstOrThrow({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id } })
    expect(h5.aciklama).toContain('880,00')
    expect(h5.aciklama).not.toContain('10.240,00')
    expect((await farklar(id)).map((f) => [f.id === fark1!.id, f.durum])).toEqual([[true, 'IPTAL']])
  })
})

describe('kira bedeli değişikliği: doğrulamalar', () => {
  it('sürüm, açıklama, bedel, durum ve sözleşme bitişi denetlenir', async () => {
    const id = await sozlesme()
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    const g = { baslangic: t('2026-11-01'), bedel: para('12000'), kaynak: 'ANLASMA' as const, aciklama: 'Ek protokol' }
    await expect(kiraBedeliDegistir(id, s.version + 1, g, TEST_BAGLAMI, BUGUN)).rejects.toBeInstanceOf(CakismaHatasi)
    await expect(kiraBedeliDegistir(id, s.version, { ...g, aciklama: ' x ' }, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'ACIKLAMA' })
    await expect(kiraBedeliDegistir(id, s.version, { ...g, aciklama: 'x'.repeat(501) }, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'ACIKLAMA' })
    await expect(kiraBedeliDegistir(id, s.version, { ...g, bedel: para('0') }, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'BEDEL' })
    await expect(kiraBedeliDegistir(id, s.version, { ...g, baslangic: t('2027-11-01') }, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'BASLANGIC' })
    await expect(kiraBedeliDegistir(999_999, 0, g, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ name: 'BulunamadiHatasi' })
    await prisma.sozlesme.update({ where: { id }, data: { durum: 'SONA_ERDI', version: { increment: 1 } } })
    await expect(kiraBedeliDegistir(id, s.version + 1, g, TEST_BAGLAMI, BUGUN)).rejects.toMatchObject({ kod: 'DURUM' })
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
  })

  it('onay bekleyen daha erken bir artış varken sonraki bir tarihe bedel değişikliği engellenir; hiçbir şey yazılmaz', async () => {
    const id = await sozlesme()
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await expect(kiraBedeliDegistir(id, s.version, { baslangic: t('2026-12-01'), bedel: para('12000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN))
      .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'ACIK_ARTIS', alan: 'baslangic', message: '01.11.2026 tarihli artış onay bekliyor. Önce onu onaylayın ya da değişikliği o artışın başlangıç tarihinden başlatın.' })
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).durum).toBe('BEKLEMEDE')
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version).toBe(s.version)
  })

  it('değişiklik tam artış tarihinden başlarsa o artışın yerine geçer ve iptal edilen artış kimliği denetime yazılır', async () => {
    const id = await sozlesme()
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await kiraBedeliDegistir(id, s.version, { baslangic: t('2026-11-01'), bedel: para('12000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN)
    expect((await prisma.artisHesabi.findUniqueOrThrow({ where: { id: a.id } })).durum).toBe('IPTAL')
    const kayit = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'sozlesme', varlikId: String(id), eylem: 'KIRA_BEDELI_DEGISTI' } })
    expect((kayit.sonra as { iptalArtisIdleri: number[] }).iptalArtisIdleri).toEqual([a.id])
  })

  it('açık artışları iptal eder; ödeme sürecinde olmayan taksitler yeni bedelle yeniden hesaplanır', async () => {
    const id = await sozlesme()
    await hesapla()
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })).durum).toBe('BEKLEMEDE')
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await kiraBedeliDegistir(id, s.version, { baslangic: t('2026-11-01'), bedel: para('12000'), kaynak: 'ANLASMA', aciklama: 'Ek protokol' }, TEST_BAGLAMI, BUGUN)
    expect((await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })).durum).toBe('IPTAL')
    expect((await taksit(id, '2026-11')).tutar.toFixed(2)).toBe('12000.00')
    const kd = await prisma.kiraDonemi.findMany({ where: { sozlesmeId: id }, orderBy: { baslangic: 'asc' } })
    expect(kd.map((k) => [k.kaynak, iso(k.baslangic), iso(k.bitis), k.bedelTutari.toFixed(2), k.artisHesabiId, k.aciklama])).toEqual([
      ['ILK', '2025-11-01', '2026-10-31', '10000.00', null, null],
      ['ANLASMA', '2026-11-01', null, '12000.00', null, 'Ek protokol'],
    ])
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version).toBe(s.version + 1)
  })
})

describe('eşzamanlılık: sözleşme satır kilidi ilk ifade', () => {
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

  /** Başka bir yaşam döngüsü işleminin "sürümü artırdı (FOR NO KEY UPDATE), plan için FOR UPDATE'e yükseltiyor" anı. */
  async function surumuArtiranIslem(id: number) {
    let tutuyor!: () => void
    const tutuyorSoz = new Promise<void>((coz) => { tutuyor = coz })
    let birak!: () => void
    const birakSoz = new Promise<void>((coz) => { birak = coz })
    const baska = prisma.$transaction(async (tx) => {
      await tx.sozlesme.update({ where: { id }, data: { version: { increment: 1 } } })
      tutuyor()
      await birakSoz
      await tx.$queryRaw`SELECT id FROM sozlesme WHERE id = ${id} FOR UPDATE`
    })
    await tutuyorSoz
    return { baska, birak }
  }

  it('artış onayı kilidi alt satır eklemeden önce alır: kilide yükselten eşzamanlı işlemle kilitlenmez, sırayla uygulanır', async () => {
    const id = await sozlesme()
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const { baska, birak } = await surumuArtiranIslem(id)
    // Kilidi ilk ifadede almayan onay kira dönemi ekler (FOR KEY SHARE) ve plan için FOR UPDATE'e yükselirken diğer işlemle karşılıklı bekler (40P01).
    const onay = artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN).then(() => null, (e: unknown) => e)
    await kilitBekleyeniBekle()
    birak()
    await baska
    expect(await onay).toBeNull()
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(2)
  })

  it('bedel değişikliği kilidi ilk ifadede alır: araya giren sürüm artışı çakışma verir, kilitlenme yok', async () => {
    const id = await sozlesme()
    const v = (await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version
    const { baska, birak } = await surumuArtiranIslem(id)
    const degisim = kiraBedeliDegistir(id, v, { baslangic: t('2026-11-01'), bedel: para('12000'), kaynak: 'ANLASMA', aciklama: 'Ek protokol' }, TEST_BAGLAMI, BUGUN)
      .then(() => null, (e: unknown) => e)
    await kilitBekleyeniBekle()
    birak()
    await baska
    expect(await degisim).toBeInstanceOf(CakismaHatasi)
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
  })

  it('aynı artışı eşzamanlı onaylayan iki işlemden yalnızca biri uygulanır', async () => {
    const id = await sozlesme()
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    const sonuclar = await Promise.allSettled([
      artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN),
      artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN),
    ])
    expect(sonuclar.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    const red = sonuclar.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    expect(red?.reason).toBeInstanceOf(CakismaHatasi)
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(2)
  })
})
