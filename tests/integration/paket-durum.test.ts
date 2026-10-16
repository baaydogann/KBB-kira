import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { para } from '@/core/para'
import { tarih as t, type Tarih } from '@/core/tarih'
import { prisma } from '@/server/db'
import { tarihDb, tarihDbOpt } from '@/server/donustur'
import { CakismaHatasi, IsKuraliHatasi } from '@/server/hata'
import { borcSorguEkle, hacizEkle } from '@/server/kesinti/servis'
import { parametreEkle } from '@/server/parametre/servis'
import { paketIptal, paketKesinlestir, paketOdemeEmriGir, paketOdemeGeriAl, paketOdendi } from '@/server/paket/durum'
import { paketHesapla, type HesapParmakIzi, type PaketOnKontrolKaydi } from '@/server/paket/hesapla'
import { sozlesmeFeshet } from '@/server/sozlesme/yasam-dongusu'
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

const hata = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)
const kod = async (p: Promise<unknown>) => ((await hata(p)) as IsKuraliHatasi | null)?.kod
const sorgu = (borc: string | null, bugun: Tarih = BUGUN) =>
  borcSorguEkle({ kisiId: h.kisiA, sorguTarihi: bugun, borcVar: borc !== null, borcTutari: borc === null ? null : para(borc), vergiDairesi: 'Meram V.D.', belgeNo: 'B-1', belgeId: null }, TEST_BAGLAMI, bugun)
const haciz = (tutar: string) =>
  hacizEkle({ kisiId: h.kisiA, alacakli: 'Konya 1. İcra', dosyaNo: '2026/9', tebligTarihi: t('2026-01-10'), toplamTutar: para(tutar) }, TEST_BAGLAMI, BUGUN)
const paket = (id: number) => prisma.odemePaketi.findUniqueOrThrow({ where: { id } })
const taksit = (id: number) => prisma.taksit.findUniqueOrThrow({ where: { id } })
const dagilim = (paketId: number) => prisma.taksitDagilim.findFirstOrThrow({ where: { paketId }, orderBy: { sira: 'asc' } })
const damgaPayi = (sozlesmeId: number) => prisma.damgaPayi.findFirstOrThrow({ where: { damgaKaydi: { sozlesmeId } } })

/** Şubat paketi (taksit vadesi 2026-02-01), sorgu (varsayılan borç yok; `false`: sorgusuz) ve hesap (sürüm 1). */
async function hesaplanmisPaket(o: { sorguBorcu?: string | null | false; haciz?: string } = {}) {
  const s = await aktifSozlesme(h)
  const subat = (await sozlesmeTaksitleri(s)).find((x) => tarihDb(x.vadeTarihi) === '2026-02-01')!
  if (o.sorguBorcu !== false) await sorgu(o.sorguBorcu ?? null)
  const hacizId = o.haciz === undefined ? null : await haciz(o.haciz)
  const p = await paketKur(h)
  await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
  return { s, p, subat, hacizId }
}

/** Aynı sözleşmenin Mart taksiti için ikinci paket. */
async function martPaketi(): Promise<number> {
  const p = await paketKur(h, { ad: 'Mart 2026', vadeBaslangic: t('2026-03-01'), vadeBitis: t('2026-03-31') })
  await paketHesapla(p, 0, TEST_BAGLAMI, BUGUN)
  return p
}

async function odemeEmrinde(bugun: Tarih = BUGUN) {
  const r = await hesaplanmisPaket()
  await paketKesinlestir(r.p, 1, TEST_BAGLAMI, BUGUN)
  await paketOdemeEmriGir(r.p, 2, { no: 'ÖE-2026/14', tarih: bugun }, TEST_BAGLAMI, bugun)
  return r
}

