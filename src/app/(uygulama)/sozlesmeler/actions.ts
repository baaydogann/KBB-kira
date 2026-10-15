'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { tarihAyristir, type Tarih } from '@/core/tarih'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import type { IslemBaglami } from '@/server/baglam'
import { belgeyiBagla } from '@/server/belge/servis'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { malikGirdisiSemasi, sozlesmeGirdisiSemasi } from '@/server/sozlesme/sema'
import { sozlesmeAktiflestir, sozlesmeOnizle, sozlesmeTaslakKaydet, type OnizlemeCiktisi } from '@/server/sozlesme/servis'
import { belirsizSureliyeCevir, malikleriDegistir, sozlesmeFeshet, sozlesmeSonlandir, sozlesmeYenile, taslakSil } from '@/server/sozlesme/yasam-dongusu'
import { basariDurumu, formKimligi, formMetni, formSurum, hataDurumu, type FormDurumu } from '@/app/_lib/form'

// İstemci bileşenlerinden gelen kimlikler FormData değil argümandır; yine de güvenilmez girdidir: PostgreSQL INTEGER aralığında doğrulanır.
const kimlikSemasi = z.number().int().min(1).max(2_147_483_647)
const surumSemasi = z.number().int().min(0).max(2_147_483_647)

/**
 * `belgeHatasi` doluysa taslak KAYDEDİLDİ ama PDF bağlanamadı: iki işlem ayrıdır (kayıt geri alınmaz, belge geçici kalır).
 * `version` kaydın yeni sürümüdür; sihirbaz yeniden kaydetmede kopya taslak açmasın diye `id`/`version`ı bununla ilerletir.
 */
export type KaydetSonucu =
  | { ok: true; id: number; version: number; belgeHatasi: string | null }
  | ({ ok: false } & FormDurumu)

/** Kayıt sonrası belge bağlama hatasının kullanıcıya gidecek metni; kayıt değişmiş olduğundan genel "kayıt değişmedi" iletisi kullanılmaz. */
function belgeBaglamaHatasi(e: unknown): string {
  unstable_rethrow(e)
  if (e instanceof IsKuraliHatasi) return e.message
  console.error(e)
  return 'Beklenmeyen bir hata oluştu.'
}

export async function sozlesmeKaydetAction(veri: unknown, id: number | null, version: number | null, belgeId: number | null): Promise<KaydetSonucu> {
  const k = await kullaniciGerekli()
  const baglam = await islemBaglami(k)
  let kayitId: number
  let yeniSurum: number
  let bagliBelge: number | null
  try {
    const mevcutId = kimlikSemasi.nullable().parse(id)
    const mevcutSurum = surumSemasi.nullable().parse(version)
    bagliBelge = kimlikSemasi.nullable().parse(belgeId)
    const g = sozlesmeGirdisiSemasi.parse(veri)
    kayitId = await sozlesmeTaslakKaydet(g, baglam, mevcutId ?? undefined, mevcutSurum ?? undefined)
    yeniSurum = mevcutId === null ? 0 : (mevcutSurum ?? 0) + 1
  } catch (e) {
    return { ok: false, ...hataDurumu(e) }
  }
  // Taslak kaydı ve belge bağlama ayrı işlemlerdir: bağlama başarısızsa taslak yine de kayıtlıdır, hata kullanıcıya iletilir.
  const belgeHatasi = bagliBelge === null ? null : await belgeyiBaglaSonuc(bagliBelge, kayitId, baglam)
  revalidatePath('/sozlesmeler')
  return { ok: true, id: kayitId, version: yeniSurum, belgeHatasi }
}

async function belgeyiBaglaSonuc(belgeId: number, sozlesmeId: number, baglam: IslemBaglami): Promise<string | null> {
  try {
    await prisma.$transaction((tx) => belgeyiBagla(tx, belgeId, 'sozlesme', sozlesmeId, baglam))
    return null
  } catch (e) {
    return belgeBaglamaHatasi(e)
  }
}

