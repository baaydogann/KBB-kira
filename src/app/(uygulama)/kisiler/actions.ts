'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import { IsKuraliHatasi } from '@/server/hata'
import { kisiAramaHedefi } from '@/server/kisi/arama'
import { kisiSemasi, vergiStatusuSemasi } from '@/server/kisi/sema'
import { ibanAktiflik, ibanEkle, kisiKaydet, kisiKimlikIleBul, statuTeyitEt } from '@/server/kisi/servis'
import { borcSorguSemasi, hacizSemasi } from '@/server/kesinti/sema'
import { borcSorguEkle, borcSorguSil, hacizEkle, hacizKapat } from '@/server/kesinti/servis'
import { eylemSonrasiHatirlatmalariTazele } from '@/server/isler/hatirlatma-uret'
import { basariDurumu, formKimligi, formMetni, formSecim, formSurum, hataDurumu, uyariIle, type FormDurumu } from '@/app/_lib/form'

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

function kisiKimligi(f: FormData): number {
  const kisiId = formKimligi(f, 'kisiId')
  if (kisiId === null) throw new IsKuraliHatasi('ID', 'Kişi kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
  return kisiId
}

/** 22/A borç sorgusu: belge (borç yazısı) önceden yüklenip kimliği gizli alanla gelir. Hatırlatmalar (H3) hemen tazelenir. */
export async function borcSorguEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let kisiId: number
  try {
    kisiId = kisiKimligi(f)
    const g = borcSorguSemasi.parse({
      kisiId, sorguTarihi: formMetni(f, 'sorguTarihi'), borcVar: formSecim(f, 'borcVar'), borcTutari: formMetni(f, 'borcTutari') || null,
      vergiDairesi: formMetni(f, 'vergiDairesi') || null, belgeNo: formMetni(f, 'belgeNo') || null, belgeId: formKimligi(f, 'belgeId'),
    })
    await borcSorguEkle(g, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath(`/kisiler/${kisiId}`)
  return uyariIle(basariDurumu('Borç sorgusu kaydedildi.'), await eylemSonrasiHatirlatmalariTazele())
}

export async function borcSorguSilAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let kisiId: number
  try {
    kisiId = kisiKimligi(f)
    const id = formKimligi(f, 'id')
    if (id === null) throw new IsKuraliHatasi('ID', 'Sorgu kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    await borcSorguSil(id, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e)
  }
  revalidatePath(`/kisiler/${kisiId}`)
  return uyariIle(basariDurumu('Borç sorgusu silindi.'), await eylemSonrasiHatirlatmalariTazele())
}

export async function hacizEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let kisiId: number
  try {
    kisiId = kisiKimligi(f)
    const g = hacizSemasi.parse({
      kisiId, alacakli: formMetni(f, 'alacakli'), dosyaNo: formMetni(f, 'dosyaNo'), tebligTarihi: formMetni(f, 'tebligTarihi'), toplamTutar: formMetni(f, 'toplamTutar'),
    })
    await hacizEkle(g, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath(`/kisiler/${kisiId}`)
  return basariDurumu('Haciz kaydedildi.')
}

export async function hacizKapatAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let kisiId: number
  try {
    kisiId = kisiKimligi(f)
    const id = formKimligi(f, 'id')
    const version = formSurum(f)
    if (id === null || version === undefined) throw new IsKuraliHatasi('ID', 'Haciz kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
    await hacizKapat(id, version, formMetni(f, 'neden'), await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath(`/kisiler/${kisiId}`)
  return basariDurumu('Haciz kapatıldı.')
}
