'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import type { IslemBaglami } from '@/server/baglam'
import { IsKuraliHatasi } from '@/server/hata'
import { eylemSonrasiHatirlatmalariTazele } from '@/server/isler/hatirlatma-uret'
import { bugunIstanbul, tarihAyristir, type Tarih } from '@/core/tarih'
import { paketIptal, paketKesinlestir, paketOdemeEmriGir, paketOdemeGeriAl, paketOdendi } from '@/server/paket/durum'
import { paketHesapla } from '@/server/paket/hesapla'
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

/** Paket eylemlerinin ortak gövdesi; servisin döndürdüğü uyarılar gösterilir, hatırlatmalar (H1/H2/H3) ve önbellek tazelenir. */
async function paketEylemi(
  f: FormData, basari: string, calistir: (id: number, version: number, baglam: IslemBaglami) => Promise<string[] | void>,
): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  let id: number
  let uyarilar: string[] = []
  try {
    const kim = paketKimligi(f)
    id = kim.id
    uyarilar = (await calistir(kim.id, kim.version, await islemBaglami(k))) ?? []
  } catch (e) {
    return hataDurumu(e, f)
  }
  revalidatePath(`/odeme-paketleri/${id}`)
  revalidatePath('/odeme-paketleri')
  return uyariIle(basariDurumu(basari), ...uyarilar, await eylemSonrasiHatirlatmalariTazele())
}

function formTarihi(f: FormData, ad: string): Tarih {
  const t = tarihAyristir(formMetni(f, ad))
  if (!t.ok) throw new IsKuraliHatasi('TARIH', t.hata.mesaj, ad)
  return t.deger
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

/** Hesap tarihi bugündür (tahakkuk); kesinleştirme aynı gün yapılmalıdır. */
export async function paketHesaplaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Paket hesaplandı.', async (id, version, baglam) => {
    await paketHesapla(id, version, baglam, bugunIstanbul())
  })
}

export async function paketFaturaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Fatura kaydedildi.', async (id, version, baglam) => {
    const g = faturaGirdisiSemasi.parse({
      taksitId: formKimligi(f, 'taksitId'), kisiId: formKimligi(f, 'kisiId'), faturaNo: formMetni(f, 'faturaNo'), faturaTarihi: formMetni(f, 'faturaTarihi'),
    })
    await paketFaturasiKaydet(id, version, g, baglam)
  })
}

/** Kesinleştirme hesapla ile aynı gün yapılır; dayanılan veri değiştiyse servis yeniden hesap ister. */
export async function paketKesinlestirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Paket kesinleştirildi.', (id, version, baglam) => paketKesinlestir(id, version, baglam, bugunIstanbul()))
}

export async function paketOdemeEmriAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Ödeme emri kaydedildi.', (id, version, baglam) =>
    paketOdemeEmriGir(id, version, { no: formMetni(f, 'no'), tarih: formTarihi(f, 'tarih') }, baglam, bugunIstanbul()))
}

export async function paketOdendiAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Paket ödendi olarak işaretlendi.', (id, version, baglam) => paketOdendi(id, version, formTarihi(f, 'odemeTarihi'), baglam, bugunIstanbul()))
}

export async function paketIptalAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Paket iptal edildi.', (id, version, baglam) => paketIptal(id, version, formMetni(f, 'neden'), baglam, bugunIstanbul()))
}

export async function paketOdemeGeriAlAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  return paketEylemi(f, 'Ödeme geri alındı; paket ödeme emrinde.', (id, version, baglam) => paketOdemeGeriAl(id, version, formMetni(f, 'neden'), baglam))
}
