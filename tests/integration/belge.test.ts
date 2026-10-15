import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Dosya deposu her testte geçici bir dizindir (depo içeriği doğrudan sınanır); oturum taklit edilir,
// veritabanı ve servis gerçektir.
const taklit = vi.hoisted(() => ({ dizin: '', kullanici: null as { id: number } | null }))
vi.mock('@/server/env', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/server/env')>()
  return { ...m, ortam: () => ({ ...m.ortam(), BELGE_DIZINI: taklit.dizin || m.ortam().BELGE_DIZINI }) }
})
vi.mock('@/server/auth/gerekli', () => ({ kullaniciGetir: async () => taklit.kullanici }))

import { GET } from '@/app/api/belgeler/[id]/route'
import { POST } from '@/app/api/belgeler/route'
import { prisma } from '@/server/db'
import { ortam } from '@/server/env'
import { BELGE_AZAMI_BAYT, belgeKaydet, belgeListesi, belgeOku, belgeyiBagla, sozlesmePdfVarMi } from '@/server/belge/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { temizle } from './yardimci'
import { ornekSozlesme } from './ornekler'

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const BAGLAM = { kullaniciId: 1, ip: null }

beforeEach(async () => {
  await rm(taklit.dizin, { recursive: true, force: true })
  taklit.dizin = await mkdtemp(join(tmpdir(), 'kbb-belge-'))
  taklit.kullanici = { id: 1 }
  await temizle()
  await prisma.kullanici.create({ data: { id: 1, kullaniciAdi: 'test', adSoyad: 'Test', sifreHash: 'x' } })
  await prisma.kullanici.create({ data: { id: 2, kullaniciAdi: 'diger', adSoyad: 'Diğer', sifreHash: 'x' } })
})
afterAll(async () => {
  await rm(taklit.dizin, { recursive: true, force: true })
  await prisma.$disconnect()
})

/** Depodaki tüm dosyaların (dizinler hariç) göreli adları. */
async function depoDosyalari(): Promise<string[]> {
  const girdiler = await readdir(taklit.dizin, { recursive: true, withFileTypes: true })
  return girdiler.filter((g) => g.isFile()).map((g) => join(g.parentPath, g.name).slice(taklit.dizin.length + 1).replaceAll('\\', '/')).sort()
}

