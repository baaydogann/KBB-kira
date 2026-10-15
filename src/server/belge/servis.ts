import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { Readable } from 'node:stream'
import type { BelgeTuru } from '@/generated/prisma'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { ortam } from '../env'
import { BulunamadiHatasi, IsKuraliHatasi } from '../hata'

export type { BelgeTuru }
export type SahipTur = 'sozlesme' | 'tasinmaz' | 'kisi' | 'gecici'
export const SAHIP_TURLERI: readonly SahipTur[] = ['sozlesme', 'tasinmaz', 'kisi', 'gecici']
export const BELGE_AZAMI_BAYT = 50 * 1024 * 1024
const PDF_IMZASI = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const SHA256_BICIMI = /^[0-9a-f]{64}$/
// Denetim (C0/C1, satır sonu) ve biçim karakterleri (sağdan sola geçersiz kılma, sıfır genişlik): dosya adı sahteciliği.
// Cs: eşlenmemiş vekil kod birimleri (UTF-8'e çevrilemez; encodeURIComponent ve veritabanı reddeder).
const GORUNMEZ_KARAKTER = /[\p{Cc}\p{Cf}\p{Cs}]/gu
const SAHIP_YOK = 'Belgenin bağlanacağı kayıt bulunamadı.'

const kisalt = (s: string, kodNoktasi: number): string => Array.from(s).slice(0, kodNoktasi).join('')

/** Depo yolu yalnızca sunucunun hesapladığı özetten üretilir; bozuk bir kayıt bile depo dışına çıkamaz. */
function belgeYolu(sha: string): string {
  if (!SHA256_BICIMI.test(sha)) throw new Error('Belge özeti geçersiz.')
  return join(ortam().BELGE_DIZINI, sha.slice(0, 2), `${sha}.pdf`)
}

/** Yükleyenin verdiği ad yalnızca görüntülenir (yola girmez): dizin parçaları ve görünmez karakterler atılır, uzantı .pdf'e sabitlenir. */
function dosyaAdiTemizle(ad: string): string {
  // Kesme kod noktası sınırında yapılır: UTF-16 birimine göre kesmek emoji gibi karakterleri ortadan bölerdi.
  const govde = kisalt(posix.basename(ad.replace(/\\/g, '/')).replace(GORUNMEZ_KARAKTER, '').trim(), 200)
  if (/^\.*$/.test(govde)) return 'belge.pdf'
  return /\.pdf$/i.test(govde) ? govde : `${kisalt(govde, 196)}.pdf`
}

/** Belgenin bağlanacağı kaydın varlığı. Belge tablosunda FK yoktur (çok biçimli sahip); yetim satır sonradan aynı kimliği alan kayda yapışırdı. */
export async function sahipVarMi(db: Tx, tur: SahipTur, id: number): Promise<boolean> {
  switch (tur) {
    case 'gecici':
      return true
    case 'sozlesme':
      return (await db.sozlesme.count({ where: { id } })) > 0
    case 'tasinmaz':
      return (await db.tasinmaz.count({ where: { id } })) > 0
    case 'kisi':
      return (await db.kisi.count({ where: { id } })) > 0
  }
}

const tamDosyaVarMi = (yol: string, boyut: number): Promise<boolean> => stat(yol).then((s) => s.size === boyut, () => false)

/**
 * İçerik adreslidir: aynı özet aynı dosyadır. Yazma önce geçici dosyaya, sonra atomik yeniden adlandırmayla yapılır;
 * böylece çökme ya da eşzamanlı yükleme hedef yolda yarım dosya bırakamaz (yarım dosya aynı içeriği sonsuza dek bozardı).
 */
async function icerikYaz(yol: string, icerik: Uint8Array): Promise<void> {
  if (await tamDosyaVarMi(yol, icerik.byteLength)) return
  // Kişisel veri içeren belgeler yalnızca sunucu hesabına açıktır (Windows bu kipleri yok sayar).
  await mkdir(dirname(yol), { recursive: true, mode: 0o700 })
  const gecici = `${yol}.${randomUUID()}.tmp`
  try {
    await writeFile(gecici, icerik, { flag: 'wx', mode: 0o600 })
    try {
      await rename(gecici, yol)
    } catch (e) {
      // Windows'ta eşzamanlı yeniden adlandırma reddedilebilir; hedef başka bir yükleme tarafından eksiksiz yazıldıysa sorun yok.
      if (!(await tamDosyaVarMi(yol, icerik.byteLength))) throw e
    }
  } finally {
    // Yazma (disk dolu) ya da yeniden adlandırma hatasında da geçici dosya kalmaz.
    await rm(gecici, { force: true })
  }
}

