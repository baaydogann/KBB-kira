import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@/generated/prisma'
import { GET } from '@/app/takvim/[dosya]/route'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { tokenOzeti } from '@/server/auth/oturum'
import { dbTarih } from '@/server/donustur'
import { ortam } from '@/server/env'
import { icsTokenIptal, icsTokenUret, takvimIcerigi, takvimUrl } from '@/server/takvim/servis'
import { hatirlatmalariUretVeKaydet } from '@/server/hatirlatma/servis'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { kullaniciOlustur } from '@/server/kullanici/servis'
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
    expect(ics).not.toContain('TAMAMLANDI-KAYIT')
    expect(ics).not.toContain('KAPANDI-KAYIT')
    expect(ics).not.toContain('SEKIZ-GUN-ONCE')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    // Sıra hedef tarihe göre artandır.
    expect(ics.indexOf('YEDI-GUN-ONCE')).toBeLessThan(ics.indexOf('ACIK-BUGUN'))
    expect(ics.indexOf('ACIK-BUGUN')).toBeLessThan(ics.indexOf('ERTELENDI-KAYIT'))
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

describe('/takvim/<token>.ics uç noktası', () => {
  it('takvimUrl adresi uç noktayla uyumludur; yanıt takvim türünde ve önbelleğe alınamaz', async () => {
    const kid = await yeniKullanici('uc.nokta')
    await hatirlatmaEkle({ baslik: 'UC-NOKTA-KAYDI', hedefTarih: dbTarih(t('2999-01-01')) })
    const token = await icsTokenUret(kid, TEST_BAGLAMI)
    const url = new URL(takvimUrl(token))
    expect(url.origin).toBe(new URL(ortam().APP_URL).origin)
    expect(url.pathname).toBe(`/takvim/${token}.ics`)
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
