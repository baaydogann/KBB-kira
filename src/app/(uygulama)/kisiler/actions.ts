'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { kisiAramaHedefi } from '@/server/kisi/arama'
import { kisiSemasi, vergiStatusuSemasi } from '@/server/kisi/sema'
import { ibanAktiflik, ibanEkle, kisiKaydet, kisiKimlikIleBul, statuTeyitEt } from '@/server/kisi/servis'
import { basariDurumu, formKimligi, formMetni, formSurum, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function kisiKaydetAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const g = kisiSemasi.parse(Object.fromEntries(f))
    const mevcutId = formKimligi(f, 'id') ?? undefined
    // Dolu ama bozuk bir kimlik "yeni kayıt" gibi işlenmez.
    if (mevcutId === undefined && formMetni(f, 'id') !== '') throw new IsKuraliHatasi('ID', 'Kayıt kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    id = await kisiKaydet(g, await islemBaglami(k), mevcutId, formSurum(f))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/kisiler')
  redirect(`/kisiler/${id}`)
}

/**
 * Kişi arama kutusu (POST): TCKN/VKN adres satırına yazılmasın diye kimlik numarası aramaları burada çözülür;
 * ad/unvan aramaları GET sorgusuna (`?q=`) yönlenir.
 */
export async function kisiAraAction(f: FormData): Promise<void> {
  await kullaniciGerekli()
  redirect(await kisiAramaHedefi(formMetni(f, 'q'), kisiKimlikIleBul))
}

export async function ibanEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const kisiId = formKimligi(f, 'kisiId')
  if (kisiId === null) return { hata: 'Kişi seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    await ibanEkle(kisiId, { iban: formMetni(f, 'iban'), bankaAdi: formMetni(f, 'bankaAdi') || null }, await islemBaglami(k))
    revalidatePath(`/kisiler/${kisiId}`)
    return basariDurumu('IBAN eklendi.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}

export async function ibanAktiflikAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'ibanId')
  const kisiId = formKimligi(f, 'kisiId')
  if (id === null || kisiId === null) return { hata: 'IBAN seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    await ibanAktiflik(id, f.get('aktif') === 'true', await islemBaglami(k))
    revalidatePath(`/kisiler/${kisiId}`)
    return basariDurumu('IBAN durumu güncellendi.')
  } catch (e) {
    return hataDurumu(e)
  }
}

/** Teyit, formda görülen sürüm ve statü üzerine verilir (`statuTeyitEt` arada değişen kaydı reddeder). */
export async function statuTeyitAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'kisiId')
  if (id === null) return { hata: 'Kişi seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    const version = formSurum(f)
    if (version === undefined) throw new IsKuraliHatasi('VERSION', 'Form sürümü eksik; sayfayı yenileyip tekrar deneyin.')
    const vergiStatusu = vergiStatusuSemasi.parse(formMetni(f, 'vergiStatusu'))
    await statuTeyitEt(id, f.get('teyitli') === 'true', { version, vergiStatusu }, await islemBaglami(k))
    revalidatePath(`/kisiler/${id}`)
    return basariDurumu('Statü teyidi güncellendi.')
  } catch (e) {
    return hataDurumu(e)
  }
}
