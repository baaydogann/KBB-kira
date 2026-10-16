import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@/generated/prisma'
import { GET } from '@/app/takvim/[dosya]/route'
import { OTOMATIK_KURALLAR } from '@/core/hatirlatma'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { tokenOzeti } from '@/server/auth/oturum'
import { dbTarih } from '@/server/donustur'
import { ortam } from '@/server/env'
import { icsTokenIptal, icsTokenUret, takvimIcerigi, takvimUrl } from '@/server/takvim/servis'
import { TAKVIM_ISTEK_GUNLUGU_HARIC } from '@/server/takvim/yol'
import { hatirlatmalariUretVeKaydet } from '@/server/hatirlatma/servis'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { kullaniciAktiflik, kullaniciOlustur, sifreSifirla } from '@/server/kullanici/servis'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik } from './sozlesme-yardimci'

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

const BUGUN = t('2026-10-15')

const yeniKullanici = (kullaniciAdi: string) =>
  kullaniciOlustur({ kullaniciAdi, adSoyad: 'Takvim Kullanıcı', geciciSifre: 'yeterince-uzun-sifre' }, TEST_BAGLAMI)

let sayac = 0
/** Motor dışında doğrudan yazılan hatırlatma (varsayılan: açık, 20 Ekim hedefli). */
function hatirlatmaEkle(ek: Partial<Prisma.HatirlatmaUncheckedCreateInput> = {}) {
  const n = ++sayac
  return prisma.hatirlatma.create({
    data: {
      anahtar: `TEST:${n}`, kural: 'H1', iliskiliTur: 'sistem', iliskiliId: String(n), baslik: `Baslik-${n}`, aciklama: `Aciklama-${n}`,
      hedefTarih: dbTarih(t('2026-10-20')), gorunurTarih: dbTarih(t('2026-10-01')), oncelik: 'NORMAL', ...ek,
    },
  })
}

/** Katlanmış içerik satırlarını (CRLF + boşluk) birleştirir; uzun metin aramaları satır katlamasına takılmasın. */
const duzles = (ics: string): string => ics.replace(/\r\n /g, '')

/** Başlığı (öncelik öneki hariç) tam olarak `baslik` olan VEVENT bloğu (satır katlaması çözülmüş; "B-H1" ile "B-H13" karışmaz). */
function etkinlik(ics: string, baslik: string): string {
  const blok = duzles(ics).split('BEGIN:VEVENT\r\n').slice(1)
    .find((b) => b.split('\r\n').some((satir) => satir.startsWith('SUMMARY:[') && satir.endsWith(`] ${baslik}`)))
  if (!blok) throw new Error(`Akışta etkinlik yok: ${baslik}`)
  return blok
}

const istek = (dosya: string) => GET(new Request(`http://localhost:3000/takvim/${dosya}`), { params: Promise.resolve({ dosya }) })

