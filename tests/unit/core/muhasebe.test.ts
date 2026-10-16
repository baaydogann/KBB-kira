import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fisOnerisi, type FisGirdisi, type FisHesaplari, type FisSatiri } from '@/core/paket/muhasebe'
import { SIFIR, kurustanPara, para, topla } from '@/core/para'

const HESAPLAR: FisHesaplari = {
  gider: '630', vergi: '360', emanet22a: '333', emanetHaciz: '333', banka: '103',
  butceGider: '830', giderYansitma: '835', odenekliGider: '905', gonderilecekOdenek: '900',
}
const TERTIP = '46.01.33.01.01.3.9.00.5.03.5.5.05'
const girdi = (ek: Partial<FisGirdisi> = {}): FisGirdisi => ({
  tertipler: [{ ekonomikKod: '03.5.5.05', tertip: TERTIP, gider: para('10000') }],
  stopaj: para('2000'), damga: para('18.90'), haciz: SIFIR, kesinti22a: SIFIR, net: para('7981.10'), ilkOdemeler: [], hesaplar: HESAPLAR, ...ek,
})
const ozet = (s: readonly FisSatiri[]) => s.map((x) => [x.kayit, x.hesap, x.aciklama, x.borc.toFixed(2), x.alacak.toFixed(2)])

describe('muhasebe fişi önerisi', () => {
  it('araştırma yevmiyesi (altın): gider 10.000, stopaj 2.000, damga 18,90, net 7.981,10 → 630.03.5.5.05 B 10.000 / 360 A 2.000 + 18,90 / 103 A 7.981,10; 830/835 ve 905/900 10.000', () => {
    const { satirlar, notlar } = fisOnerisi(girdi())
    expect(ozet(satirlar)).toEqual([
      [1, '630.03.5.5.05', `Kira gideri — ${TERTIP}`, '10000.00', '0.00'],
      [1, '360', 'Gelir vergisi stopajı', '0.00', '2000.00'],
      [1, '360', 'Damga vergisi', '0.00', '18.90'],
      [1, '103', 'Hak sahiplerine ödenecek', '0.00', '7981.10'],
      [2, '830', 'Bütçe giderleri', '10000.00', '0.00'],
      [2, '835', 'Gider yansıtma', '0.00', '10000.00'],
      [3, '905', 'Ödenekli giderler', '10000.00', '0.00'],
      [3, '900', 'Gönderilecek bütçe ödenekleri', '0.00', '10000.00'],
    ])
    expect(notlar).toEqual([])
  })

  it('22/A ve haciz 333 e yazılır; sıfır tutarlı satır yazılmaz', () => {
    const { satirlar } = fisOnerisi(girdi({ stopaj: SIFIR, damga: SIFIR, haciz: para('1000'), kesinti22a: para('500'), net: para('8500') }))
    expect(ozet(satirlar.filter((x) => x.kayit === 1))).toEqual([
      [1, '630.03.5.5.05', `Kira gideri — ${TERTIP}`, '10000.00', '0.00'],
      [1, '333', '6183 md. 22/A kesintisi', '0.00', '500.00'],
      [1, '333', 'Haciz kesintisi', '0.00', '1000.00'],
      [1, '103', 'Hak sahiplerine ödenecek', '0.00', '8500.00'],
    ])
    const bos = fisOnerisi(girdi({ tertipler: [{ ekonomikKod: '03.5.5.05', tertip: TERTIP, gider: SIFIR }], stopaj: SIFIR, damga: SIFIR, net: SIFIR }))
    expect(bos.satirlar).toEqual([])
  })

  it('iki tertip iki ayrı 630 borç satırı', () => {
    const { satirlar } = fisOnerisi(girdi({
      tertipler: [{ ekonomikKod: '03.5.5.05', tertip: 'A.03.5.5.05', gider: para('6000') }, { ekonomikKod: '03.5.5.02', tertip: 'A.03.5.5.02', gider: para('4000') }],
    }))
    expect(ozet(satirlar.filter((x) => x.borc.greaterThan(0) && x.kayit === 1))).toEqual([
      [1, '630.03.5.5.05', 'Kira gideri — A.03.5.5.05', '6000.00', '0.00'],
      [1, '630.03.5.5.02', 'Kira gideri — A.03.5.5.02', '4000.00', '0.00'],
    ])
    expect(satirlar.filter((x) => x.kayit === 2).map((x) => [x.borc.toFixed(2), x.alacak.toFixed(2)])).toEqual([['10000.00', '0.00'], ['0.00', '10000.00']])
  })

  it('özellik: her kayıtta Σ borç = Σ alacak', () => {
    const kurus = fc.integer({ min: 0, max: 5_000_000 })
    fc.assert(fc.property(fc.array(kurus, { minLength: 1, maxLength: 4 }), kurus, kurus, kurus, kurus, (giderler, s, d, h, k) => {
      const tertipler = giderler.map((g, i) => ({ ekonomikKod: `03.5.5.0${i}`, tertip: `T${i}`, gider: kurustanPara(BigInt(g)) }))
      const toplamGider = topla(tertipler.map((t) => t.gider))
      const kesinti = [s, d, h, k].map((x) => kurustanPara(BigInt(x)))
      // Kesintiler gideri aşmayacak biçimde ölçeklenir; net kalan olur.
      const olcek = topla(kesinti).greaterThan(toplamGider) ? SIFIR : null
      const [stopaj, damga, haciz, kesinti22a] = kesinti.map((x) => olcek ?? x) as [typeof SIFIR, typeof SIFIR, typeof SIFIR, typeof SIFIR]
      const net = toplamGider.minus(stopaj).minus(damga).minus(haciz).minus(kesinti22a)
      const { satirlar } = fisOnerisi({ tertipler, stopaj, damga, haciz, kesinti22a, net, ilkOdemeler: [], hesaplar: HESAPLAR })
      for (const kayit of [1, 2, 3]) {
        const k2 = satirlar.filter((x) => x.kayit === kayit)
        expect(topla(k2.map((x) => x.borc)).equals(topla(k2.map((x) => x.alacak)))).toBe(true)
      }
      expect(satirlar.every((x) => !(x.borc.isZero() && x.alacak.isZero()))).toBe(true)
    }))
  })

  it('ilk ödeme notu taahhüt tutarıyla; tutar yoksa parantezsiz', () => {
    const { notlar } = fisOnerisi(girdi({ ilkOdemeler: [{ sozlesmeNo: 'S-1', taahhut: para('120000') }, { sozlesmeNo: 'S-2', taahhut: null }] }))
    expect(notlar).toEqual([
      'İlk ödeme — S-1: sözleşme taahhüdü 920/921 hesaplarına kaydedilmiş olmalı (sözleşme bedeli, KDV hariç: 120.000,00 ₺).',
      'İlk ödeme — S-2: sözleşme taahhüdü 920/921 hesaplarına kaydedilmiş olmalı.',
    ])
  })
})
