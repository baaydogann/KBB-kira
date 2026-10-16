'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { oranAyristir, paraAyristir } from '@/core/para'
import { bugunIstanbul, tarihAyristir, type Tarih } from '@/core/tarih'
import { artisElleOranGir, artisOnayla, artislariHesapla, kiraBedeliDegistir } from '@/server/artis/servis'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import type { IslemBaglami } from '@/server/baglam'
import { prisma } from '@/server/db'
import { IsKuraliHatasi } from '@/server/hata'
import { eylemSonrasiHatirlatmalariTazele } from '@/server/isler/hatirlatma-uret'
import { sozlesmeAramaHedefi } from '@/server/sozlesme/arama'
import { kayitSonrasiHataMi, taslakKaydetVeBagla } from '@/server/sozlesme/kaydet'
import { malikGirdisiSemasi, sozlesmeGirdisiSemasi } from '@/server/sozlesme/sema'
import { sozlesmeAktiflestir, sozlesmeOnizle, type OnizlemeCiktisi } from '@/server/sozlesme/servis'
import { belirsizSureliyeCevir, malikleriDegistir, sozlesmeFeshet, sozlesmeSonlandir, sozlesmeYenile, taslakSil } from '@/server/sozlesme/yasam-dongusu'
import { basariDurumu, formDegerleri, formKimligi, formMetni, formSurum, hataDurumu, uyariIle, type FormDurumu } from '@/app/_lib/form'

// İstemci bileşenlerinden gelen kimlikler FormData değil argümandır; yine de güvenilmez girdidir: PostgreSQL INTEGER aralığında doğrulanır.
const kimlikSemasi = z.number().int().min(1).max(2_147_483_647)
const surumSemasi = z.number().int().min(0).max(2_147_483_647)

const KAYIT_SONRASI_BELGE_HATASI = 'Kayıt kaydedildi ancak belge bağlanırken beklenmeyen bir hata oluştu; sayfayı yenileyin.'

/**
 * `belgeHatasi` doluysa taslak KAYDEDİLDİ ama PDF bağlanamadı (iki ayrı işlem; bkz. `taslakKaydetVeBagla`).
 * `version` kaydedilmiş satırdan okunur; sihirbaz yeniden kaydetmede kopya taslak açmasın diye `id`/`version`ı bununla ilerletir.
 */
export type KaydetSonucu =
  | { ok: true; id: number; version: number; belgeHatasi: string | null }
  | ({ ok: false } & FormDurumu)

