import type { Content, TableCell } from 'pdfmake/interfaces'
import type { HesapSatiri } from '@/core/hesap/goruntu'
import { ibanBicimle } from '@/core/dogrulama'
import { formatTL } from '@/core/para'
import { formatTarih, tarih } from '@/core/tarih'
import type { DenetimDosyasiVerisi } from '@/server/rapor/denetim-dosyasi'
import { bolumBasligi, tablo } from '../pdf'

const tl = (x: string | null) => (x === null ? '—' : formatTL(x, false))
const sag = (x: string | null) => ({ metin: tl(x), sag: true })
const tm = (t: string | null) => (t === null ? '—' : formatTarih(tarih(t)))
const CIZGI = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#999999', vLineColor: () => '#999999' }

/** Hesap izi alt tablosu (spec §11): kural, açıklama, formül, sonuç; küçük punto. */
function izTablosu(satirlar: readonly HesapSatiri[]): Content {
  return {
    table: { widths: ['auto', '*', '*', 'auto'], body: satirlar.map((s) => [s.kural, s.aciklama, s.formul, { text: s.sonuc, alignment: 'right' }]) },
    layout: 'noBorders', fontSize: 6.5, color: '#444444', margin: [12, 0, 0, 2],
  }
}

/** Her satırın altında, tüm sütunları kaplayan hesap izi satırı olan tablo. */
function izliTablo(basliklar: readonly string[], satirlar: readonly { hucreler: readonly (string | { metin: string; sag?: boolean })[]; iz: readonly HesapSatiri[] }[]): Content {
  const n = basliklar.length
  const body: TableCell[][] = [basliklar.map((b) => ({ text: b, bold: true, fillColor: '#eeeeee' }))]
  for (const s of satirlar) {
    body.push(s.hucreler.map((h) => (typeof h === 'string' ? { text: h } : { text: h.metin, alignment: h.sag ? 'right' : 'left' })))
    if (s.iz.length > 0) body.push([{ stack: [izTablosu(s.iz)], colSpan: n }, ...Array.from({ length: n - 1 }, () => ({ text: '' }))])
  }
  return { table: { headerRows: 1, widths: basliklar.map(() => '*'), body }, layout: CIZGI, margin: [0, 2, 0, 8] }
}