describe('belge deposu', () => {
  it('PDF\'i sha256 yoluna yazar, aynı içerik tek dosya olur', async () => {
    const s = await ornekSozlesme()
    const a = await belgeKaydet({ sahipTur: 'sozlesme', sahipId: s.id, belgeTuru: 'SOZLESME', dosyaAdi: '../../tarama.pdf', icerik: PDF }, BAGLAM)
    const b = await belgeKaydet({ sahipTur: 'sozlesme', sahipId: s.id, belgeTuru: 'EK_PROTOKOL', dosyaAdi: 'ek.pdf', icerik: PDF }, BAGLAM)
    const [ba, bb] = await Promise.all([prisma.belge.findUniqueOrThrow({ where: { id: a } }), prisma.belge.findUniqueOrThrow({ where: { id: b } })])
    expect(ba.sha256).toBe(bb.sha256)
    expect(ba.dosyaAdi).toBe('tarama.pdf')
    expect(existsSync(join(ortam().BELGE_DIZINI, ba.sha256.slice(0, 2), `${ba.sha256}.pdf`))).toBe(true)
    expect((await belgeOku(a)).icerik.subarray(0, 5).toString()).toBe('%PDF-')
    expect(await belgeListesi('sozlesme', s.id)).toHaveLength(2)
    expect(await sozlesmePdfVarMi(s.id)).toBe(true)
  })

  it('PDF olmayan ve sınırı aşan dosyayı reddeder', async () => {
    await expect(belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'x.pdf', icerik: new TextEncoder().encode('MZ...') }, BAGLAM))
      .rejects.toBeInstanceOf(IsKuraliHatasi)
    const buyuk = new Uint8Array(BELGE_AZAMI_BAYT + 1)
    buyuk.set(PDF.subarray(0, 5))
    await expect(belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'b.pdf', icerik: buyuk }, BAGLAM))
      .rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('geçici belge yalnızca yükleyen kullanıcı tarafından bağlanır', async () => {
    const s = await ornekSozlesme()
    const id = await belgeKaydet({ sahipTur: 'gecici', sahipId: 999, belgeTuru: 'SOZLESME', dosyaAdi: 'g.pdf', icerik: PDF }, BAGLAM)
    expect((await prisma.belge.findUniqueOrThrow({ where: { id } })).sahipId).toBe(1)
    await expect(belgeyiBagla(prisma, id, 'sozlesme', s.id, { kullaniciId: 2, ip: null })).rejects.toBeInstanceOf(IsKuraliHatasi)
    await belgeyiBagla(prisma, id, 'sozlesme', s.id, BAGLAM)
    expect(await belgeListesi('sozlesme', s.id)).toHaveLength(1)
  })

  it.each([
    ['../../tarama.pdf', 'tarama.pdf'],
    ['..\\..\\Windows\\tarama.PDF', 'tarama.PDF'],
    ['C:\\Users\\a\\sözleşme.pdf', 'sözleşme.pdf'],
    ['rapor', 'rapor.pdf'],
    ['kötü.exe', 'kötü.exe.pdf'],
    ['a\u202Efdp.exe', 'afdp.exe.pdf'],
    ['sat\u0000ır\r\n.pdf', 'satır.pdf'],
    ['..', 'belge.pdf'],
    ['   ', 'belge.pdf'],
    ['', 'belge.pdf'],
    [`${'u'.repeat(300)}.pdf`, `${'u'.repeat(196)}.pdf`],
  ])('dosya adı %j yol/denetim karakteri içermeyen %j olarak saklanır', async (girdi, beklenen) => {
    const id = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: girdi, icerik: PDF }, BAGLAM)
    expect((await prisma.belge.findUniqueOrThrow({ where: { id } })).dosyaAdi).toBe(beklenen)
    // dosya adı depo yolunu hiçbir biçimde etkilemez
    const sha = (await prisma.belge.findUniqueOrThrow({ where: { id } })).sha256
    expect(await depoDosyalari()).toEqual([`${sha.slice(0, 2)}/${sha}.pdf`])
  })

  it('eşzamanlı aynı içerik yüklemeleri tek ve eksiksiz dosya bırakır, geçici dosya kalmaz', async () => {
    const idler = await Promise.all(Array.from({ length: 6 }, () => belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'e.pdf', icerik: PDF }, BAGLAM)))
    expect(new Set(idler).size).toBe(6)
    const sha = (await prisma.belge.findUniqueOrThrow({ where: { id: idler[0]! } })).sha256
    expect(await depoDosyalari()).toEqual([`${sha.slice(0, 2)}/${sha}.pdf`])
    expect(new Uint8Array(await readFile(join(taklit.dizin, sha.slice(0, 2), `${sha}.pdf`)))).toEqual(PDF)
  })

  it('yarım kalmış (kısalmış) depo dosyası aynı içeriğin yeniden yüklenmesiyle onarılır', async () => {
    const ilk = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'o.pdf', icerik: PDF }, BAGLAM)
    const sha = (await prisma.belge.findUniqueOrThrow({ where: { id: ilk } })).sha256
    const yol = join(taklit.dizin, sha.slice(0, 2), `${sha}.pdf`)
    await writeFile(yol, PDF.subarray(0, 7))
    await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'o.pdf', icerik: PDF }, BAGLAM)
    expect(new Uint8Array(await readFile(yol))).toEqual(PDF)
    expect(await depoDosyalari()).toEqual([`${sha.slice(0, 2)}/${sha}.pdf`])
  })

  it('veritabanındaki bozuk sha256 değeri depo dışında dosya açtırmaz', async () => {
    const id = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'DIGER', dosyaAdi: 'o.pdf', icerik: PDF }, BAGLAM)
    for (const kotu of ['../../../etc/passwd', '..x/../../x', 'A'.repeat(64), 'ab']) {
      await prisma.belge.update({ where: { id }, data: { sha256: kotu } })
      await expect(belgeOku(id)).rejects.toThrow('geçersiz')
    }
    await expect(belgeOku(id + 1)).rejects.toThrow('bulunamadı')
  })

  it('geçici belge bir kez bağlanır: ikinci bağlama (sıralı ya da eşzamanlı) reddedilir ve ilk bağlama bozulmaz', async () => {
    const s1 = await ornekSozlesme()
    const s2 = await ornekSozlesme()
    const sirali = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'SOZLESME', dosyaAdi: 'g.pdf', icerik: PDF }, BAGLAM)
    await belgeyiBagla(prisma, sirali, 'sozlesme', s1.id, BAGLAM)
    await expect(belgeyiBagla(prisma, sirali, 'sozlesme', s2.id, BAGLAM)).rejects.toBeInstanceOf(IsKuraliHatasi)
    expect(await belgeListesi('sozlesme', s1.id)).toHaveLength(1)
    expect(await belgeListesi('sozlesme', s2.id)).toHaveLength(0)

    const esZamanli = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'SOZLESME', dosyaAdi: 'h.pdf', icerik: PDF }, BAGLAM)
    const sonuclar = await Promise.allSettled([
      belgeyiBagla(prisma, esZamanli, 'sozlesme', s1.id, BAGLAM),
      belgeyiBagla(prisma, esZamanli, 'sozlesme', s2.id, BAGLAM),
    ])
    expect(sonuclar.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(sonuclar.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(IsKuraliHatasi) })
    const olaylar = await prisma.olayGunlugu.count({ where: { varlik: 'belge', varlikId: String(esZamanli), eylem: 'BAGLA' } })
    expect(olaylar).toBe(1)
  })

  it('oturumsuz bağlam (kullaniciId null) belge bağlayamaz', async () => {
    const s = await ornekSozlesme()
    const id = await belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'SOZLESME', dosyaAdi: 'g.pdf', icerik: PDF }, BAGLAM)
    await expect(belgeyiBagla(prisma, id, 'sozlesme', s.id, { kullaniciId: null, ip: null })).rejects.toBeInstanceOf(IsKuraliHatasi)
  })
})

