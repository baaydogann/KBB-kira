import { describe, expect, it } from 'vitest'
import { para, SIFIR } from '@/core/para'
import { muhtasarSatirlari, type MuhtasarGirdisi } from '@/core/rapor/vergi'

const g = (ek: Partial<MuhtasarGirdisi> = {}): MuhtasarGirdisi => ({
  kisiId: '1', turKodu: '041', kimlikNo: '11111111111', soyadUnvan: 'Demir', ad: 'Ali', brut: para('10000'), stopaj: para('2000'), ...ek,
})
const ozet = (xs: MuhtasarGirdisi[]) => xs.map((x) => [x.kisiId, x.turKodu, x.soyadUnvan, x.brut.toFixed(2), x.stopaj.toFixed(2)])

describe('muhtasar satırları', () => {
  it('aynı kişinin iki dağılımı tek satırda toplanır', () => {
    expect(ozet(muhtasarSatirlari([g(), g({ brut: para('5000'), stopaj: para('1000') })]))).toEqual([['1', '041', 'Demir', '15000.00', '3000.00']])
  })

  it('041 ve 042 ayrı satır; kodsuz satır sonda', () => {
    const r = muhtasarSatirlari([
      g({ kisiId: '3', turKodu: null, soyadUnvan: 'Ahmet Vakfı' }), g({ turKodu: '042', soyadUnvan: 'Ak' }), g({ kisiId: '2', soyadUnvan: 'Zor' }), g({ turKodu: '042', soyadUnvan: 'Ak', stopaj: para('1') }),
    ])
    expect(r.map((x) => [x.kisiId, x.turKodu])).toEqual([['2', '041'], ['1', '042'], ['3', null]])
    expect(r[1]!.stopaj.toFixed(2)).toBe('2001.00')
    // Aynı kişinin iki kodu iki satırdır.
    expect(muhtasarSatirlari([g(), g({ turKodu: '042' })]).map((x) => x.turKodu)).toEqual(['041', '042'])
  })

  it('kod sırası girdi sırasından bağımsız: 041, 042, kodsuz', () => {
    const kodlar = ['041', '042', null] as const
    const perm = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    for (const p of perm) {
      const r = muhtasarSatirlari(p.map((i) => g({ kisiId: String(i + 1), turKodu: kodlar[i]!, soyadUnvan: 'Aynı' })))
      expect(r.map((x) => x.turKodu)).toEqual(['041', '042', null])
    }
    // Kodsuz iki satır kendi içinde ada göre sıralanır.
    const r = muhtasarSatirlari([g({ kisiId: '2', turKodu: null, soyadUnvan: 'Zor' }), g({ kisiId: '1', turKodu: null, soyadUnvan: 'Ak' })])
    expect(r.map((x) => x.soyadUnvan)).toEqual(['Ak', 'Zor'])
  })

  it('stopajsız satır listelenmez', () => {
    expect(muhtasarSatirlari([g({ stopaj: SIFIR }), g({ kisiId: '2', stopaj: SIFIR, turKodu: null })])).toEqual([])
    expect(muhtasarSatirlari([g({ stopaj: SIFIR }), g({ stopaj: para('0.01') })]).map((x) => x.stopaj.toFixed(2))).toEqual(['0.01'])
  })

  it('Türkçe sıralama: Çelik, Demir, Şahin, Yılmaz', () => {
    const r = muhtasarSatirlari(['Yılmaz', 'Şahin', 'Demir', 'Çelik'].map((ad, i) => g({ kisiId: String(i + 1), soyadUnvan: ad })))
    expect(r.map((x) => x.soyadUnvan)).toEqual(['Çelik', 'Demir', 'Şahin', 'Yılmaz'])
  })

  it('aynı ad ve kod: kisiId sayısal sırası', () => {
    const r = muhtasarSatirlari(['10', '9', '11'].map((k) => g({ kisiId: k })))
    expect(r.map((x) => x.kisiId)).toEqual(['9', '10', '11'])
  })
})
