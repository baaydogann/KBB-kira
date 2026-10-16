import { describe, expect, it } from 'vitest'
import { bankaAciklamasi, bankaSatirlari, type BankaGirdiSatiri } from '@/core/paket/banka'
import { SIFIR, para } from '@/core/para'
import { tarih as t } from '@/core/tarih'

const satir = (ek: Partial<BankaGirdiSatiri> = {}): BankaGirdiSatiri => ({
  kisiId: '1', kimlikNo: '12345678901', odemeKisiId: '1', odemeKisiAdi: 'Ali Demir', ibanId: '10', iban: 'TR000000000000000000000001',
  net: para('7773.20'), sozlesmeNo: 'T-1', donemBaslangic: t('2026-02-01'), ...ek,
})
const ozet = (xs: ReturnType<typeof bankaSatirlari>) => xs.map((x) => [x.sira, x.ad, x.iban, x.tutar.toFixed(2), x.aciklama, x.kisiId, x.odemeKisiId])

describe('banka satırları', () => {
  it('vekilsiz tek malik tek taksit: tek satır, açıklama "12345678901 – kira ödemesi – 02/2026 – T-1"', () => {
    expect(ozet(bankaSatirlari([satir()]))).toEqual([[1, 'Ali Demir', 'TR000000000000000000000001', '7773.20', '12345678901 – kira ödemesi – 02/2026 – T-1', '1', '1']])
  })

  it('aynı malik iki taksit: tek satır, tutar toplam, "02/2026–03/2026"', () => {
    const r = bankaSatirlari([satir({ donemBaslangic: t('2026-03-01'), net: para('100') }), satir(), satir({ donemBaslangic: t('2026-02-15'), net: para('1') })])
    expect(ozet(r)).toEqual([[1, 'Ali Demir', 'TR000000000000000000000001', '7874.20', '12345678901 – kira ödemesi – 02/2026–03/2026 – T-1', '1', '1']])
  })

  it('vekil iki malik: aynı IBAN a iki satır, her biri kendi malikinin kimlik no su ile', () => {
    const vekil = { odemeKisiId: '9', odemeKisiAdi: 'Veli Vekil', ibanId: '90', iban: 'TR990000000000000000000009' }
    const r = bankaSatirlari([satir({ ...vekil, kisiId: '2', kimlikNo: '22222222222', net: para('50') }), satir({ ...vekil, net: para('60') })])
    expect(ozet(r)).toEqual([
      [1, 'Veli Vekil', 'TR990000000000000000000009', '60.00', '12345678901 – kira ödemesi – 02/2026 – T-1', '1', '9'],
      [2, 'Veli Vekil', 'TR990000000000000000000009', '50.00', '22222222222 – kira ödemesi – 02/2026 – T-1', '2', '9'],
    ])
  })

  it('iki sözleşme: "T-1, T-2"; net 0 grup atlanır; sıra ada göre (Çelik < Demir, Türkçe sıralama)', () => {
    const demir = { odemeKisiAdi: 'Demir Ali' }
    const r = bankaSatirlari([
      satir({ ...demir, sozlesmeNo: 'T-2' }), satir(demir), satir({ ...demir, sozlesmeNo: 'T-2', net: para('1') }),
      satir({ kisiId: '5', odemeKisiId: '5', odemeKisiAdi: 'Zeki Zor', ibanId: '50' }),
      satir({ kisiId: '3', odemeKisiId: '3', odemeKisiAdi: 'Çelik Ayşe', ibanId: '30', kimlikNo: '33333333333' }),
      satir({ kisiId: '4', odemeKisiId: '4', odemeKisiAdi: 'Ahmet Sıfır', ibanId: '40', net: SIFIR }),
    ])
    expect(r.map((x) => [x.sira, x.ad, x.tutar.toFixed(2), x.aciklama.split(' – ').at(-1)])).toEqual([
      [1, 'Çelik Ayşe', '7773.20', 'T-1'], [2, 'Demir Ali', '15547.40', 'T-1, T-2'], [3, 'Zeki Zor', '7773.20', 'T-1'],
    ])
  })

  it('aynı ad: kisiId sırası', () => {
    const k = (id: string) => satir({ kisiId: id, odemeKisiId: id, ibanId: `${id}0` })
    expect(bankaSatirlari([k('7'), k('6')]).map((x) => [x.sira, x.kisiId])).toEqual([[1, '6'], [2, '7']])
    expect(bankaSatirlari([k('6'), k('10'), k('8'), k('9')]).map((x) => x.kisiId)).toEqual(['6', '8', '9', '10'])
  })

  it('bankaAciklamasi: ay ve sözleşme tekrarları birleşir, sıralanır', () => {
    expect(bankaAciklamasi('1', [{ yil: 2026, ay: 3 }, { yil: 2025, ay: 12 }, { yil: 2026, ay: 3 }], ['T-2', 'T-1', 'T-2'])).toBe('1 – kira ödemesi – 12/2025–03/2026 – T-1, T-2')
  })
})
