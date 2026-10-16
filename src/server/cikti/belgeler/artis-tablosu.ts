import type { Content } from 'pdfmake/interfaces'
import { formatTL } from '@/core/para'
import { formatTarih, tarih } from '@/core/tarih'
import type { PaketCiktiVerisi } from '@/server/paket/cikti-verisi'
import { bolumBasligi, tablo } from '../pdf'

/** Kira artış hesap tablosu: paketteki taksitleri etkileyen onaylı artışlar ve hesap izi. */
export function artisTablosuBolumu(v: PaketCiktiVerisi): Content[] {
  return [
    { text: 'KİRA ARTIŞ HESAP TABLOSU', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 8] },
    ...v.artislar.flatMap((a): Content[] => [
      bolumBasligi(`${a.sozlesmeNo} — ${formatTarih(tarih(a.donemBaslangic))} dönemi`),
      tablo(['Referans', 'Eski bedel', 'Tavan', 'Sözleşme oranı', 'Uygulanan oran', 'Yeni bedel', 'Onaylayan'], [[
        a.referans, { metin: formatTL(a.eskiBedel, false), sag: true }, a.tavan ?? '—', a.sozlesmeOrani ?? '—', a.uygulananOran,
        { metin: a.yeniBedel === '—' ? '—' : formatTL(a.yeniBedel, false), sag: true, kalin: true },
        [a.onaylayan, a.onayZamani].filter((x) => x !== null).join(' · ') || '—',
      ]]),
      ...(a.satirlar.length > 0
        ? [tablo(['Adım', 'Formül', 'Sonuç'], a.satirlar.map((s) => [s.aciklama, s.formul, s.sonuc]), ['*', '*', 90])]
        : []),
    ]),
  ]
}