describe('kesinleştirme', () => {
  it('kesinleştir: taksitler PAKETTE, damga payı kalanı 0, haciz kalanı düşer, paket KESINLESTI; dağılım güncellemesi dagilim_degismez ile reddedilir', async () => {
    const { s, p, subat, hacizId } = await hesaplanmisPaket({ haciz: '9000.00' })
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const tk = await taksit(subat.id)
    expect([tk.durum, tk.version]).toEqual(['PAKETTE', subat.version + 1])
    expect((await damgaPayi(s)).kalan.toFixed(2)).toBe('0.00')
    const hz = await prisma.haciz.findUniqueOrThrow({ where: { id: hacizId! } })
    expect([hz.kalanTutar.toFixed(2), hz.durum]).toEqual(['1226.80', 'AKTIF'])
    const pk = await paket(p)
    expect([pk.durum, pk.version, pk.kesinlesmeZamani !== null]).toEqual(['KESINLESTI', 2, true])
    await expect(prisma.taksitDagilim.updateMany({ where: { paketId: p }, data: { net: '0' } })).rejects.toThrow(/dagilim_degismez/)
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'KESINLESTIR' } })
    expect(d.sonra).toMatchObject({ toplam: { net: '0.00' } })
  })

  it('ön kontrol hatası olan paket kesinleşmez (ON_KONTROL)', async () => {
    const { p } = await hesaplanmisPaket({ sorguBorcu: false })
    const e = await hata(paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).kod).toBe('ON_KONTROL')
    expect((e as Error).message).toMatch(/^Ön kontrolde hata var: /)
    expect((await paket(p)).durum).toBe('HESAPLANDI')
  })

  it('hesap dünden kaldıysa (bugün 2026-01-26) YENIDEN_HESAPLA', async () => {
    const { p } = await hesaplanmisPaket()
    const e = await hata(paketKesinlestir(p, 1, TEST_BAGLAMI, t('2026-01-26')))
    expect((e as IsKuraliHatasi).kod).toBe('YENIDEN_HESAPLA')
    expect((e as Error).message).toBe('Hesap 25.01.2026 tarihinde yapıldı; paketi yeniden hesaplayın.')
  })

  it('hesaptan sonra taksit yeniden fiyatlandıysa (tutar + sürüm doğrudan güncellenir) YENIDEN_HESAPLA', async () => {
    const { p, subat } = await hesaplanmisPaket()
    await prisma.taksit.update({ where: { id: subat.id }, data: { tutar: '11000.00', version: { increment: 1 } } })
    const e = await hata(paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).kod).toBe('YENIDEN_HESAPLA')
    expect((e as Error).message).toBe('Taksit tutarı ya da durumu değişti; paketi yeniden hesaplayın.')
    expect((await taksit(subat.id)).durum).toBe('PLANLANDI')
  })

  it('hesaptan sonra kişiye yeni haciz eklendiyse YENIDEN_HESAPLA', async () => {
    const { p } = await hesaplanmisPaket()
    await haciz('1000.00')
    const e = await hata(paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).kod).toBe('YENIDEN_HESAPLA')
    expect((e as Error).message).toBe('Sözleşme, malik, oran ya da kesinti kaynakları değişti; paketi yeniden hesaplayın.')
  })

  it('hesaptan sonra malik değiştiyse (sözleşme sürümü) YENIDEN_HESAPLA', async () => {
    const { s, p } = await hesaplanmisPaket()
    await prisma.sozlesme.update({ where: { id: s }, data: { version: { increment: 1 } } })
    expect(await kod(paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN))).toBe('YENIDEN_HESAPLA')
  })

  it('aynı haciz iki pakette: ilki kesinleşir, ikincisi YENIDEN_HESAPLA; yeniden hesapta kalan kadar keser', async () => {
    const { p, hacizId } = await hesaplanmisPaket({ haciz: '9000.00' })
    const mart = await martPaketi()
    expect((await dagilim(mart)).hacizKesintisi.toFixed(2)).toBe('7773.20')
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    expect(await kod(paketKesinlestir(mart, 1, TEST_BAGLAMI, BUGUN))).toBe('YENIDEN_HESAPLA')
    await paketHesapla(mart, 1, TEST_BAGLAMI, BUGUN)
    const d = await dagilim(mart)
    expect([d.damgaKesintisi.toFixed(2), d.hacizKesintisi.toFixed(2)]).toEqual(['0.00', '1226.80'])
    await paketKesinlestir(mart, 2, TEST_BAGLAMI, BUGUN)
    const hz = await prisma.haciz.findUniqueOrThrow({ where: { id: hacizId! } })
    expect([hz.kalanTutar.toFixed(2), hz.durum, hz.kapanisNedeni]).toEqual(['0.00', 'KAPANDI', null])
  })

  it('aynı 22/A sorgusu iki pakette (borç 6.000): ilki 6.000 keser ve kesinleşir; ikincisi yeniden hesapta 0 keser', async () => {
    const { p } = await hesaplanmisPaket({ sorguBorcu: '6000.00' })
    const mart = await martPaketi()
    expect((await dagilim(p)).kesinti22a.toFixed(2)).toBe('6000.00')
    expect((await dagilim(mart)).kesinti22a.toFixed(2)).toBe('6000.00')
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    expect(await kod(paketKesinlestir(mart, 1, TEST_BAGLAMI, BUGUN))).toBe('YENIDEN_HESAPLA')
    await paketHesapla(mart, 1, TEST_BAGLAMI, BUGUN)
    expect((await dagilim(mart)).kesinti22a.toFixed(2)).toBe('0.00')
    await paketKesinlestir(mart, 2, TEST_BAGLAMI, BUGUN)
  })

  it('eşzamanlı kesinleştirme: iki ayrı işlem aynı paketi kesinleştirir → biri başarılı, diğeri CakismaHatasi ya da DURUM', async () => {
    const { p } = await hesaplanmisPaket()
    const sonuclar = await Promise.allSettled([paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN), paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)])
    expect(sonuclar.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const red = sonuclar.find((x) => x.status === 'rejected') as PromiseRejectedResult
    expect(red.reason instanceof CakismaHatasi || (red.reason as IsKuraliHatasi).kod === 'DURUM').toBe(true)
    expect((await paket(p)).durum).toBe('KESINLESTI')
  })

  it('kesinleştirme aynı gün değişen stopaj oranını (yeni yürürlük kaydı) satır karşılaştırmasıyla yakalar → YENIDEN_HESAPLA', async () => {
    const { p } = await hesaplanmisPaket()
    await parametreEkle({ anahtar: 'STOPAJ_94_5A', deger: '15', yururlukBaslangic: BUGUN, yururlukBitis: null, mevzuatDayanagi: null, aciklama: null }, TEST_BAGLAMI)
    expect(await kod(paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN))).toBe('YENIDEN_HESAPLA')
    await paketHesapla(p, 1, TEST_BAGLAMI, BUGUN)
    expect((await dagilim(p)).stopaj.toFixed(2)).toBe('1500.00')
    await paketKesinlestir(p, 2, TEST_BAGLAMI, BUGUN)
  })
})

