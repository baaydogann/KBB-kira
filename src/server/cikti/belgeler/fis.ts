import type { Content } from 'pdfmake/interfaces'
import { formatTL } from '@/core/para'
import type { PaketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { bolumBasligi, tablo } from '../pdf'

const tutar = (x: string) => ({ metin: x === '0.00' ? '' : formatTL(x, false), sag: true })

/** Muhasebe işlem fişi önerisi: muhasebe birimi kendi sisteminde kaydeder; hesap kodları MUHASEBE_FIS_HESAPLARI parametresinden. */
export function fisBolumu(v: PaketCiktiVerisi): Content[] {
  return [
    { text: 'MUHASEBE İŞLEM FİŞİ ÖNERİSİ', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 4] },
    { text: `Ödeme paketi ${v.paket.id} — ${v.paket.ad}. Öneridir; kayıt muhasebe biriminde yapılır.`, alignment: 'center', margin: [0, 0, 0, 8] },
    tablo(['Kayıt', 'Hesap', 'Açıklama', 'Borç', 'Alacak'],
      v.fis.satirlar.map((s) => [String(s.kayit), s.hesap, s.aciklama, tutar(s.borc), tutar(s.alacak)]), [32, 80, '*', 70, 70]),
    ...(v.fis.notlar.length > 0 ? [bolumBasligi('Notlar'), { ul: [...v.fis.notlar] } as Content] : []),
  ]
}