export type OnizleSonucu =
  | Extract<OnizlemeCiktisi, { ok: true }>
  | { ok: false; mesaj: string; alanHatalari: Record<string, string> }

export async function onizleAction(veri: unknown): Promise<OnizleSonucu> {
  await kullaniciGerekli()
  try {
    const sonuc = await sozlesmeOnizle(sozlesmeGirdisiSemasi.parse(veri))
    return sonuc.ok ? sonuc : { ok: false, mesaj: sonuc.mesaj, alanHatalari: {} }
  } catch (e) {
    const d = hataDurumu(e)
    return { ok: false, mesaj: d.hata ?? 'Önizleme hesaplanamadı.', alanHatalari: d.alanHatalari }
  }
}

function kimlik(f: FormData): { id: number; version: number } {
  const id = formKimligi(f, 'id')
  if (id === null) throw new IsKuraliHatasi('ID', 'Sözleşme kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
  const version = formSurum(f)
  if (version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
  return { id, version }
}

function yenile(id: number) {
  revalidatePath(`/sozlesmeler/${id}`)
  revalidatePath('/sozlesmeler')
}

/** Sürüm koşullu yaşam döngüsü eylemlerinin ortak gövdesi: oturum, kimlik/sürüm, hata dönüşümü, önbellek tazeleme. */
async function surumluEylem(
  f: FormData, basari: string, calistir: (id: number, version: number, baglam: IslemBaglami) => Promise<void>,
): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const kim = kimlik(f)
    id = kim.id
    await calistir(kim.id, kim.version, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  yenile(id)
  return basariDurumu(basari)
}

export async function aktiflestirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return surumluEylem(f, 'Sözleşme aktifleştirildi; taksit planı oluşturuldu.', (id, version, baglam) => sozlesmeAktiflestir(id, version, baglam))
}

function formTarihi(f: FormData, ad: string): Tarih {
  const t = tarihAyristir(formMetni(f, ad))
  if (!t.ok) throw new IsKuraliHatasi('TARIH', t.hata.mesaj, ad)
  return t.deger
}

export async function feshetAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return surumluEylem(f, 'Fesih kaydedildi; sonraki planlı taksitler iptal edildi.', (id, version, baglam) =>
    sozlesmeFeshet(id, version, { tarih: formTarihi(f, 'tarih'), neden: formMetni(f, 'neden') }, baglam))
}

export async function yenileAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let yeniId: number
  let eskiId: number
  try {
    const id = formKimligi(f, 'id')
    if (id === null) throw new IsKuraliHatasi('ID', 'Sözleşme kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    eskiId = id
    yeniId = await sozlesmeYenile(id, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e)
  }
  yenile(eskiId)
  redirect(`/sozlesmeler/${yeniId}/duzenle`)
}

export async function sonlandirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return surumluEylem(f, 'Sözleşme sona erdi olarak kapatıldı.', (id, version, baglam) => sozlesmeSonlandir(id, version, baglam))
}

export async function belirsizAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return surumluEylem(f, 'Sözleşme belirsiz süreliye çevrildi; taksit planı uzatıldı.', (id, version, baglam) => belirsizSureliyeCevir(id, version, baglam))
}

export async function taslakSilAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  try {
    const { id, version } = kimlik(f)
    await taslakSil(id, version, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e)
  }
  revalidatePath('/sozlesmeler')
  redirect('/sozlesmeler')
}

const malikDegistirSemasi = z.object({
  id: kimlikSemasi,
  version: surumSemasi,
  tarih: z.string(),
  malikler: z.array(malikGirdisiSemasi).min(1, 'En az bir malik ekleyin.'),
})

export async function malikDegistirAction(veri: unknown): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const g = malikDegistirSemasi.parse(veri)
    id = g.id
    const tarih = tarihAyristir(g.tarih)
    if (!tarih.ok) throw new IsKuraliHatasi('TARIH', tarih.hata.mesaj, 'tarih')
    await malikleriDegistir(g.id, g.version, { tarih: tarih.deger, malikler: g.malikler }, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e)
  }
  yenile(id)
  return basariDurumu('Malik değişikliği kaydedildi.')
}