describe('ödeme emri ve ödeme', () => {
  it('ödeme emri ve ödendi: PAKETTE → ODEME_EMRINDE → ODENDI, odemeTarihi; tarih kuralları ihlali reddedilir', async () => {
    const { p, subat } = await odemeEmrinde()
    expect((await taksit(subat.id)).durum).toBe('ODEME_EMRINDE')
    const pk = await paket(p)
    expect([pk.durum, pk.muhasebeOdemeEmriNo, tarihDbOpt(pk.muhasebeOdemeEmriTarihi)]).toEqual(['ODEME_EMRINDE', 'ÖE-2026/14', '2026-01-25'])
    const bugun = t('2026-01-26')
    expect(await kod(paketOdendi(p, 3, t('2026-01-24'), TEST_BAGLAMI, bugun))).toBe('TARIH')
    expect(await kod(paketOdendi(p, 3, t('2026-01-27'), TEST_BAGLAMI, bugun))).toBe('TARIH')
    expect(await paketOdendi(p, 3, bugun, TEST_BAGLAMI, bugun)).toEqual([])
    const tk = await taksit(subat.id)
    expect([tk.durum, tarihDbOpt(tk.odemeTarihi), tk.sistemDisiOdeme]).toEqual(['ODENDI', '2026-01-26', false])
    const son = await paket(p)
    expect([son.durum, tarihDbOpt(son.odemeTarihi), son.version]).toEqual(['ODENDI', '2026-01-26', 4])
  })

  it('ödendi: 22/A belgesi ödeme tarihinden önce bittiyse uyarı döner', async () => {
    const { p } = await odemeEmrinde(t('2026-02-09'))
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const uyarilar = await paketOdendi(p, 3, t('2026-02-10'), TEST_BAGLAMI, t('2026-02-10'))
    expect(uyarilar).toEqual([`${kisi.ad} ${kisi.soyad} için 22/A belgesi ödeme tarihinde geçerli değildi (09.02.2026); muhasebe birimine bildirin.`])
  })

  it('ödeme emri: sorgu 2026-01-25 (bitiş 2026-02-09); ödeme emri tarihi 2026-02-10 → reddedilir, 2026-02-09 → kabul', async () => {
    const { p } = await hesaplanmisPaket()
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const bugun = t('2026-02-10')
    const kisi = await prisma.kisi.findUniqueOrThrow({ where: { id: h.kisiA } })
    const e = await hata(paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: bugun }, TEST_BAGLAMI, bugun))
    expect((e as IsKuraliHatasi).kod).toBe('SORGU_22A')
    expect((e as Error).message).toBe(`${kisi.ad} ${kisi.soyad} için 10.02.2026 tarihinde geçerli 22/A borç sorgusu yok; kişi sayfasından yeni sorgu girin.`)
    await paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: t('2026-02-09') }, TEST_BAGLAMI, bugun)
    expect((await paket(p)).durum).toBe('ODEME_EMRINDE')
  })

  it('ödeme emri: süresi dolan sorgu yerine 2026-02-10 tarihli borç yok sorgusu girilince 2026-02-10 ödeme emri kabul; yeni sorgu 6.000 borç gösterirse reddedilir (yeniden hesap)', async () => {
    const { p } = await hesaplanmisPaket()
    const ilk = (await prisma.borcSorgu.findFirstOrThrow({ where: { kisiId: h.kisiA } })).id
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const bugun = t('2026-02-10')
    await sorgu('6000.00', bugun)
    const e = await hata(paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: bugun }, TEST_BAGLAMI, bugun))
    expect((e as IsKuraliHatasi).kod).toBe('SORGU_22A')
    expect((e as Error).message).toMatch(/için yeni 22\/A sorgusu kesintiyi değiştiriyor; paketi iptal edip yeniden hesaplayın\.$/)
    const yeni = await sorgu(null, bugun)
    await paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: bugun }, TEST_BAGLAMI, bugun)
    const pk = await paket(p)
    expect((pk.onKontrol as unknown as PaketOnKontrolKaydi).alicilar22a.map((a) => a.borcSorguId)).toEqual([String(yeni)])
    expect((pk.hesapParmakIzi as unknown as HesapParmakIzi).sorgular).toEqual([String(ilk)])
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'ODEME_EMRI' } })
    expect(d.sonra).toMatchObject({ sorgular: [String(yeni)] })
  })

  it('ödeme emri tarihi hesap tarihinden önce ya da bugünden sonra reddedilir (bugün parametresiyle, gerçek saat kullanılmadan)', async () => {
    const { p } = await hesaplanmisPaket()
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const bugun = t('2026-01-26')
    expect(await kod(paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: t('2026-01-24') }, TEST_BAGLAMI, bugun))).toBe('TARIH')
    expect(await kod(paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: t('2026-01-27') }, TEST_BAGLAMI, bugun))).toBe('TARIH')
    expect(await kod(paketOdemeEmriGir(p, 2, { no: '  ', tarih: bugun }, TEST_BAGLAMI, bugun))).toBe('ODEME_EMRI_NO')
    await paketOdemeEmriGir(p, 2, { no: 'ÖE-1', tarih: bugun }, TEST_BAGLAMI, bugun)
  })

  it('ödemeyi geri al: ODENDI → ODEME_EMRINDE, taksitler ODEME_EMRINDE ve odemeTarihi null; nedensiz reddedilir', async () => {
    const { p, subat } = await odemeEmrinde()
    await paketOdendi(p, 3, BUGUN, TEST_BAGLAMI, BUGUN)
    expect(await kod(paketOdemeGeriAl(p, 4, '  ', TEST_BAGLAMI))).toBe('NEDEN')
    await paketOdemeGeriAl(p, 4, 'Banka iade etti', TEST_BAGLAMI)
    const tk = await taksit(subat.id)
    expect([tk.durum, tk.odemeTarihi]).toEqual(['ODEME_EMRINDE', null])
    const pk = await paket(p)
    expect([pk.durum, pk.odemeTarihi, pk.version]).toEqual(['ODEME_EMRINDE', null, 5])
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'ODEME_GERI_AL' } })
    expect(d.sonra).toEqual({ nedenGirildi: true })
  })
})

