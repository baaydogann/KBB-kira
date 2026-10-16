import type { Content } from 'pdfmake/interfaces'
import { formatOran, formatTL, para } from '@/core/para'
import { formatTarih, tarih } from '@/core/tarih'
import type { AliciCiktisi, PaketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { tablo } from '../pdf'

const sag = (x: string) => ({ metin: formatTL(x, false), sag: true })

/** Harcama (gider) pusulası (Örnek 1): fatura vermeyen gerçek kişi alıcı başına bir sayfa (spec §10.2). */
export function pusulaBolumu(v: PaketCiktiVerisi, a: AliciCiktisi): Content[] {
  return [
    { text: 'HARCAMA PUSULASI', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 8] },
    tablo(['Alan', 'Değer'], [
      ['Kamu idaresi', v.idare.ad],
      ['Harcama birimi', v.birim.ad],
      ['Tarih', formatTarih(tarih(v.paket.hesapTarihi))],
      ['Ödeme paketi', `${v.paket.id} — ${v.paket.ad}`],
    ], [140, '*']),
    tablo(['Açıklama', 'Brüt', 'Stopaj', 'Damga', 'Haciz', '22/A', 'Net'], [
      ...a.satirlar.map((s) => [
        `Taşınmaz kirası — ${s.sozlesmeNo} — ${s.donem}`, sag(s.brut), { metin: `${formatTL(s.stopaj, false)} (${formatOran(para(s.stopajOrani))})`, sag: true },
        sag(s.damga), sag(s.haciz), sag(s.kesinti22a), sag(s.net),
      ]),
      [{ metin: 'Toplam', kalin: true }, sag(a.brut), sag(a.stopaj), sag(a.damga), sag(a.haciz), sag(a.kesinti22a), { metin: formatTL(a.net, false), sag: true, kalin: true }],
    ], ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto']),
    { text: 'Parayı alan', bold: true, margin: [0, 8, 0, 2] },
    tablo(['Adı soyadı', 'TCKN', 'Adres'], [[a.ad, a.kimlikNo, a.adres ?? '—']], [150, 80, '*']),
    {
      margin: [0, 24, 0, 0],
      columns: [
        { stack: [{ text: 'Düzenleyen (gerçekleştirme görevlisi)', bold: true }, { text: v.birim.gerceklestirmeGorevlisi ?? '', margin: [0, 4, 0, 0] }, { text: 'İmza:', margin: [0, 24, 0, 0] }] },
        { stack: [{ text: 'Parayı alan', bold: true }, { text: a.ad, margin: [0, 4, 0, 0] }, { text: 'İmza:', margin: [0, 24, 0, 0] }] },
      ],
    },
  ]
}
