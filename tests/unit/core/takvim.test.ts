import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { artisTarihleri, artisYururlugu, odemeDonemleri, tespitTarihleri, uzamaBitisi, vadeTarihi } from '@/core/takvim'
import { tbk347KapsamindaMi } from '@/core/tipler'
import { dateToTarih, gunEkle, tarih as t } from '@/core/tarih'

describe('odemeDonemleri', () => {
  it('ay sonu başlangıcında kaymaz (Review Focus #2)', () => {
    const d = odemeDonemleri({ baslangic: t('2026-01-31'), bitis: t('2026-05-30'), periyotAy: 1, ufuk: t('2030-01-01') })
    expect(d.map((x) => [x.baslangic, x.bitis, x.tam])).toEqual([
      ['2026-01-31', '2026-02-27', true],
      ['2026-02-28', '2026-03-30', true],
      ['2026-03-31', '2026-04-29', true],
      ['2026-04-30', '2026-05-30', true],
    ])
  })
  it('belirli süreli sözleşmenin son dönemini kırpar (kıst)', () => {
    const d = odemeDonemleri({ baslangic: t('2026-01-01'), bitis: t('2026-03-15'), periyotAy: 1, ufuk: t('2030-01-01') })
    expect(d).toHaveLength(3)
    expect(d[2]).toEqual({ sira: 2, baslangic: '2026-03-01', bitis: '2026-03-15', tam: false })
  })
  it('üç aylık dönemler', () => {
    const d = odemeDonemleri({ baslangic: t('2026-02-01'), bitis: t('2027-01-31'), periyotAy: 3, ufuk: t('2030-01-01') })
    expect(d.map((x) => x.baslangic)).toEqual(['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01'])
    expect(d.every((x) => x.tam)).toBe(true)
  })
  it('belirsiz sürelide ufka kadar üretir', () => {
    const d = odemeDonemleri({ baslangic: t('2026-01-01'), bitis: null, periyotAy: 1, ufuk: t('2026-06-15') })
    expect(d.map((x) => x.baslangic)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'])
  })
  it('özellik: dönemler bitişik ve sözleşme aralığını tam kapsar', () => {
    const tarihUret = fc.date({ min: new Date('2015-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }).map(dateToTarih)
    fc.assert(fc.property(tarihUret, fc.integer({ min: 0, max: 2000 }), fc.constantFrom(1, 3, 6, 12), (bas, gun, periyot) => {
      const bitis = gunEkle(bas, gun)
      const d = odemeDonemleri({ baslangic: bas, bitis, periyotAy: periyot as 1 | 3 | 6 | 12, ufuk: bitis })
      expect(d[0]!.baslangic).toBe(bas)
      expect(d.at(-1)!.bitis).toBe(bitis)
      for (let i = 1; i < d.length; i++) expect(d[i]!.baslangic).toBe(gunEkle(d[i - 1]!.bitis, 1))
    }))
  })
})

describe('vadeTarihi', () => {
  const subat = { baslangic: t('2026-02-01'), bitis: t('2026-02-28') }
  it('dönem başı + n gün', () => expect(vadeTarihi(subat, 'PESIN', 'DONEM_BASI_ARTI_GUN', 5)).toBe('2026-02-06'))
  it('dönem sonu + n gün', () => expect(vadeTarihi(subat, 'DONEM_SONU', 'DONEM_SONU_ARTI_GUN', 0)).toBe('2026-02-28'))
  it('ayın günü ay sonuna kırpılır', () => {
    expect(vadeTarihi(subat, 'PESIN', 'AYIN_GUNU', 31)).toBe('2026-02-28')
    expect(vadeTarihi({ baslangic: t('2026-01-01'), bitis: t('2026-03-31') }, 'DONEM_SONU', 'AYIN_GUNU', 5)).toBe('2026-03-05')
    expect(vadeTarihi({ baslangic: t('2026-01-01'), bitis: t('2026-03-31') }, 'PESIN', 'AYIN_GUNU', 5)).toBe('2026-01-05')
  })
})

describe('artış ve tespit tarihleri', () => {
  it('ilk kira başlangıcından her periyotta, son tarihe kadar', () => {
    expect(artisTarihleri({ ilkKiraBaslangici: t('2024-03-01'), periyotAy: 12, sonTarih: t('2027-02-28') }))
      .toEqual(['2025-03-01', '2026-03-01'])
    expect(artisTarihleri({ ilkKiraBaslangici: t('2024-01-31'), periyotAy: 12, sonTarih: t('2026-12-31') }))
      .toEqual(['2025-01-31', '2026-01-31'])
  })
  it('tespit tarihleri her 5 yılda', () => {
    expect(tespitTarihleri(t('2014-06-01'), t('2026-12-31'))).toEqual(['2019-06-01', '2024-06-01'])
  })
})

describe('artisYururlugu (I2: artış hesabı, onayı ve H5 için yürürlük)', () => {
  const bugun = t('2026-10-15')
  const s = (durum: 'TASLAK' | 'AKTIF' | 'UZADI' | 'FESHEDILDI' | 'SONA_ERDI', bitis: string | null, fesihTarihi: string | null = null) =>
    artisYururlugu({ durum, bitis: bitis === null ? null : t(bitis), fesihTarihi: fesihTarihi === null ? null : t(fesihTarihi) }, bugun)
  it('AKTIF ve UZADI yürürlüktedir; etkin bitiş sözleşme bitişidir', () => {
    expect(s('AKTIF', '2026-12-31')).toEqual({ sonaErmekte: false, bitisEtkin: '2026-12-31' })
    expect(s('UZADI', null)).toEqual({ sonaErmekte: false, bitisEtkin: null })
    // Bitişi geçmiş TBK 347 sözleşmesi uzayana kadar yürürlükte sayılır (otomatik uzama).
    expect(s('AKTIF', '2026-01-31')).toEqual({ sonaErmekte: false, bitisEtkin: '2026-01-31' })
  })
  it('FESHEDILDI fesih tarihine kadar (dahil) yürürlüktedir; etkin bitiş fesih tarihidir', () => {
    expect(s('FESHEDILDI', '2027-12-31', '2026-10-15')).toEqual({ sonaErmekte: true, bitisEtkin: '2026-10-15' })
    expect(s('FESHEDILDI', '2027-12-31', '2027-03-31')).toEqual({ sonaErmekte: true, bitisEtkin: '2027-03-31' })
    expect(s('FESHEDILDI', '2027-12-31', '2026-10-14')).toBeNull()
    expect(s('FESHEDILDI', '2027-12-31', null)).toBeNull()
  })
  it('SONA_ERDI bitişine kadar (dahil) yürürlüktedir', () => {
    expect(s('SONA_ERDI', '2026-10-15')).toEqual({ sonaErmekte: true, bitisEtkin: '2026-10-15' })
    expect(s('SONA_ERDI', '2026-10-14')).toBeNull()
    expect(s('SONA_ERDI', null)).toBeNull()
    // Fesih tarihi yalnızca FESHEDILDI durumunda okunur.
    expect(s('SONA_ERDI', '2026-10-14', '2027-01-01')).toBeNull()
  })
  it('taslak yürürlükte değildir', () => {
    expect(s('TASLAK', '2027-12-31')).toBeNull()
  })
})

describe('uzamaBitisi (Review Focus #2)', () => {
  it('bir yıl uzatır, artık yılı doğru bulur', () => {
    expect(uzamaBitisi(t('2026-12-31'))).toBe('2027-12-31')
    expect(uzamaBitisi(t('2027-02-28'))).toBe('2028-02-29')
    expect(uzamaBitisi(t('2028-02-29'))).toBe('2029-02-28')
  })
})

describe('TBK 347 kapsamı', () => {
  it('arsa hariç', () => {
    expect(tbk347KapsamindaMi('ISYERI')).toBe(true)
    expect(tbk347KapsamindaMi('KONUT')).toBe(true)
    expect(tbk347KapsamindaMi('ARSA')).toBe(false)
  })
})

describe('mutasyon kapısı: azami dönem sınırları ve dahil uçlar', () => {
  it('odemeDonemleri en çok 2400 dönem üretir', () => {
    const d = odemeDonemleri({ baslangic: t('2026-01-01'), bitis: null, periyotAy: 1, ufuk: t('2999-12-31') })
    expect(d).toHaveLength(2400)
    expect(d[2399]!.sira).toBe(2399)
  })
  it('artisTarihleri en çok 2399 tarih üretir (k = 1..2399)', () => {
    const d = artisTarihleri({ ilkKiraBaslangici: t('2026-01-01'), periyotAy: 1, sonTarih: t('2999-12-31') })
    expect(d).toHaveLength(2399)
  })
  it('artisTarihleri son tarihe eşit artış tarihini dahil eder', () => {
    expect(artisTarihleri({ ilkKiraBaslangici: t('2026-01-01'), periyotAy: 12, sonTarih: t('2028-01-01') })).toEqual(['2027-01-01', '2028-01-01'])
    expect(artisTarihleri({ ilkKiraBaslangici: t('2026-01-01'), periyotAy: 12, sonTarih: t('2027-12-31') })).toEqual(['2027-01-01'])
  })
  it('odemeDonemleri: sözleşme bitişi doğal dönem bitişine eşitse dönem tamdır', () => {
    const d = odemeDonemleri({ baslangic: t('2026-01-01'), bitis: t('2026-03-31'), periyotAy: 3, ufuk: t('2030-01-01') })
    expect(d).toEqual([{ sira: 0, baslangic: '2026-01-01', bitis: '2026-03-31', tam: true }])
    const kisa = odemeDonemleri({ baslangic: t('2026-01-01'), bitis: t('2026-03-15'), periyotAy: 3, ufuk: t('2030-01-01') })
    expect(kisa).toEqual([{ sira: 0, baslangic: '2026-01-01', bitis: '2026-03-15', tam: false }])
  })
})
