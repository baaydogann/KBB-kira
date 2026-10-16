import type { Content } from 'pdfmake/interfaces'
import { formatTarih, tarih } from '@/core/tarih'
import type { PaketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { tablo } from '../pdf'

/** Ek belge kontrol listesi: ayrı sayfa; her belge için onay kutusu, ad, tarih/no ve eksik işareti. */
export function ekListeBolumu(v: PaketCiktiVerisi): Content[] {
  return [
    { text: 'EK BELGE KONTROL LİSTESİ', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 4] },
    { text: `Ödeme paketi ${v.paket.id} — ${v.paket.ad}`, alignment: 'center', margin: [0, 0, 0, 8] },
    tablo(['', 'Belge', 'Tarih / No', 'Durum'], v.ekBelgeler.map((b) => [
      '☐', b.aciklama,
      [b.tarih === null ? null : formatTarih(tarih(b.tarih)), b.numara].filter((x) => x !== null).join(' / ') || '—',
      b.eksik ? { metin: 'EKSİK', kalin: true } : '',
    ]), [16, '*', 120, 50]),
  ]
}