export async function belgeKaydet(
  g: { sahipTur: SahipTur; sahipId: number; belgeTuru: BelgeTuru; dosyaAdi: string; icerik: Uint8Array },
  baglam: { kullaniciId: number; ip: string | null },
): Promise<number> {
  if (g.icerik.byteLength > BELGE_AZAMI_BAYT) throw new IsKuraliHatasi('BOYUT', 'Dosya 50 MB sınırını aşıyor.', 'dosya')
  if (!PDF_IMZASI.every((b, i) => g.icerik[i] === b)) throw new IsKuraliHatasi('TUR', 'Yalnızca PDF dosyası yüklenebilir.', 'dosya')
  const sahipId = g.sahipTur === 'gecici' ? baglam.kullaniciId : g.sahipId
  // Sahip, dosya depoya yazılmadan önce doğrulanır: reddedilen yükleme yetim dosya bırakmaz.
  if (!(await sahipVarMi(prisma, g.sahipTur, sahipId))) throw new IsKuraliHatasi('SAHIP', SAHIP_YOK, 'sahipId')
  const sha = createHash('sha256').update(g.icerik).digest('hex')
  await icerikYaz(belgeYolu(sha), g.icerik)
  return prisma.$transaction(async (tx) => {
    const b = await tx.belge.create({
      data: { sahipTur: g.sahipTur, sahipId, belgeTuru: g.belgeTuru, dosyaAdi: dosyaAdiTemizle(g.dosyaAdi), sha256: sha, boyut: g.icerik.byteLength, mime: 'application/pdf', yukleyenId: baglam.kullaniciId },
    })
    // Denetim kaydında dosya adı yok: ad kişi adı içerebilir (KVKK).
    await denetimKaydi(tx, baglam, { varlik: 'belge', varlikId: b.id, eylem: 'YUKLE', sonra: { sahipTur: g.sahipTur, sahipId, belgeTuru: g.belgeTuru, sha256: sha } })
    return b.id
  })
}

export async function belgeOku(id: number) {
  const belge = await prisma.belge.findUnique({ where: { id } })
  if (!belge) throw new BulunamadiHatasi('Belge bulunamadı.')
  return { belge, icerik: await readFile(belgeYolu(belge.sha256)) }
}

/** Kayıt var ama depo dosyası yok/bozuk. İstemciye ham hata ya da yol verilmez; `kod` günlük içindir (errno kodu, yol değil). */
export class BelgeDosyasiHatasi extends Error {
  readonly kod: string
  constructor(public readonly belgeId: number, neden: unknown) {
    super(`Belge dosyası okunamadı (belgeId=${belgeId}).`, { cause: neden })
    this.name = 'BelgeDosyasiHatasi'
    const errno = (neden as NodeJS.ErrnoException | null)?.code
    this.kod = typeof errno === 'string' ? errno : 'GECERSIZ_DOSYA'
  }
}

async function depoDosyasiniAc(belge: { id: number; sha256: string; boyut: number }): Promise<FileHandle> {
  let dosya: FileHandle | undefined
  try {
    dosya = await open(belgeYolu(belge.sha256), 'r')
    if ((await dosya.stat()).size !== belge.boyut) throw new Error('Depo dosyasının boyutu kayıtla uyuşmuyor.')
    return dosya
  } catch (e) {
    await dosya?.close().catch(() => undefined)
    throw new BelgeDosyasiHatasi(belge.id, e)
  }
}

/**
 * İndirme: dosya belleğe alınmadan akış olarak sunulur. Dosya, yanıt başlamadan açılıp boyutu kayıtla doğrulanır;
 * böylece eksik/kısalmış dosya akış ortasında değil, temiz bir hata olarak görünür. Başarılı her açılış için
 * (kişisel veri içeren belgenin dışa aktarımı) yalnızca kimlikle INDIR denetimi yazılır.
 */
export async function belgeAkisiAc(id: number, baglam: IslemBaglami) {
  const belge = await prisma.belge.findUnique({ where: { id } })
  if (!belge) throw new BulunamadiHatasi('Belge bulunamadı.')
  const dosya = await depoDosyasiniAc(belge)
  const akis = Readable.toWeb(dosya.createReadStream()) as unknown as ReadableStream<Uint8Array>
  try {
    await denetimKaydi(prisma, baglam, { varlik: 'belge', varlikId: belge.id, eylem: 'INDIR' })
  } catch (e) {
    await akis.cancel() // akış hiç okunmayacak: dosya tanıtıcısını bırak
    throw e
  }
  return { belge, akis }
}

const BAGLANAMADI = 'Belge bağlanamadı: yalnızca kendi yüklediğiniz geçici belge bağlanabilir.'

export async function belgeyiBagla(db: Tx, belgeId: number, sahipTur: Exclude<SahipTur, 'gecici'>, sahipId: number, baglam: IslemBaglami): Promise<void> {
  if (baglam.kullaniciId === null) throw new IsKuraliHatasi('BELGE', BAGLANAMADI)
  if (!(await sahipVarMi(db, sahipTur, sahipId))) throw new IsKuraliHatasi('SAHIP', SAHIP_YOK, 'sahipId')
  // Sahiplik ve "hâlâ geçici" koşulu güncellemenin kendisinde sınanır (oku-sonra-yaz yarışı yok): aynı belgeyi
  // eşzamanlı bağlayan ikinci çağrı satır kilidini bekler, koşulu yeniden değerlendirir ve 0 satır bulur.
  const { count } = await db.belge.updateMany({
    where: { id: belgeId, sahipTur: 'gecici', sahipId: baglam.kullaniciId },
    data: { sahipTur, sahipId },
  })
  if (count !== 1) throw new IsKuraliHatasi('BELGE', BAGLANAMADI)
  await denetimKaydi(db, baglam, { varlik: 'belge', varlikId: belgeId, eylem: 'BAGLA', sonra: { sahipTur, sahipId } })
}

export async function belgeListesi(sahipTur: SahipTur, sahipId: number) {
  return prisma.belge.findMany({ where: { sahipTur, sahipId }, orderBy: { olusturmaZamani: 'desc' } })
}

export async function sozlesmePdfVarMi(sozlesmeId: number, db: Tx = prisma): Promise<boolean> {
  return (await db.belge.count({ where: { sahipTur: 'sozlesme', sahipId: sozlesmeId, belgeTuru: 'SOZLESME' } })) > 0
}
