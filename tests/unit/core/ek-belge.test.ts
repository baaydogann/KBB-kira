import { describe, expect, it } from 'vitest'
import { ekBelgeler, type EkBelgeGirdisi } from '@/core/paket/ek-belge'
import { tarih as t } from '@/core/tarih'

const sozlesme = (ek: Partial<EkBelgeGirdisi['sozlesmeler'][number]> = {}): EkBelgeGirdisi['sozlesmeler'][number] => ({
  sozlesmeNo: 'S-1', ilkOdeme: true, onayBelgesiNo: 'OB-1', onayBelgesiTarihi: t('2025-12-15'), piyasaArastirmaTarihi: t('2025-12-01'),
  imzaTarihi: t('2025-12-20'), artisVar: false, ...ek,
})
const girdi = (ek: Partial<EkBelgeGirdisi> = {}): EkBelgeGirdisi => ({ sozlesmeler: [], alicilar: [], sorgular: [], hacizler: [], ...ek })

describe('ek belgeler', () => {
  it('ilk ödemede onay belgesi, piyasa araştırması ve sözleşme; sonraki ödemede yok', () => {
    expect(ekBelgeler(girdi({ sozlesmeler: [sozlesme()] }))).toEqual([
      { tur: 'ONAY_BELGESI', aciklama: 'Onay belgesi (S-1)', tarih: '2025-12-15', numara: 'OB-1', eksik: false },
      { tur: 'PIYASA_ARASTIRMA', aciklama: 'Piyasa fiyat araştırma tutanağı (S-1)', tarih: '2025-12-01', numara: null, eksik: false },
      { tur: 'SOZLESME', aciklama: 'Kira sözleşmesi (S-1)', tarih: '2025-12-20', numara: 'S-1', eksik: false },
    ])
    expect(ekBelgeler(girdi({ sozlesmeler: [sozlesme({ ilkOdeme: false })] }))).toEqual([])
  })

  it('KDVli alıcıya fatura (no/tarih); KDVsiz gerçek kişiye harcama pusulası; KDVsiz tüzel kişiye "fatura ya da alındı belgesi" (kayıt yoksa eksik)', () => {
    const b = ekBelgeler(girdi({
      alicilar: [
        { ad: 'Ay Ltd.', tip: 'TUZEL', kdvli: true, faturalar: [{ no: 'F-7', tarih: t('2026-01-20') }] },
        { ad: 'Ayşe Kaya', tip: 'GERCEK', kdvli: false, faturalar: [] },
        { ad: 'Konya Vakfı', tip: 'TUZEL', kdvli: false, faturalar: [] },
        { ad: 'Kara Koop.', tip: 'TUZEL', kdvli: false, faturalar: [{ no: 'A-3', tarih: t('2026-01-21') }] },
        { ad: 'Faturasız A.Ş.', tip: 'TUZEL', kdvli: true, faturalar: [] },
      ],
    }))
    expect(b).toEqual([
      { tur: 'FATURA', aciklama: 'Fatura (Ay Ltd.)', tarih: '2026-01-20', numara: 'F-7', eksik: false },
      { tur: 'HARCAMA_PUSULASI', aciklama: 'Gider pusulası (Ayşe Kaya)', tarih: null, numara: null, eksik: false },
      { tur: 'FATURA', aciklama: 'Fatura ya da alındı belgesi (Konya Vakfı)', tarih: null, numara: null, eksik: true },
      { tur: 'FATURA', aciklama: 'Fatura ya da alındı belgesi (Kara Koop.)', tarih: '2026-01-21', numara: 'A-3', eksik: false },
      { tur: 'FATURA', aciklama: 'Fatura (Faturasız A.Ş.)', tarih: null, numara: null, eksik: true },
    ])
  })

  it('onay belgesi no yoksa eksik = true', () => {
    const [onay, piyasa, soz] = ekBelgeler(girdi({ sozlesmeler: [sozlesme({ onayBelgesiNo: null, piyasaArastirmaTarihi: null, imzaTarihi: null })] }))
    expect([onay!.eksik, piyasa!.eksik, soz!.eksik]).toEqual([true, true, true])
    expect(ekBelgeler(girdi({ sozlesmeler: [sozlesme({ onayBelgesiTarihi: null })] }))[0]!.eksik).toBe(true)
  })

  it('22/A borç yazısı ve haciz yazısı listelenir; artış varsa artış tablosu', () => {
    const b = ekBelgeler(girdi({
      sozlesmeler: [sozlesme({ ilkOdeme: false, artisVar: true })],
      sorgular: [{ belgeNo: 'B-9', sorguTarihi: t('2026-01-25'), vergiDairesi: 'Meram V.D.' }, { belgeNo: null, sorguTarihi: t('2026-01-26'), vergiDairesi: null }],
      hacizler: [{ dosyaNo: '2026/9', tebligTarihi: t('2026-01-10'), alacakli: 'Konya 1. İcra' }],
    }))
    expect(b).toEqual([
      { tur: 'ARTIS_TABLOSU', aciklama: 'Kira artış hesap tablosu (S-1)', tarih: null, numara: null, eksik: false },
      { tur: 'BORC_YAZISI', aciklama: '22/A borç durumu yazısı (Meram V.D.)', tarih: '2026-01-25', numara: 'B-9', eksik: false },
      { tur: 'BORC_YAZISI', aciklama: '22/A borç durumu yazısı', tarih: '2026-01-26', numara: null, eksik: true },
      { tur: 'HACIZ_YAZISI', aciklama: 'Haciz yazısı (Konya 1. İcra)', tarih: '2026-01-10', numara: '2026/9', eksik: false },
    ])
  })

  it('sıra: sözleşme belgeleri, alıcı belgeleri, kesinti belgeleri', () => {
    const b = ekBelgeler({
      hacizler: [{ dosyaNo: 'D', tebligTarihi: t('2026-01-10'), alacakli: 'İcra' }],
      sorgular: [{ belgeNo: 'B', sorguTarihi: t('2026-01-25'), vergiDairesi: 'V' }],
      alicilar: [{ ad: 'X', tip: 'GERCEK', kdvli: false, faturalar: [] }],
      sozlesmeler: [sozlesme({ artisVar: true }), sozlesme({ sozlesmeNo: 'S-2', ilkOdeme: false })],
    })
    expect(b.map((x) => x.tur)).toEqual(['ONAY_BELGESI', 'PIYASA_ARASTIRMA', 'SOZLESME', 'ARTIS_TABLOSU', 'HARCAMA_PUSULASI', 'BORC_YAZISI', 'HACIZ_YAZISI'])
  })
})