const KAYNAK = 'http://localhost:3000'

function yuklemeIstegi(alanlar: Record<string, string | File>, ek: { origin?: string | null; uzunluk?: string } = {}): NextRequest {
  const f = new FormData()
  for (const [ad, deger] of Object.entries(alanlar)) f.set(ad, deger)
  const basliklar = new Headers({ host: 'localhost:3000' })
  if (ek.origin !== null) basliklar.set('origin', ek.origin ?? KAYNAK)
  if (ek.uzunluk !== undefined) basliklar.set('content-length', ek.uzunluk)
  return new NextRequest(`${KAYNAK}/api/belgeler`, { method: 'POST', headers: basliklar, body: f })
}

const pdfDosyasi = (ad = 'a.pdf', icerik: Uint8Array<ArrayBuffer> = PDF) => new File([icerik], ad, { type: 'application/pdf' })

const indir = (id: string) => GET(new Request(`${KAYNAK}/api/belgeler/${id}`), { params: Promise.resolve({ id }) })

describe('POST /api/belgeler', () => {
  it('oturum yoksa 401 verir ve hiçbir şey yazmaz', async () => {
    taklit.kullanici = null
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi(), sahipTur: 'gecici', sahipId: '0', belgeTuru: 'DIGER' }))
    expect(r.status).toBe(401)
    expect(await prisma.belge.count()).toBe(0)
    expect(await depoDosyalari()).toEqual([])
  })

  it.each([
    ['Origin yok', null],
    ['yabancı Origin', 'http://kotu.example'],
    ['"null" Origin (kum havuzlu çerçeve)', 'null'],
    ['bozuk Origin', 'bu bir url degil'],
  ])('%s: 403 verir', async (_ad, origin) => {
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi(), sahipTur: 'gecici', sahipId: '0', belgeTuru: 'DIGER' }, { origin }))
    expect(r.status).toBe(403)
    expect(await prisma.belge.count()).toBe(0)
  })

  it('geçerli PDF\'i kaydeder: 200 { id }, yükleyen oturumdaki kullanıcıdır, denetim kaydında dosya adı yoktur', async () => {
    const s = await ornekSozlesme()
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi('Ayşe Yılmaz sözleşme.pdf'), sahipTur: 'sozlesme', sahipId: String(s.id), belgeTuru: 'SOZLESME' }))
    expect(r.status).toBe(200)
    const { id } = (await r.json()) as { id: number }
    const b = await prisma.belge.findUniqueOrThrow({ where: { id } })
    expect(b).toMatchObject({ sahipTur: 'sozlesme', sahipId: s.id, belgeTuru: 'SOZLESME', yukleyenId: 1, mime: 'application/pdf', boyut: PDF.byteLength })
    const olay = await prisma.olayGunlugu.findFirstOrThrow({ where: { varlik: 'belge', varlikId: String(id), eylem: 'YUKLE' } })
    expect(JSON.stringify(olay.sonra)).not.toContain('Yılmaz')
  })

  it('geçici belgede sahipId yok sayılır (eksik ya da başkasının kimliği olsa da yükleyene yazılır)', async () => {
    const eksik = await POST(yuklemeIstegi({ dosya: pdfDosyasi(), sahipTur: 'gecici', belgeTuru: 'SOZLESME' }))
    expect(eksik.status).toBe(200)
    const baska = await POST(yuklemeIstegi({ dosya: pdfDosyasi(), sahipTur: 'gecici', sahipId: '2', belgeTuru: 'SOZLESME' }))
    expect(baska.status).toBe(200)
    const satirlar = await prisma.belge.findMany()
    expect(satirlar.map((b) => b.sahipId)).toEqual([1, 1])
  })

  it('PDF olmayan içeriği .pdf adı ve application/pdf türüyle gelse de 422 ile reddeder', async () => {
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi('gizli.pdf', new TextEncoder().encode('MZ\x90\x00 yürütülebilir')), sahipTur: 'gecici', sahipId: '1', belgeTuru: 'DIGER' }))
    expect(r.status).toBe(422)
    expect(await prisma.belge.count()).toBe(0)
    expect(await depoDosyalari()).toEqual([])
  })

  it('boş dosyayı 422 ile reddeder', async () => {
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi('bos.pdf', new Uint8Array(0)), sahipTur: 'gecici', sahipId: '1', belgeTuru: 'DIGER' }))
    expect(r.status).toBe(422)
  })

  it.each([
    ['dosya yok', { sahipTur: 'gecici', sahipId: '1', belgeTuru: 'DIGER' }],
    ['dosya alanı metin', { dosya: 'metin', sahipTur: 'gecici', sahipId: '1', belgeTuru: 'DIGER' }],
    ['bilinmeyen sahipTur', { dosya: pdfDosyasi(), sahipTur: 'yonetici', sahipId: '1', belgeTuru: 'DIGER' }],
    ['bilinmeyen belgeTuru', { dosya: pdfDosyasi(), sahipTur: 'gecici', sahipId: '1', belgeTuru: 'GIZLI' }],
    ['sahipId boş', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '', belgeTuru: 'DIGER' }],
    ['sahipId yok', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', belgeTuru: 'DIGER' }],
    ['sahipId üslü gösterim', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '1e0', belgeTuru: 'DIGER' }],
    ['sahipId onaltılık', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '0x1', belgeTuru: 'DIGER' }],
    ['sahipId sıfır', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '0', belgeTuru: 'DIGER' }],
    ['sahipId negatif', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '-1', belgeTuru: 'DIGER' }],
    ['sahipId INT aralığı dışı', { dosya: pdfDosyasi(), sahipTur: 'sozlesme', sahipId: '2147483648', belgeTuru: 'DIGER' }],
  ])('%s: 400 verir, hiçbir şey yazmaz', async (_ad, alanlar) => {
    const r = await POST(yuklemeIstegi(alanlar))
    expect(r.status).toBe(400)
    expect(await prisma.belge.count()).toBe(0)
    expect(await depoDosyalari()).toEqual([])
  })

  it('bildirilen Content-Length sınırı aşıyorsa gövdeyi okumadan 413 verir', async () => {
    const r = await POST(yuklemeIstegi({ dosya: pdfDosyasi(), sahipTur: 'gecici', sahipId: '1', belgeTuru: 'DIGER' }, { uzunluk: String(BELGE_AZAMI_BAYT + 2 * 1024 * 1024) }))
    expect(r.status).toBe(413)
  })

  it('Content-Length bildirmeyen (parçalı) gövde sınırı aşınca 413 verir', async () => {
    let gonderilen = 0
    const govde = new ReadableStream<Uint8Array>({
      pull(denetci) {
        if (gonderilen > BELGE_AZAMI_BAYT + 4 * 1024 * 1024) return denetci.close()
        gonderilen += 1024 * 1024
        denetci.enqueue(new Uint8Array(1024 * 1024))
      },
    })
    const istek = new NextRequest(new Request(`${KAYNAK}/api/belgeler`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: KAYNAK, 'content-type': 'multipart/form-data; boundary=x' },
      body: govde,
      duplex: 'half',
    } as RequestInit))
    expect(istek.headers.get('content-length')).toBeNull()
    const r = await POST(istek)
    expect(r.status).toBe(413)
    // sınırdan sonra okuma bırakılır: akışın tamamı tüketilmez
    expect(gonderilen).toBeLessThan(BELGE_AZAMI_BAYT + 4 * 1024 * 1024)
    expect(await prisma.belge.count()).toBe(0)
  })

  it('çok parçalı olmayan ya da bozuk gövde 400 verir', async () => {
    const istek = new NextRequest(`${KAYNAK}/api/belgeler`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: KAYNAK, 'content-type': 'multipart/form-data; boundary=x' },
      body: 'bozuk gövde',
    })
    expect((await POST(istek)).status).toBe(400)
  })
})

