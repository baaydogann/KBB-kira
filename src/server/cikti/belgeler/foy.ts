import type { Content } from 'pdfmake/interfaces'
import { ibanBicimle } from '@/core/dogrulama'
import { formatTL } from '@/core/para'
import { formatTarih, tarih } from '@/core/tarih'
import type { PaketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { bolumBasligi, tablo } from '../pdf'

const tl = (x: string) => formatTL(x, false)
const sag = (x: string) => ({ metin: tl(x), sag: true })
const tarihMetni = (t: string | null) => (t === null ? '—' : formatTarih(tarih(t)))

const KESINTI_ADI: Record<string, string> = { GV_STOPAJI: 'Gelir vergisi stopajı', DAMGA: 'Damga vergisi', HACIZ: 'İcra haczi', KESINTI_22A: '22/A vergi borcu' }

/** Ödeme emri hazırlık föyü (MİBMY yeni Örnek 32 alan sırası): başlık bilgileri, alıcılar, kalemler, kesintiler, toplamlar, ekler, imzalar. */
export function foyBolumu(v: PaketCiktiVerisi): Content[] {
  const kesintiToplami = v.toplam.kesinti
  return [
    { text: 'ÖDEME EMRİ HAZIRLIK FÖYÜ', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 8] },
    tablo(['Alan', 'Değer'], [
      ['Kamu idaresi', v.idare.ad],
      ['Vergi kimlik no', v.idare.vkn ?? 'GİRİLMEDİ'],
      ['Harcama birimi', v.birim.ad],
      ['Kurumsal kod', v.birim.kurumsalKod],
      ['Bütçe yılı', String(v.butceYili)],
      ['Kayıt adedi', String(v.alicilar.length)],
      ['Paket no / tarih', `${v.paket.id} — ${v.paket.ad} / ${tarihMetni(v.paket.hesapTarihi)}`],
      ...(v.paket.odemeEmriNo ? [['Ödeme emri no / tarih', `${v.paket.odemeEmriNo} / ${tarihMetni(v.paket.odemeEmriTarihi)}`]] : []),
    ], [140, '*']),
    bolumBasligi('Ödeme yapılacak kişiler'),
    tablo(['Sıra', 'Adı soyadı / unvanı', 'VKN / TCKN', 'IBAN', 'Net'],
      v.alicilar.map((a) => [String(a.sira), a.odemeKisiAdi === a.ad ? a.ad : `${a.ad} (ödeme: ${a.odemeKisiAdi})`, a.kimlikNo, a.iban === null ? '—' : ibanBicimle(a.iban), sag(a.net)]),
      [24, '*', 70, 150, 60]),
    bolumBasligi('Ödeme kalemleri'),
    tablo(['Kalem', 'Bütçe tertibi', 'Brüt (KDV dahil)'], v.kalemler.map((k) => [`${k.sozlesmeNo} · ${k.donem}`, k.tertip, sag(k.gider)]), ['*', 180, 80]),
    bolumBasligi('Kesintiler'),
    tablo(['Tür', 'Alt tür', 'Kurum', 'Dosya no', 'Kişi', 'Hesaba esas', 'Oran', 'Tutar'],
      v.kesintiler.map((k) => [KESINTI_ADI[k.tur] ?? k.tur, k.altTur, k.kurum, k.dosyaNo ?? '—', k.kisiAdi, sag(k.hesabaEsas), k.oran ?? '—', sag(k.tutar)]),
      ['auto', 'auto', '*', 'auto', '*', 'auto', 'auto', 'auto']),
    bolumBasligi('Toplamlar'),
    tablo(['Brüt', 'Kesinti toplamı', 'Net', 'Ödenmesi gereken'], [[sag(v.toplam.gider), sag(kesintiToplami), sag(v.toplam.net), { metin: tl(v.toplam.net), sag: true, kalin: true }]]),
    bolumBasligi('Ekler'),
    tablo(['Tür', 'Tarih', 'Numara', 'Açıklama'], v.ekBelgeler.map((b) => [b.tur, tarihMetni(b.tarih), b.numara ?? '—', b.aciklama + (b.eksik ? ' (EKSİK)' : '')]), ['auto', 'auto', 'auto', '*']),
    {
      margin: [0, 24, 0, 0],
      columns: [
        { stack: [{ text: 'Gerçekleştirme görevlisi', bold: true }, { text: v.birim.gerceklestirmeGorevlisi ?? '', margin: [0, 4, 0, 0] }, { text: 'İmza:', margin: [0, 24, 0, 0] }] },
        { stack: [{ text: 'Harcama yetkilisi', bold: true }, { text: v.birim.harcamaYetkilisi ?? '', margin: [0, 4, 0, 0] }, { text: 'İmza:', margin: [0, 24, 0, 0] }] },
      ],
    },
  ]
}
