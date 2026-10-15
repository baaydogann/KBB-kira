'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { kisiSemasi } from '@/server/kisi/sema'
import { ibanAktiflik, ibanEkle, kisiKaydet, statuTeyitEt } from '@/server/kisi/servis'
import { basariDurumu, formMetni, formSayi, formSurum, hataDurumu, type FormDurumu } from '@/app/_lib/form'

export async function kisiKaydetAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const g = kisiSemasi.parse(Object.fromEntries(f))
    const mevcutId = formSayi(f, 'id') ?? undefined
    // Dolu ama bozuk bir kimlik "yeni kayıt" gibi işlenmez.
    if (mevcutId === undefined && formMetni(f, 'id') !== '') throw new IsKuraliHatasi('ID', 'Kayıt kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    id = await kisiKaydet(g, await islemBaglami(k), mevcutId, formSurum(f))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/kisiler')
  redirect(`/kisiler/${id}`)
}

export async function ibanEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const kisiId = formSayi(f, 'kisiId')
  if (kisiId === null) return { hata: 'Kişi seçilmedi.', alanHatalari: {}, tamam: false }
  try {
    await ibanEkle(kisiId, { iban: formMetni(f, 'iban'), bankaAdi: formMetni(f, 'bankaAdi') || null }, await islemBaglami(k))
    revalidatePath(`/kisiler/${kisiId}`)
    return basariDurumu('IBAN eklendi.')
  } catch (e) {
    return hataDurumu(e, f)
  }
}

export async function ibanAktiflikAction(f: FormData): Promise<void> {
  const k = await kullaniciGerekli()
  const id = formSayi(f, 'ibanId')
  const kisiId = formSayi(f, 'kisiId')
  if (id === null || kisiId === null) return
  await ibanAktiflik(id, f.get('aktif') === 'true', await islemBaglami(k))
  revalidatePath(`/kisiler/${kisiId}`)
}

export async function statuTeyitAction(f: FormData): Promise<void> {
  const k = await kullaniciGerekli()
  const id = formSayi(f, 'kisiId')
  if (id === null) return
  await statuTeyitEt(id, f.get('teyitli') === 'true', await islemBaglami(k))
  revalidatePath(`/kisiler/${id}`)
}
