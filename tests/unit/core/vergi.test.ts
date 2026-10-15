import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { D, para, SIFIR } from '@/core/para'
import { VARSAYILAN_STATU_KURALLARI, malikTutari } from '@/core/hesap/vergi'

const yirmi = para('20')

describe('malikTutari', () => {
  it('brüt sözleşme: stopaj kesilir', () => {
    const r = malikTutari({ tutar: para('3333.33'), bedelTuru: 'BRUT', stopajOrani: yirmi, kdvOrani: SIFIR })
    expect([r.brut, r.stopaj, r.kdv, r.net].map((x) => x.toFixed(2))).toEqual(['3333.33', '666.67', '0.00', '2666.66'])
  })
  it('net sözleşme: brütleştirilir, net aynen korunur', () => {
    const a = malikTutari({ tutar: para('1000.01'), bedelTuru: 'NET', stopajOrani: yirmi, kdvOrani: SIFIR })
    expect([a.brut, a.stopaj, a.net].map((x) => x.toFixed(2))).toEqual(['1250.01', '250.00', '1000.01'])
    const b = malikTutari({ tutar: para('2666.66'), bedelTuru: 'NET', stopajOrani: yirmi, kdvOrani: SIFIR })
    expect([b.brut, b.stopaj, b.net].map((x) => x.toFixed(2))).toEqual(['3333.33', '666.67', '2666.66'])
  })
  it('şirket: stopaj yok, KDV eklenir', () => {
    const r = malikTutari({ tutar: para('15000'), bedelTuru: 'BRUT', stopajOrani: SIFIR, kdvOrani: yirmi })
    expect([r.brut, r.kdv, r.stopaj, r.net].map((x) => x.toFixed(2))).toEqual(['15000.00', '3000.00', '0.00', '18000.00'])
  })
  it('özellik: NET sözleşmede net = girdi; her zaman brut + kdv − stopaj = net', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 5000 }), fc.boolean(), (kurus, oranBaz, netMi) => {
      const tutar = new D(kurus.toString()).dividedBy(100)
      const r = malikTutari({ tutar, bedelTuru: netMi ? 'NET' : 'BRUT', stopajOrani: new D(oranBaz).dividedBy(100), kdvOrani: SIFIR })
      if (netMi) expect(r.net.toFixed(2)).toBe(tutar.toFixed(2))
      expect(r.brut.plus(r.kdv).minus(r.stopaj).toFixed(2)).toBe(r.net.toFixed(2))
    }))
  })
})

describe('VARSAYILAN_STATU_KURALLARI', () => {
  it('spec §6.6 tablosuyla uyumlu', () => {
    expect(VARSAYILAN_STATU_KURALLARI.GMSI_GERCEK).toMatchObject({ stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: false, muhsgkKodu: '041' })
    expect(VARSAYILAN_STATU_KURALLARI.SIRKET).toMatchObject({ stopaj: null, kdvli: true, teyitGerekli: false })
    expect(VARSAYILAN_STATU_KURALLARI.TICARI_AKTIF).toMatchObject({ stopaj: null, kdvli: true, teyitGerekli: true })
    expect(VARSAYILAN_STATU_KURALLARI.BASIT_USUL.teyitGerekli).toBe(true)
    expect(VARSAYILAN_STATU_KURALLARI.KOOPERATIF).toMatchObject({ stopaj: 'STOPAJ_KVK_15_1B', muhsgkKodu: '042' })
    expect(VARSAYILAN_STATU_KURALLARI.VAKIF_DERNEK.stopaj).toBe('STOPAJ_94_5B')
    expect(VARSAYILAN_STATU_KURALLARI.KAMU).toMatchObject({ stopaj: null, kdvli: false, teyitGerekli: true })
  })
})
