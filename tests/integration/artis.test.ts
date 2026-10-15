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
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
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
  it('ödeme sürecindeki taksit için artış farkı yalnızca artış hesabına bağlı taksit olur; PLANLANDI taksit yeniden fiyatlanır, fark açılmaz', async () => {
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

  it('üç aylık ödenmiş taksitte ikinci değişiklik, önceki fark taksitini eski tutara sayar (çift sayım yok)', async () => {
    const id = await sozlesme({ odemePeriyoduAy: 3 })
    // 2026-11-01..2027-01-31 dönemi ödenmiş.
    await prisma.taksit.update({ where: { id: (await taksit(id, '2026-11')).id }, data: { durum: 'ODENDI' } })
    await tufe12Gir(10, '31.20')
    await hesapla()
    const a = await prisma.artisHesabi.findFirstOrThrow({ where: { sozlesmeId: id } })
    await artisOnayla(a.id, a.version, TEST_BAGLAMI, BUGUN)
    const fark = await prisma.taksit.findFirstOrThrow({ where: { sozlesmeId: id, tur: 'FARK' } })
    expect(fark.tutar.toFixed(2)).toBe('9360.00')

    // Aralıktan itibaren 9.000: dönem toplamı 13.120 + 2 × 9.000 = 31.120; ödenen 30.000 + 9.360 = 39.360 → 8.240 fazla.
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    await kiraBedeliDegistir(id, s.version, { baslangic: t('2026-12-01'), bedel: para('9000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN)
    const h5 = await prisma.hatirlatma.findFirstOrThrow({ where: { kural: 'H5_FAZLA_ODEME', sozlesmeId: id } })
    expect(h5.aciklama).toContain('8.240,00')
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(1)
  })

  it('artış hesabı olmayan bedel değişikliği ödenmiş taksitte eksik ödeme doğuracaksa reddedilir ve hiçbir şey değişmez', async () => {
    const id = await sozlesme()
    await prisma.taksit.update({ where: { id: (await taksit(id, '2026-11')).id }, data: { durum: 'ODENDI' } })
    const s = await prisma.sozlesme.findUniqueOrThrow({ where: { id } })
    // taksit_fark_baglantili: FARK taksiti artış hesabına bağlı olmalı; bağsız artış için ham veritabanı hatası yerine iş kuralı hatası.
    await expect(kiraBedeliDegistir(id, s.version, { baslangic: t('2026-11-01'), bedel: para('12000'), kaynak: 'TESPIT', aciklama: 'Karar' }, TEST_BAGLAMI, BUGUN))
      .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'FARK' })
    expect(await prisma.kiraDonemi.count({ where: { sozlesmeId: id } })).toBe(1)
    expect(await prisma.taksit.count({ where: { sozlesmeId: id, tur: 'FARK' } })).toBe(0)
    expect((await prisma.sozlesme.findUniqueOrThrow({ where: { id } })).version).toBe(s.version)
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
