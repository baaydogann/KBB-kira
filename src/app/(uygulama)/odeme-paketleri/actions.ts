'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import type { IslemBaglami } from '@/server/baglam'
import { IsKuraliHatasi } from '@/server/hata'
import { eylemSonrasiHatirlatmalariTazele } from '@/server/isler/hatirlatma-uret'
import { faturaGirdisiSemasi, paketGirdisiSemasi } from '@/server/paket/sema'
import { paketFaturasiKaydet, paketOlustur, paketTaksitiBol, paketeTaksitEkle, pakettenTaksitCikar } from '@/server/paket/servis'
import { basariDurumu, formKimligi, formMetni, formSurum, hataDurumu, uyariIle, yolKimligi, type FormDurumu } from '@/app/_lib/form'

export async function paketOlusturAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const g = paketGirdisiSemasi.parse({
      birimId: formKimligi(f, 'birimId'), ad: formMetni(f, 'ad'), vadeBaslangic: formMetni(f, 'vadeBaslangic'), vadeBitis: formMetni(f, 'vadeBitis'),
      kalanOdenek: formMetni(f, 'kalanOdenek') || null,
    })
    id = await paketOlustur(g, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath('/odeme-paketleri')
  redirect(`/odeme-paketleri/${id}`)
}

function paketKimligi(f: FormData): { id: number; version: number } {
  const id = formKimligi(f, 'paketId')
  const version = formSurum(f)
  if (id === null || version === undefined) throw new IsKuraliHatasi('ID', 'Paket kimliği geçersiz; sayfayı yenileyip tekrar deneyin.')
  return { id, version }
}

/** Paket düzenleme eylemlerinin ortak gövdesi; hatırlatmalar (H2/H3) ve önbellek tazelenir. */
async function paketEylemi(f: FormData, basari: string, calistir: (id: number, version: number, baglam: IslemBaglami) => Promise<void>): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  try {
    const kim = paketKimligi(f)
    id = kim.id
    await calistir(kim.id, kim.version, await islemBaglami(k))
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath(`/odeme-paketleri/${id}`)
  revalidatePath('/odeme-paketleri')
  return uyariIle(basariDurumu(basari), await eylemSonrasiHatirlatmalariTazele())
}

export async function paketTaksitEkleAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Taksitler eklendi.', async (id, version, baglam) => {
    const taksitIdleri = f.getAll('taksitId').map((v) => (typeof v === 'string' ? yolKimligi(v) : null))
    if (taksitIdleri.some((x) => x === null)) throw new IsKuraliHatasi('SECIM', 'Taksit seçimi geçersiz; sayfayı yenileyin.')
    await paketeTaksitEkle(id, version, taksitIdleri as number[], baglam)
  })
}

function taksitKimligi(f: FormData): number {
  const taksitId = formKimligi(f, 'taksitId')
  if (taksitId === null) throw new IsKuraliHatasi('ID', 'Taksit kimliği geçersiz; sayfayı yenileyin.')
  return taksitId
}

export async function pakettenTaksitCikarAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Taksit paketten çıkarıldı.', (id, version, baglam) => pakettenTaksitCikar(id, version, taksitKimligi(f), baglam))
}

export async function paketTaksitBolAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Bölme tercihi kaydedildi.', (id, version, baglam) => paketTaksitiBol(id, version, taksitKimligi(f), f.get('bolunsun') === 'true', baglam))
}

export async function paketFaturaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Fatura kaydedildi.', async (id, version, baglam) => {
    const g = faturaGirdisiSemasi.parse({
      taksitId: formKimligi(f, 'taksitId'), kisiId: formKimligi(f, 'kisiId'), faturaNo: formMetni(f, 'faturaNo'), faturaTarihi: formMetni(f, 'faturaTarihi'),
    })
    await paketFaturasiKaydet(id, version, g, baglam)
  })
}