describe('.ics takvim', () => {
  it('token ile açık hatırlatmaları verir; kişisel veri içermez; yenilenen token eskisini geçersiz kılar', async () => {
    const h = await hazirlik()
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
    await prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, t('2026-10-15')))
    const kid = await kullaniciOlustur({ kullaniciAdi: 'takvim', adSoyad: 'Takvim Kullanıcı', geciciSifre: 'yeterince-uzun-sifre' }, TEST_BAGLAMI)
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const ics = await takvimIcerigi(token, t('2026-10-15'))
    expect(ics).not.toBeNull()
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('Sözleşme bitişi yaklaşıyor')
    const kisiler = await prisma.kisi.findMany()
    for (const k of kisiler) {
      expect(ics).not.toContain(k.tckn!)
      expect(ics).not.toContain(k.soyad!)
    }
    expect(ics).not.toMatch(/TR\d{24}/)
    const yeni = await icsTokenUret(kid, TEST_BAGLAMI)
    expect(await takvimIcerigi(token)).toBeNull()
    expect(await takvimIcerigi(yeni)).not.toBeNull()
    await icsTokenIptal(kid, TEST_BAGLAMI)
    expect(await takvimIcerigi(yeni)).toBeNull()
  })

  it('pasif kullanıcının takvimi kapanır', async () => {
    const kid = await kullaniciOlustur({ kullaniciAdi: 'pasif', adSoyad: 'Pasif Kullanıcı', geciciSifre: 'yeterince-uzun-sifre' }, TEST_BAGLAMI)
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    await prisma.kullanici.update({ where: { id: kid }, data: { aktif: false } })
    expect(await takvimIcerigi(token)).toBeNull()
  })

  it('bozuk biçimli ya da bilinmeyen token null döner', async () => {
    const kid = await yeniKullanici('bicim')
    await icsTokenUret(kid, TEST_BAGLAMI)
    for (const token of ['', 'kisa', 'a'.repeat(19), 'a b'.padEnd(32, 'x'), `${'a'.repeat(31)}.`, '../'.padEnd(32, 'x'), 'x'.repeat(32)]) {
      expect(await takvimIcerigi(token, BUGUN)).toBeNull()
    }
  })

  it('yalnızca açık ve ertelenmiş kayıtlar, hedefi en çok 7 gün öncesine kadar olanlar akışa girer; boş akış da geçerlidir', async () => {
    const kid = await yeniKullanici('filtre')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    expect(await takvimIcerigi(token, BUGUN)).toMatch(/^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/)
    expect(await takvimIcerigi(token, BUGUN)).not.toContain('BEGIN:VEVENT')

    await hatirlatmaEkle({ baslik: 'ACIK-BUGUN', hedefTarih: dbTarih(BUGUN) })
    await hatirlatmaEkle({ baslik: 'ERTELENDI-KAYIT', durum: 'ERTELENDI', ertelenenTarih: dbTarih(t('2026-10-30')), hedefTarih: dbTarih(t('2026-10-21')) })
    await hatirlatmaEkle({ baslik: 'TAMAMLANDI-KAYIT', durum: 'TAMAMLANDI', hedefTarih: dbTarih(t('2026-10-22')) })
    await hatirlatmaEkle({ baslik: 'KAPANDI-KAYIT', durum: 'OTOMATIK_KAPANDI', hedefTarih: dbTarih(t('2026-10-23')) })
    await hatirlatmaEkle({ baslik: 'SEKIZ-GUN-ONCE', hedefTarih: dbTarih(t('2026-10-07')) })
    await hatirlatmaEkle({ baslik: 'YEDI-GUN-ONCE', hedefTarih: dbTarih(t('2026-10-08')), oncelik: 'KRITIK' })
    const ics = duzles((await takvimIcerigi(token, BUGUN))!)
    expect(ics).toContain('SUMMARY:[NORMAL] ACIK-BUGUN')
    expect(ics).toContain('SUMMARY:[NORMAL] ERTELENDI-KAYIT')
    expect(ics).toContain('SUMMARY:[KRITIK] YEDI-GUN-ONCE')
    // Ertelenmiş kayıt hedef tarihinde (21 Ekim) değil, geri döneceği günde (30 Ekim) görünür.
    expect(etkinlik(ics, 'ERTELENDI-KAYIT')).toContain('DTSTART;VALUE=DATE:20261030\r\n')
    expect(etkinlik(ics, 'ACIK-BUGUN')).toContain('DTSTART;VALUE=DATE:20261015\r\n')
    expect(ics).not.toContain('TAMAMLANDI-KAYIT')
    expect(ics).not.toContain('KAPANDI-KAYIT')
    expect(ics).not.toContain('SEKIZ-GUN-ONCE')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    // Sıra hedef tarihe göre artandır.
    expect(ics.indexOf('YEDI-GUN-ONCE')).toBeLessThan(ics.indexOf('ACIK-BUGUN'))
    expect(ics.indexOf('ACIK-BUGUN')).toBeLessThan(ics.indexOf('ERTELENDI-KAYIT'))
  })

  // Kural (bugün 15 Ekim, eşik 8 Ekim): ERTELENDI kayıt `ertelenen >= eşik` ya da `hedef >= eşik` ise girer; etkinlik tarihi
  // `ertelenen >= eşik` ise ertelenen tarih, değilse hedef tarihidir.
  it('ertelenmiş kayıt: ertelenen tarih eşikten yeniyse o günde, eskiyse (ya da yoksa) hedef tarihinde görünür; hedefi yaklaşan kayıt kaybolmaz', async () => {
    const kid = await yeniKullanici('erteleme')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    await hatirlatmaEkle({ baslik: 'ACIK-NORMAL', hedefTarih: dbTarih(t('2026-10-20')) })
    // Hedefi çok eski, erteleme günü yakın: erteleme gününde görünür.
    await hatirlatmaEkle({ baslik: 'SNOOZE-GECIKMIS', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-09-01')), ertelenenTarih: dbTarih(t('2026-10-25')) })
    // Erteleme günü pencerenin tam sınırında (bugün - 7): ertelenen tarih geçerli.
    await hatirlatmaEkle({ baslik: 'SNOOZE-SINIR', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-12-01')), ertelenenTarih: dbTarih(t('2026-10-08')) })
    // Erteleme günü pencerenin dışında (bugün - 8) ama hedef ileride: kayıt hedef tarihinde takvimde kalır (açık hatırlatma kaybolmaz).
    await hatirlatmaEkle({ baslik: 'SNOOZE-ESKI', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-11-20')), ertelenenTarih: dbTarih(t('2026-10-07')) })
    // Erteleme günü pencerenin dışında, hedef pencerenin içinde (geçmişte): hedef tarihi.
    await hatirlatmaEkle({ baslik: 'SNOOZE-HEDEF-PENCEREDE', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-10-10')), ertelenenTarih: dbTarih(t('2026-10-02')) })
    // Erteleme tarihi yoksa hedef tarih geçerlidir.
    await hatirlatmaEkle({ baslik: 'SNOOZE-TARIHSIZ', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-10-18')) })
    await hatirlatmaEkle({ baslik: 'SNOOZE-TARIHSIZ-ESKI', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-10-07')) })
    const ics = (await takvimIcerigi(token, BUGUN))!
    expect(etkinlik(ics, 'SNOOZE-GECIKMIS')).toContain('DTSTART;VALUE=DATE:20261025\r\n')
    expect(etkinlik(ics, 'SNOOZE-SINIR')).toContain('DTSTART;VALUE=DATE:20261008\r\n')
    expect(etkinlik(ics, 'SNOOZE-ESKI')).toContain('DTSTART;VALUE=DATE:20261120\r\n')
    expect(etkinlik(ics, 'SNOOZE-HEDEF-PENCEREDE')).toContain('DTSTART;VALUE=DATE:20261010\r\n')
    expect(etkinlik(ics, 'SNOOZE-TARIHSIZ')).toContain('DTSTART;VALUE=DATE:20261018\r\n')
    expect(duzles(ics)).not.toContain('SNOOZE-TARIHSIZ-ESKI')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6)
    // Sıra etkinlik tarihine göredir.
    const sira = ['SNOOZE-SINIR', 'SNOOZE-HEDEF-PENCEREDE', 'SNOOZE-TARIHSIZ', 'ACIK-NORMAL', 'SNOOZE-GECIKMIS', 'SNOOZE-ESKI']
      .map((b) => duzles(ics).indexOf(`] ${b}\r\n`))
    expect(sira).toEqual([...sira].sort((a, b) => a - b))
    expect(new Set(sira).size).toBe(6)
    expect(sira[0]).toBeGreaterThan(-1)
  })

  it('ertelenen tarihi de hedef tarihi de pencere dışındaki ertelenmiş kayıt akışa girmez', async () => {
    const kid = await yeniKullanici('erteleme.eski')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    await hatirlatmaEkle({ baslik: 'ESKI-ERTELEME-VE-HEDEF', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-10-05')), ertelenenTarih: dbTarih(t('2026-10-01')) })
    await hatirlatmaEkle({ baslik: 'ESKI-ERTELEME-GUN-ONCE', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-10-07')), ertelenenTarih: dbTarih(t('2026-10-07')) })
    await hatirlatmaEkle({ baslik: 'ESKI-ACIK', hedefTarih: dbTarih(t('2026-10-07')) })
    await hatirlatmaEkle({ baslik: 'GORUNEN', hedefTarih: dbTarih(t('2026-10-16')) })
    const ics = duzles((await takvimIcerigi(token, BUGUN))!)
    expect(ics).not.toContain('ESKI-')
    expect(ics).toContain('GORUNEN')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('KRITIK açık ya da ertelenmiş kayıt 7 günlük pencereden bağımsız akışta kalır (gecikmiş kritik iş takvimden düşmez); kapanmış KRITIK kayıt girmez', async () => {
    const kid = await yeniKullanici('kritik')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    await hatirlatmaEkle({ baslik: 'ESKI-KRITIK-ACIK', oncelik: 'KRITIK', hedefTarih: dbTarih(t('2026-08-01')) })
    await hatirlatmaEkle({ baslik: 'ESKI-KRITIK-ERTELENDI', oncelik: 'KRITIK', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2026-09-01')), ertelenenTarih: dbTarih(t('2026-09-20')) })
    await hatirlatmaEkle({ baslik: 'ESKI-KRITIK-TAMAM', oncelik: 'KRITIK', durum: 'TAMAMLANDI', hedefTarih: dbTarih(t('2026-08-01')) })
    await hatirlatmaEkle({ baslik: 'ESKI-KRITIK-KAPANDI', oncelik: 'KRITIK', durum: 'OTOMATIK_KAPANDI', hedefTarih: dbTarih(t('2026-08-01')) })
    await hatirlatmaEkle({ baslik: 'ESKI-YUKSEK', oncelik: 'YUKSEK', hedefTarih: dbTarih(t('2026-10-07')) })
    const ics = (await takvimIcerigi(token, BUGUN))!
    expect(etkinlik(ics, 'ESKI-KRITIK-ACIK')).toContain('DTSTART;VALUE=DATE:20260801\r\n')
    expect(etkinlik(ics, 'ESKI-KRITIK-ERTELENDI')).toContain('DTSTART;VALUE=DATE:20260901\r\n')
    for (const yok of ['ESKI-KRITIK-TAMAM', 'ESKI-KRITIK-KAPANDI', 'ESKI-YUKSEK']) expect(duzles(ics)).not.toContain(yok)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })

  it('sınır etkinlik tarihine göre uygulanır: 2000 kayıttan fazlasında ertelenmiş kayıt yeni tarihinin sırasına girer, hedef sırasına göre kesilmez', async () => {
    const kid = await yeniKullanici('sinir')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const ortak = { kural: 'H1', iliskiliTur: 'sistem', iliskiliId: 'x', aciklama: 'a', gorunurTarih: dbTarih(t('2026-10-01')), oncelik: 'NORMAL' as const }
    await prisma.hatirlatma.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({ ...ortak, anahtar: `TOPLU:${i}`, baslik: `TOPLU-${i}`, hedefTarih: dbTarih(t('2026-10-20')) })),
    })
    // Hedefi en uzak, ama etkinlik tarihi (ertelenen) en erken: ilk 2000 içinde kalmalı. Eski hedef sıralı kesimde dışarıda kalırdı.
    await hatirlatmaEkle({ baslik: 'ERKEN-ERTELENEN', durum: 'ERTELENDI', hedefTarih: dbTarih(t('2027-06-01')), ertelenenTarih: dbTarih(t('2026-10-10')) })
    const ics = (await takvimIcerigi(token, BUGUN))!
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2000)
    const ilk = duzles(ics).split('BEGIN:VEVENT\r\n')[1]!
    expect(ilk).toContain('ERKEN-ERTELENEN')
    expect(ilk).toContain('DTSTART;VALUE=DATE:20261010\r\n')
  })

  it('H1 (taksit) tutarı akışa girmez; başlık ve sabit açıklama gider (spec §9: tutar panoda kalır)', async () => {
    const bugun = t('2026-10-28')
    const h = await hazirlik()
    const id = await sozlesmeTaslakKaydet(girdi(h), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
    await prisma.$transaction((tx) => hatirlatmalariUretVeKaydet(tx, bugun))
    const h1 = await prisma.hatirlatma.findMany({ where: { kural: 'H1', hedefTarih: { gte: dbTarih(bugun) } } })
    // Önkoşul: motorun H1 açıklamasında gerçekten tutar var; yoksa aşağıdaki denetimler anlamsız olurdu.
    expect(h1.length).toBeGreaterThan(0)
    for (const k of h1) expect(k.aciklama).toContain('₺')
    const token = await icsTokenUret(await yeniKullanici('h1.tutar'), TEST_BAGLAMI)
    const ics = (await takvimIcerigi(token, bugun))!
    for (const k of h1) expect(etkinlik(ics, k.baslik)).toContain('DESCRIPTION:Ayrıntı için KBB Kira Takip uygulamasında hatırlatmayı açın.\r\n')
    expect(ics).not.toContain('₺')
    expect(ics).not.toMatch(/\bTL\b/)
    expect(ics).not.toMatch(/\d[.\d]*\\?,\d{2}/)
  })

  it('H1 hariç her motor kuralı (OTOMATIK_KURALLAR + H13) kendi açıklamasını korur; H1 sabit açıklama alır', async () => {
    const kid = await yeniKullanici('motor.kurallari')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    // Listeden türetilir: motora eklenecek yeni bir kural açıklamasını sessizce kaybederse (genel metne düşerse) bu test düşer.
    const motor = [...OTOMATIK_KURALLAR.filter((k) => k !== 'H1'), 'H13']
    expect(motor).toContain('H6_SON_GUN')
    for (const kural of motor) await hatirlatmaEkle({ kural, baslik: `B-${kural}`, aciklama: `Motor-aciklama-${kural}` })
    await hatirlatmaEkle({ kural: 'H1', baslik: 'B-H1', aciklama: 'Dukkan: 10.000,00 ₺, vade 20.10.2026.' })
    const ics = (await takvimIcerigi(token, BUGUN))!
    for (const kural of motor) expect(etkinlik(ics, `B-${kural}`)).toContain(`DESCRIPTION:Motor-aciklama-${kural}\r\n`)
    expect(etkinlik(ics, 'B-H1')).toContain('DESCRIPTION:Ayrıntı için KBB Kira Takip uygulamasında hatırlatmayı açın.\r\n')
    expect(ics).not.toContain('10.000')
    expect(ics).not.toContain('₺')
  })

  it('KVKK: motor dışı kuralların serbest metni akışa girmez; yalnızca başlık ve sabit açıklama gider', async () => {
    const kid = await yeniKullanici('kvkk')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const kisiMetni = 'Ayşe Yılmaz (TCKN 12345678901, TR330006100519786457841326) için hata'
    const kurallar = ['UZAMA_BILGI', 'UZAMA_HATA', 'ARTIS_HESAP_HATA', 'H5_FAZLA_ODEME', 'TAKVIM_HATA']
    for (const kural of kurallar) await hatirlatmaEkle({ kural, baslik: `${kural} baslik — S-9`, aciklama: kisiMetni })
    await hatirlatmaEkle({ kural: 'H6', baslik: 'Motor kaydı — S-9', aciklama: 'Taşınmaz-Kisa-Ad: motor açıklaması' })
    const ics = duzles((await takvimIcerigi(token, BUGUN))!)
    for (const kural of kurallar) expect(ics).toContain(`SUMMARY:[NORMAL] ${kural} baslik — S-9`)
    expect(ics).not.toContain('Ayşe')
    expect(ics).not.toContain('Yılmaz')
    expect(ics).not.toContain('12345678901')
    expect(ics).not.toMatch(/TR\d{24}/)
    expect(ics.match(/DESCRIPTION:Ayrıntı için KBB Kira Takip uygulamasında hatırlatmayı açın\./g)).toHaveLength(kurallar.length)
    // Motorun ürettiği kuralın (çekirdekte yalnızca sözleşme no, taşınmaz kısa adı, tarih ve tutardan kurulan) açıklaması korunur.
    expect(ics).toContain('DESCRIPTION:Taşınmaz-Kisa-Ad: motor açıklaması')
  })

  it('token yalnızca özet olarak saklanır; denetim satırlarında ne token ne özet bulunur; iptal özeti siler', async () => {
    const kid = await yeniKullanici('ozet')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const kayit = await prisma.kullanici.findUniqueOrThrow({ where: { id: kid } })
    expect(kayit.icsTokenHash).toBe(tokenOzeti(token))
    expect(kayit.icsTokenHash).not.toContain(token)
    await icsTokenIptal(kid, TEST_BAGLAMI)
    expect((await prisma.kullanici.findUniqueOrThrow({ where: { id: kid } })).icsTokenHash).toBeNull()
    const satirlar = await prisma.olayGunlugu.findMany({ where: { varlik: 'kullanici', varlikId: String(kid), eylem: { startsWith: 'TAKVIM_TOKEN_' } }, orderBy: { id: 'asc' } })
    expect(satirlar.map((s) => s.eylem)).toEqual(['TAKVIM_TOKEN_URET', 'TAKVIM_TOKEN_IPTAL'])
    const ham = JSON.stringify(satirlar)
    expect(ham).not.toContain(token)
    expect(ham).not.toContain(tokenOzeti(token))
  })

  it('token kullanıcıya özeldir: birinin yenilenmesi ya da iptali diğerini etkilemez', async () => {
    const a = await yeniKullanici('kullanici.a')
    const b = await yeniKullanici('kullanici.b')
    const tokenA = await icsTokenUret(a, TEST_BAGLAMI)
    const tokenB = await icsTokenUret(b, TEST_BAGLAMI)
    expect(tokenA).not.toBe(tokenB)
    await icsTokenUret(a, TEST_BAGLAMI)
    expect(await takvimIcerigi(tokenA)).toBeNull()
    expect(await takvimIcerigi(tokenB)).not.toBeNull()
    await icsTokenIptal(a, TEST_BAGLAMI)
    expect(await takvimIcerigi(tokenB)).not.toBeNull()
  })
})

describe('hesap yaşam döngüsü takvim bağlantısını iptal eder', () => {
  it('pasifleştirme bağlantıyı siler; yeniden aktifleştirme eski adresi canlandırmaz; aktifleştirme başka bağlantıyı silmez', async () => {
    const kid = await yeniKullanici('pasif.dongu')
    const diger = await yeniKullanici('aktif.kalan')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const digerToken = await icsTokenUret(diger, TEST_BAGLAMI)
    await kullaniciAktiflik(kid, false, TEST_BAGLAMI)
    expect(await takvimIcerigi(token, BUGUN)).toBeNull()
    expect((await prisma.kullanici.findUniqueOrThrow({ where: { id: kid } })).icsTokenHash).toBeNull()
    await kullaniciAktiflik(kid, true, TEST_BAGLAMI)
    expect(await takvimIcerigi(token, BUGUN)).toBeNull()
    // Etkin bir kullanıcıyı "aktifleştirmek" bağlantısını silmez.
    await kullaniciAktiflik(diger, true, TEST_BAGLAMI)
    expect(await takvimIcerigi(digerToken, BUGUN)).not.toBeNull()
    // Yeniden etkinleşen kullanıcı yeni bağlantı üretebilir.
    expect(await takvimIcerigi(await icsTokenUret(kid, TEST_BAGLAMI), BUGUN)).not.toBeNull()
    const satir = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'kullanici', varlikId: String(kid), eylem: 'PASIFLESTIR' } })
    expect(satir.sonra).toEqual({ degisenAlanlar: ['aktif', 'icsTokenHash'] })
    expect(JSON.stringify(satir)).not.toContain(token)
    expect(JSON.stringify(satir)).not.toContain(tokenOzeti(token))
  })

  it('şifre sıfırlama bağlantıyı siler; kullanıcı yenisini üretebilir; başkasınınki etkilenmez', async () => {
    const kid = await yeniKullanici('sifirlanan')
    const diger = await yeniKullanici('sifirlanmayan')
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const digerToken = await icsTokenUret(diger, TEST_BAGLAMI)
    await sifreSifirla(kid, 'yeni-gecici-sifre-123', TEST_BAGLAMI)
    expect(await takvimIcerigi(token, BUGUN)).toBeNull()
    expect((await prisma.kullanici.findUniqueOrThrow({ where: { id: kid } })).icsTokenHash).toBeNull()
    expect(await takvimIcerigi(digerToken, BUGUN)).not.toBeNull()
    expect(await takvimIcerigi(await icsTokenUret(kid, TEST_BAGLAMI), BUGUN)).not.toBeNull()
    const satir = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'kullanici', varlikId: String(kid), eylem: 'SIFRE_SIFIRLA' } })
    expect(JSON.stringify(satir.sonra)).toContain('icsTokenHash')
    // Denetim satırında alan adı vardır, ne eski token ne özeti.
    expect(JSON.stringify(satir)).not.toContain(token)
    expect(JSON.stringify(satir)).not.toContain(tokenOzeti(token))
  })
})

describe('/takvim/<token>.ics uç noktası', () => {
  it('takvimUrl adresi uç noktayla uyumludur; yanıt takvim türünde ve önbelleğe alınamaz', async () => {
    const kid = await yeniKullanici('uc.nokta')
    await hatirlatmaEkle({ baslik: 'UC-NOKTA-KAYDI', hedefTarih: dbTarih(t('2999-01-01')) })
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const url = new URL(takvimUrl(token))
    expect(url.origin).toBe(new URL(ortam().APP_URL).origin)
    expect(url.pathname).toBe(`/takvim/${token}.ics`)
    expect(TAKVIM_ISTEK_GUNLUGU_HARIC.test(url.pathname)).toBe(true)
    const yanit = await istek(url.pathname.split('/').pop()!)
    expect(yanit.status).toBe(200)
    expect(yanit.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(yanit.headers.get('Cache-Control')).toBe('private, no-store')
    const govde = await yanit.text()
    expect(govde.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(duzles(govde)).toContain('UC-NOKTA-KAYDI')
  })

  it('bilinmeyen, iptal edilmiş, pasif kullanıcıya ait ve biçimsiz istekler ayırt edilemez 404 verir', async () => {
    const kid = await yeniKullanici('uc.yok')
    const iptal = await icsTokenUret(kid, TEST_BAGLAMI)
    await icsTokenIptal(kid, TEST_BAGLAMI)
    const pasifId = await yeniKullanici('uc.pasif')
    const pasif = await icsTokenUret(pasifId, TEST_BAGLAMI)
    await prisma.kullanici.update({ where: { id: pasifId }, data: { aktif: false } })
    const gecerli = await icsTokenUret(await yeniKullanici('uc.gecerli'), TEST_BAGLAMI)
    const dosyalar = [`${'x'.repeat(32)}.ics`, `${iptal}.ics`, `${pasif}.ics`, `${gecerli}.txt`, gecerli, '.ics', 'kisa.ics']
    const yanitlar = await Promise.all(dosyalar.map(istek))
    const govdeler = await Promise.all(yanitlar.map((y) => y.text()))
    for (const y of yanitlar) {
      expect(y.status).toBe(404)
      expect(y.headers.get('Cache-Control')).toBe('private, no-store')
      expect(y.headers.get('Content-Type')).not.toContain('text/calendar')
    }
    expect(new Set(govdeler).size).toBe(1)
  })
})
