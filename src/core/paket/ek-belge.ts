import type { Tarih } from '../tarih'

export type EkBelgeTuru = 'ONAY_BELGESI' | 'PIYASA_ARASTIRMA' | 'SOZLESME' | 'FATURA' | 'HARCAMA_PUSULASI' | 'ARTIS_TABLOSU' | 'BORC_YAZISI' | 'HACIZ_YAZISI'

export interface EkBelge { tur: EkBelgeTuru; aciklama: string; tarih: Tarih | null; numara: string | null; eksik: boolean }

export interface EkBelgeGirdisi {
  sozlesmeler: readonly {
    sozlesmeNo: string; ilkOdeme: boolean; onayBelgesiNo: string | null; onayBelgesiTarihi: Tarih | null; piyasaArastirmaTarihi: Tarih | null
    imzaTarihi: Tarih | null; artisVar: boolean
  }[]
  alicilar: readonly { ad: string; tip: 'GERCEK' | 'TUZEL'; kdvli: boolean; faturalar: readonly { no: string; tarih: Tarih }[] }[]
  sorgular: readonly { belgeNo: string | null; sorguTarihi: Tarih; vergiDairesi: string | null }[]
  hacizler: readonly { dosyaNo: string; tebligTarihi: Tarih; alacakli: string }[]
}

const belge = (tur: EkBelgeTuru, aciklama: string, tarih: Tarih | null, numara: string | null, eksik: boolean): EkBelge => ({ tur, aciklama, tarih, numara, eksik })

/**
 * Spec §10.2 (HBY md. 5, 35/a, 49/4): ödeme emrine eklenecek belgeler. Sıra: sözleşme belgeleri (ilk ödemede onay belgesi, piyasa
 * araştırması ve sözleşme; artış varsa artış tablosu), alıcı belgeleri (KDV'li: fatura; KDV'siz gerçek kişi: gider pusulası; KDV'siz tüzel
 * kişi: fatura ya da alındı belgesi), kesinti belgeleri (22/A borç yazısı, haciz yazısı). Numarası ya da tarihi bilinmeyen belge eksiktir.
 */
export function ekBelgeler(g: EkBelgeGirdisi): EkBelge[] {
  const sonuc: EkBelge[] = []
  for (const s of g.sozlesmeler) {
    if (s.ilkOdeme) {
      sonuc.push(
        belge('ONAY_BELGESI', `Onay belgesi (${s.sozlesmeNo})`, s.onayBelgesiTarihi, s.onayBelgesiNo, s.onayBelgesiNo === null || s.onayBelgesiTarihi === null),
        belge('PIYASA_ARASTIRMA', `Piyasa fiyat araştırma tutanağı (${s.sozlesmeNo})`, s.piyasaArastirmaTarihi, null, s.piyasaArastirmaTarihi === null),
        belge('SOZLESME', `Kira sözleşmesi (${s.sozlesmeNo})`, s.imzaTarihi, s.sozlesmeNo, s.imzaTarihi === null),
      )
    }
    if (s.artisVar) sonuc.push(belge('ARTIS_TABLOSU', `Kira artış hesap tablosu (${s.sozlesmeNo})`, null, null, false))
  }
  for (const a of g.alicilar) {
    if (!a.kdvli && a.tip === 'GERCEK') {
      sonuc.push(belge('HARCAMA_PUSULASI', `Gider pusulası (${a.ad})`, null, null, false))
      continue
    }
    const ad = a.kdvli ? `Fatura (${a.ad})` : `Fatura ya da alındı belgesi (${a.ad})`
    if (a.faturalar.length === 0) sonuc.push(belge('FATURA', ad, null, null, true))
    for (const f of a.faturalar) sonuc.push(belge('FATURA', ad, f.tarih, f.no, false))
  }
  for (const s of g.sorgular) {
    sonuc.push(belge('BORC_YAZISI', s.vergiDairesi === null ? '22/A borç durumu yazısı' : `22/A borç durumu yazısı (${s.vergiDairesi})`, s.sorguTarihi, s.belgeNo, s.belgeNo === null))
  }
  for (const h of g.hacizler) sonuc.push(belge('HACIZ_YAZISI', `Haciz yazısı (${h.alacakli})`, h.tebligTarihi, h.dosyaNo, false))
  return sonuc
}