export async function sozlesmeKaydetAction(veri: unknown, id: number | null, version: number | null, belgeId: number | null): Promise<KaydetSonucu> {
  const k = await kullaniciGerekli()
  const baglam = await islemBaglami(k)
  let sonuc: { id: number; version: number; belgeHatasi: string | null }
  try {
    const mevcutId = kimlikSemasi.nullable().parse(id)
    const mevcutSurum = surumSemasi.nullable().parse(version)
    const bagliBelge = kimlikSemasi.nullable().parse(belgeId)
    const g = sozlesmeGirdisiSemasi.parse(veri)
    sonuc = await taslakKaydetVeBagla(g, baglam, mevcutId ?? undefined, mevcutSurum ?? undefined, bagliBelge)
  } catch (e) {
    const durum = hataDurumu(e)
    // Taslak kaydedildikten sonra belge bağlama beklenmedik biçimde patladıysa genel "kayıt değişmedi" iletisi yanlış olurdu.
    return { ok: false, ...(kayitSonrasiHataMi(e) ? { ...durum, hata: KAYIT_SONRASI_BELGE_HATASI } : durum) }
  }
  revalidatePath('/sozlesmeler')
  return { ok: true, ...sonuc }
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

/**
 * Liste arama kutusu (POST): kimlik numarası/IBAN benzeri girdi adres satırına yazılmasın diye burada çözülür;
 * redirect hedefine hiçbir zaman yazılmaz (bkz. `sozlesmeAramaHedefi`).
 */
export async function sozlesmeAraAction(f: FormData): Promise<void> {
  await kullaniciGerekli()
  redirect(sozlesmeAramaHedefi(formMetni(f, 'q'), formMetni(f, 'durum')))
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

/**
 * Sözleşme, artış ya da bedel durumunu değiştiren eylem kalıcı olduktan sonra hatırlatmalar ayrı bir işlemde hemen yenilenir (en iyi
 * çaba): hata eylemi geri almaz, engellemeyen uyarı olarak döner (bkz. `eylemSonrasiHatirlatmalariTazele`).
 */
async function basariVeTazele(mesaj: string): Promise<FormDurumu> {
  return uyariIle(basariDurumu(mesaj), await eylemSonrasiHatirlatmalariTazele())
}

/** Sürüm koşullu yaşam döngüsü eylemlerinin ortak gövdesi: oturum, kimlik/sürüm, hata dönüşümü, hatırlatma ve önbellek tazeleme. */
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
  const durum = await basariVeTazele(basari)
  yenile(id)
  return durum
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
  // Yönlendirmede uyarı kanalı yok: tazeleme hatası yalnızca günlüğe yazılır.
  await eylemSonrasiHatirlatmalariTazele()
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
  await eylemSonrasiHatirlatmalariTazele()
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
  const durum = await basariVeTazele('Malik değişikliği kaydedildi.')
  yenile(id)
  return durum
}

const alanHatasi = (f: FormData, alan: string, mesaj: string): FormDurumu =>
  ({ hata: mesaj, alanHatalari: { [alan]: mesaj }, tamam: false, degerler: formDegerleri(f) })

export async function artisOnaylaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let sozlesmeId: number | null
  try {
    const { id, version } = kimlik(f)
    // Sözleşme kimliği yalnızca önbellek tazelemek içindir; bozuksa atlanır.
    sozlesmeId = formKimligi(f, 'sozlesmeId')
    await artisOnayla(id, version, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  const durum = await basariVeTazele('Artış onaylandı; yeni kira dönemi açıldı ve planlı taksitler yeniden hesaplandı.')
  if (sozlesmeId !== null) yenile(sozlesmeId)
  return durum
}

export async function artisElleOranAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const oran = oranAyristir(formMetni(f, 'oran'))
  if (!oran.ok) return alanHatasi(f, 'oran', oran.hata.mesaj)
  let sozlesmeId: number | null
  try {
    const { id, version } = kimlik(f)
    sozlesmeId = formKimligi(f, 'sozlesmeId')
    await artisElleOranGir(id, version, { oran: oran.deger, gerekce: formMetni(f, 'gerekce') }, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  const durum = await basariVeTazele('Oran kaydedildi ve artış hesaplandı.')
  if (sozlesmeId !== null) yenile(sozlesmeId)
  return durum
}

export async function artislariSimdiHesaplaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'id')
  if (id === null) return { hata: 'Sözleşme seçilmedi.', alanHatalari: {}, tamam: false, degerler: formDegerleri(f) }
  let r: Awaited<ReturnType<typeof artislariHesapla>>
  try {
    const baglam = await islemBaglami(k)
    r = await prisma.$transaction((tx) => artislariHesapla(tx, bugunIstanbul(), id, baglam), { timeout: 60_000 })
  } catch (e) {
    return hataDurumu(e, f)
  }
  const durum = await basariVeTazele(r.hesaplanan + r.bekleyen === 0
    ? 'Hesaplanacak artış yok (sıradaki artış tarihi ufuk dışında veya onay bekliyor).'
    : `Hesaplandı: ${r.hesaplanan}, endeks bekleyen: ${r.bekleyen}.`)
  yenile(id)
  return durum
}

const BEDEL_KAYNAKLARI = ['TESPIT', 'ANLASMA', 'ELLE'] as const
const bedelKaynagiMi = (x: string): x is (typeof BEDEL_KAYNAKLARI)[number] => (BEDEL_KAYNAKLARI as readonly string[]).includes(x)

export async function kiraBedeliDegistirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const tarih = tarihAyristir(formMetni(f, 'baslangic'))
  if (!tarih.ok) return alanHatasi(f, 'baslangic', tarih.hata.mesaj)
  const bedel = paraAyristir(formMetni(f, 'bedel'))
  if (!bedel.ok) return alanHatasi(f, 'bedel', bedel.hata.mesaj)
  const kaynak = formMetni(f, 'kaynak')
  if (!bedelKaynagiMi(kaynak)) return alanHatasi(f, 'kaynak', 'Geçerli bir kaynak seçin.')
  let sozlesmeId: number
  try {
    const { id, version } = kimlik(f)
    sozlesmeId = id
    await kiraBedeliDegistir(id, version, { baslangic: tarih.deger, bedel: bedel.deger, kaynak, aciklama: formMetni(f, 'aciklama') }, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  const durum = await basariVeTazele('Kira bedeli değişikliği kaydedildi.')
  yenile(sozlesmeId)
  return durum
}
