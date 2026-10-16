'use server'

import { revalidatePath } from 'next/cache'
import { oranAyristir, para } from '@/core/para'
import { bugunIstanbul } from '@/core/tarih'
import { artislariHesapla } from '@/server/artis/servis'
import { islemBaglami, kullaniciGerekli } from '@/server/auth/gerekli'
import type { IslemBaglami } from '@/server/baglam'
import { prisma } from '@/server/db'
import { endeksElleGir, endeksOnayla, oranSerisiMi } from '@/server/endeks/servis'
import { eylemSonrasiHatirlatmalariTazele } from '@/server/isler/hatirlatma-uret'
import { basariDurumu, formDegerleri, formKimligi, formMetni, hataDurumu, uyariIle, type FormDurumu } from '@/app/_lib/form'

const DUZ_ONDALIK = /^-?\d+(\.\d+)?$/

const alanHatasi = (f: FormData, alan: string, mesaj: string): FormDurumu =>
  ({ hata: mesaj, alanHatalari: { [alan]: mesaj }, tamam: false, degerler: formDegerleri(f) })

/**
 * Spec §8: onaylı bir endeks değeri girince o aya bağlı BEKLEMEDE artışlar hesaplanır. Onay kendi işleminde kalıcı olmuştur;
 * burada ayrı bir işlemde çalışır ve başarısızlığı onayı geri almaz, kullanıcıya uyarı olarak döner (günlük iş aynı hesabı yineler).
 */
async function bekleyenArtislariHesapla(baglam: IslemBaglami): Promise<string | undefined> {
  try {
    const r = await prisma.$transaction((tx) => artislariHesapla(tx, bugunIstanbul(), undefined, baglam), { timeout: 120_000 })
    return r.hatalar?.length ? `Bekleyen artışlar hesaplanırken bazı sözleşmeler atlandı: ${r.hatalar.join(' ')}` : undefined
  } catch (e) {
    const ileti = hataDurumu(e).hata ?? 'Beklenmeyen bir hata oluştu.'
    return `Endeks kaydedildi ancak bekleyen artışlar hesaplanamadı: ${ileti} Sözleşmenin "Kira dönemleri ve artışlar" sekmesinden "Şimdi hesapla" ile yeniden deneyin.`
  }
}

export async function endeksOnaylaAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const id = formKimligi(f, 'id')
  if (id === null) return { hata: 'Kayıt seçilmedi.', alanHatalari: {}, tamam: false, degerler: formDegerleri(f) }
  const metin = formMetni(f, 'resmiDeger')
  const resmi = metin ? oranAyristir(metin) : null
  if (resmi && !resmi.ok) return alanHatasi(f, 'resmiDeger', resmi.hata.mesaj)
  // Sayfada gösterilen EVDS değeri: sayfa açıldıktan sonra değiştiyse servis onayı reddeder.
  const gorulen = formMetni(f, 'gorulenDeger')
  if (!DUZ_ONDALIK.test(gorulen)) {
    return { hata: 'Form verisi eksik veya geçersiz. Sayfayı yenileyin ve değeri bültenle tekrar karşılaştırın.', alanHatalari: {}, tamam: false, degerler: formDegerleri(f) }
  }
  let baglam: IslemBaglami
  try {
    baglam = await islemBaglami(k)
    await endeksOnayla(id, resmi && resmi.ok ? resmi.deger : null, baglam, para(gorulen))
  } catch (e) {
    return hataDurumu(e, f)
  }
  const uyari = await bekleyenArtislariHesapla(baglam)
  // Onay H4'ü kapatır, hesaplanan artış H5'i değiştirir: hatırlatmalar hemen yenilenir (en iyi çaba, ayrı işlem).
  const durum = uyariIle(basariDurumu('Endeks onaylandı.'), uyari, await eylemSonrasiHatirlatmalariTazele())
  revalidatePath('/endeksler')
  return durum
}

export async function endeksElleGirAction(_: FormDurumu, f: FormData): Promise<FormDurumu> {
  const k = await kullaniciGerekli()
  const seri = formMetni(f, 'seri')
  if (!oranSerisiMi(seri)) return alanHatasi(f, 'seri', 'Geçerli bir seri seçin.')
  const ay = /^(\d{4})-(\d{2})$/.exec(formMetni(f, 'ay'))
  if (!ay) return alanHatasi(f, 'ay', 'Ayı yyyy-aa biçiminde seçin (ör. 2026-09).')
  const deger = oranAyristir(formMetni(f, 'deger'))
  if (!deger.ok) return alanHatasi(f, 'deger', deger.hata.mesaj)
  let baglam: IslemBaglami
  try {
    baglam = await islemBaglami(k)
    await endeksElleGir({ seri, ay: { yil: Number(ay[1]), ay: Number(ay[2]) }, deger: deger.deger }, baglam)
  } catch (e) {
    return hataDurumu(e, f)
  }
  const uyari = await bekleyenArtislariHesapla(baglam)
  const durum = uyariIle(basariDurumu('Değer onaylı olarak kaydedildi.'), uyari, await eylemSonrasiHatirlatmalariTazele())
  revalidatePath('/endeksler')
  return durum
}