describe('iptal', () => {
  it('iptal (KESINLESTI): taksitler PLANLANDI, damga ve haciz kalanları geri gelir, otomatik kapanan haciz AKTIF olur, taksitler yeni pakete eklenebilir', async () => {
    const { s, p, subat, hacizId } = await hesaplanmisPaket({ haciz: '2000.00' })
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    expect((await prisma.haciz.findUniqueOrThrow({ where: { id: hacizId! } })).durum).toBe('KAPANDI')
    expect(await kod(paketIptal(p, 2, '', TEST_BAGLAMI, BUGUN))).toBe('NEDEN')
    await paketIptal(p, 2, 'Hatalı ödeme listesi', TEST_BAGLAMI, BUGUN)
    expect((await taksit(subat.id)).durum).toBe('PLANLANDI')
    expect((await damgaPayi(s)).kalan.toFixed(2)).toBe('226.80')
    const hz = await prisma.haciz.findUniqueOrThrow({ where: { id: hacizId! } })
    expect([hz.kalanTutar.toFixed(2), hz.durum]).toEqual(['2000.00', 'AKTIF'])
    const pk = await paket(p)
    expect([pk.durum, pk.iptalNedeni]).toEqual(['IPTAL', 'Hatalı ödeme listesi'])
    expect(await prisma.paketTaksit.count({ where: { paketId: p, aktif: true } })).toBe(0)
    const d = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'odeme_paketi', varlikId: String(p), eylem: 'IPTAL' } })
    expect(JSON.stringify(d.sonra)).not.toContain('Hatalı')
    expect(d.sonra).toMatchObject({ nedenGirildi: true, onceDurum: 'KESINLESTI' })
    const yeni = await paketKur(h)
    expect((await prisma.paketTaksit.findMany({ where: { paketId: yeni } })).map((x) => x.taksitId)).toEqual([subat.id])
  })

  it('iptal (HESAPLANDI): paket IPTAL, taksit aktif paketten çıkar, dağılım satırları kalır', async () => {
    const { p, subat } = await hesaplanmisPaket()
    await paketIptal(p, 1, 'Yanlış birim', TEST_BAGLAMI, BUGUN)
    expect((await paket(p)).durum).toBe('IPTAL')
    expect(await prisma.paketTaksit.count({ where: { taksitId: subat.id, aktif: true } })).toBe(0)
    expect(await prisma.taksitDagilim.count({ where: { paketId: p } })).toBe(1)
    expect((await taksit(subat.id)).durum).toBe('PLANLANDI')
    expect(await kod(paketIptal(p, 2, 'Tekrar', TEST_BAGLAMI, BUGUN))).toBe('DURUM')
  })

  it('ODENDI paket iptal edilemez', async () => {
    const { p } = await odemeEmrinde()
    await paketOdendi(p, 3, BUGUN, TEST_BAGLAMI, BUGUN)
    const e = await hata(paketIptal(p, 4, 'Tutar hatalı', TEST_BAGLAMI, BUGUN))
    expect((e as IsKuraliHatasi).kod).toBe('ODENDI')
    expect((await paket(p)).durum).toBe('ODENDI')
  })

  it('iptal sonrası plan: fesihten sonraki dönemin taksiti PLANLANDI a dönünce iptal edilir (vadesi gelmemiş)', async () => {
    const { s, p, subat } = await hesaplanmisPaket()
    await paketKesinlestir(p, 1, TEST_BAGLAMI, BUGUN)
    const sz = await prisma.sozlesme.findUniqueOrThrow({ where: { id: s } })
    await sozlesmeFeshet(s, sz.version, { tarih: BUGUN, neden: 'Tahliye edildi' }, TEST_BAGLAMI, BUGUN)
    expect((await taksit(subat.id)).durum).toBe('PAKETTE')
    await paketIptal(p, 2, 'Fesih sonrası iptal', TEST_BAGLAMI, BUGUN)
    expect((await taksit(subat.id)).durum).toBe('IPTAL')
    expect(await paketSurumu(p)).toBe(3)
  })
})