describe('GET /api/belgeler/:id', () => {
  async function yukle(dosyaAdi = 'a.pdf'): Promise<number> {
    return belgeKaydet({ sahipTur: 'gecici', sahipId: 1, belgeTuru: 'SOZLESME', dosyaAdi, icerik: PDF }, BAGLAM)
  }

  it('oturum yoksa 401 verir ve belge içeriğini sızdırmaz', async () => {
    const id = await yukle()
    taklit.kullanici = null
    const r = await indir(String(id))
    expect(r.status).toBe(401)
    expect(await r.text()).not.toContain('%PDF')
  })

  it('PDF\'i güvenlik başlıklarıyla sunar', async () => {
    const id = await yukle('Ayşe Yılmaz sözleşme.pdf')
    const r = await indir(String(id))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Ay%C5%9Fe%20Y%C4%B1lmaz%20s%C3%B6zle%C5%9Fme.pdf")
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF)
  })

  it('dosya adındaki RFC 5987 özel karakterleri (\' ( ) *) yüzde kodlanır', async () => {
    const id = await yukle("Ali'nin (taslak)*.pdf")
    const r = await indir(String(id))
    expect(r.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''Ali%27nin%20%28taslak%29%2A.pdf")
  })

  it.each(['abc', '', '1e0', '0x1', '+1', '1.0', '-1', '0', ' 1', '1 ', '99999999999', '2147483648'])('geçersiz kimlik %j: 404 verir', async (kimlik) => {
    await yukle()
    const r = await indir(kimlik)
    expect(r.status).toBe(404)
  })

  it('olmayan belge için 404 verir', async () => {
    const id = await yukle()
    expect((await indir(String(id + 1))).status).toBe(404)
  })
})