/** Yatay denetim dosyası bölümleri: künye, malikler, kira dönemleri, artışlar, taksitler, dağılımlar, damga, olay özeti. */
export function denetimDosyasiBolumleri(v: DenetimDosyasiVerisi): Content[][] {
  const k = v.kunye
  return [
    [
      { text: 'DENETİM DOSYASI', bold: true, fontSize: 14, alignment: 'center', margin: [0, 0, 0, 4] },
      { text: `${k.sozlesmeNo} — ${k.tasinmaz}`, alignment: 'center', margin: [0, 0, 0, 8] },
      bolumBasligi('Künye'),
      tablo(['Alan', 'Değer', 'Alan', 'Değer'], [
        ['Sözleşme no', k.sozlesmeNo, 'Durum', k.durum],
        ['Taşınmaz', k.tasinmaz, 'Harcama birimi', k.birim],
        ['Ekonomik kod', k.ekonomikKod, 'İhale dayanağı', k.ihaleDayanagi],
        ['İmza tarihi', tm(k.imzaTarihi), 'Başlangıç / bitiş', `${tm(k.baslangic)} – ${tm(k.bitis)}`],
        ['İlk kira başlangıcı', tm(k.ilkKiraBaslangici), 'Bedel', `${tl(k.bedel)} (${k.bedelTabani}, ${k.bedelTuru})`],
        ['Ödeme periyodu', `${k.odemePeriyoduAy} ay`, 'Artış kuralı', k.artisKurali],
        ['Onay belgesi', `${k.onayBelgesiNo ?? '—'} / ${tm(k.onayBelgesiTarihi)}`, 'Önceki sözleşme', k.oncekiSozlesmeNo ?? '—'],
      ], [90, '*', 90, '*']),
      bolumBasligi('Malikler'),
      tablo(['Ad / unvan', 'TCKN/VKN', 'Hisse', 'Geçerlilik', 'IBAN', 'Vekil'],
        v.malikler.map((m) => [m.ad, m.kimlikNo, `${m.pay}/${m.payda}`, `${tm(m.gecerlilikBaslangic)} – ${tm(m.gecerlilikBitis)}`, m.iban ? ibanBicimle(m.iban) : '—', m.vekil ?? '—'])),
      bolumBasligi('Kira dönemleri'),
      tablo(['Başlangıç', 'Bitiş', 'Bedel', 'Taban', 'Kaynak', 'Açıklama'], v.kiraDonemleri.map((d) => [tm(d.baslangic), tm(d.bitis), sag(d.bedel), d.taban, d.kaynak, d.aciklama ?? ''])),
    ],
    [
      bolumBasligi('Artışlar'),
      ...(v.artislar.length === 0 ? [{ text: 'Artış hesabı yok.' } as Content] : v.artislar.flatMap((a): Content[] => [
        tablo(['Dönem', 'Referans', 'Tavan', 'Sözleşme oranı', 'Uygulanan', 'Eski bedel', 'Yeni bedel', 'Durum', 'Onay'], [[
          tm(a.donemBaslangic), a.referans, a.tavan ?? '—', a.sozlesmeOrani ?? '—', a.uygulanan ?? '—', sag(a.eskiBedel), sag(a.yeniBedel), a.durum,
          [a.onaylayan, a.onayZamani].filter((x) => x !== null).join(' · ') || '—',
        ]]),
        { text: a.endeksOnayi ? `Endeks onayı: TÜFE 12 aylık ortalama ${a.referans} = ${a.endeksOnayi.deger} (${a.endeksOnayi.kaynak}${a.endeksOnayi.onaylayan ? `, ${a.endeksOnayi.onaylayan}` : ''}${a.endeksOnayi.onayZamani ? `, ${a.endeksOnayi.onayZamani}` : ''})` : 'Endeks onayı: kayıt yok', fontSize: 8, margin: [0, 0, 0, 2] },
        ...(a.satirlar.length > 0 ? [izTablosu(a.satirlar)] : []),
      ])),
    ],
    [
      bolumBasligi('Taksitler'),
      izliTablo(['Dönem', 'Vade', 'Tür', 'Tutar', 'Durum', 'Ödeme tarihi', 'Paket'], v.taksitler.map((t) => ({
        hucreler: [t.donem, tm(t.vade), t.tur, sag(t.tutar), t.sistemDisi ? `${t.durum} (sistem dışı)` : t.durum, tm(t.odemeTarihi), t.paket ?? '—'], iz: t.satirlar,
      }))),
    ],
    [
      bolumBasligi('Dağılımlar (kesinleşmiş paketler)'),
      ...(v.dagilimlar.length === 0 ? [{ text: 'Kesinleşmiş paket dağılımı yok.' } as Content] : [izliTablo(
        ['Paket', 'Dönem', 'Malik', 'Brüt', 'KDV', 'Stopaj', 'Damga', 'Haciz', '22/A', 'Net'],
        v.dagilimlar.map((d) => ({ hucreler: [d.paket, d.donem, d.malik, sag(d.brut), sag(d.kdv), sag(d.stopaj), sag(d.damga), sag(d.haciz), sag(d.kesinti22a), sag(d.net)], iz: d.satirlar })),
      )]),
      bolumBasligi('Damga vergisi'),
      tablo(['Olay', 'Olay tarihi', 'Matrah', 'Tutar', 'Tahsil', 'Kalan', 'Makbuz', 'İptal'],
        v.damga.map((d) => [d.olay, tm(d.olayTarihi), sag(d.matrah), sag(d.tutar), d.tahsil, sag(d.kalan), d.makbuz ? 'Var' : '—', d.iptal ? 'İptal' : ''])),
    ],
    [
      bolumBasligi(`Olay özeti (en yeni ${v.olaylar.length})`),
      tablo(['Zaman', 'Kullanıcı', 'Varlık', 'Eylem'], v.olaylar.map((o) => [o.zaman, o.kullanici ?? 'sistem', o.varlik, o.eylem]), [110, 140, 100, '*']),
    ],
  ]
}
