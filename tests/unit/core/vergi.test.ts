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

describe('mutasyon kapısı: statü tablosu ve hesap izi', () => {
  it('statü kuralları spec §6.6 tablosunun tamamıyla birebir eşleşir', () => {
    expect(VARSAYILAN_STATU_KURALLARI).toEqual({
      GMSI_GERCEK: { etiket: 'Gerçek kişi (GMSİ)', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: false, muhsgkKodu: '041' },
      SERBEST_MESLEK: { etiket: 'Serbest meslek erbabı', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: false, muhsgkKodu: '041' },
      TICARI_AKTIF: { etiket: 'Tüccar (işletme aktifinde)', stopaj: null, kdvli: true, teyitGerekli: true, muhsgkKodu: null },
      BASIT_USUL: { etiket: 'Basit usul', stopaj: 'STOPAJ_94_5A', kdvli: false, teyitGerekli: true, muhsgkKodu: '041' },
      SIRKET: { etiket: 'Şirket', stopaj: null, kdvli: true, teyitGerekli: false, muhsgkKodu: null },
      KOOPERATIF: { etiket: 'Kooperatif', stopaj: 'STOPAJ_KVK_15_1B', kdvli: false, teyitGerekli: true, muhsgkKodu: '042' },
      VAKIF_DERNEK: { etiket: 'Vakıf / dernek', stopaj: 'STOPAJ_94_5B', kdvli: false, teyitGerekli: false, muhsgkKodu: null },
      KAMU: { etiket: 'Kamu idaresi', stopaj: null, kdvli: false, teyitGerekli: true, muhsgkKodu: null },
    })
  })

  it('brüt sözleşme, KDV yok: stopaj ve ödenecek satırları, KDV satırı yok', () => {
    const r = malikTutari({ tutar: para('3333.33'), bedelTuru: 'BRUT', stopajOrani: yirmi, kdvOrani: SIFIR })
    expect(r.satirlar).toEqual([
      { kural: 'K4', aciklama: 'Stopaj', formul: '3333.33 × 20%', sonuc: '666.67' },
      { kural: 'K4', aciklama: 'Ödenecek (brüt + KDV − stopaj)', formul: '3333.33 + 0.00 − 666.67', sonuc: '2666.66' },
    ])
  })

  it('brüt sözleşme, KDV var: KDV satırı stopajdan sonra, ödenecekten önce gelir', () => {
    const r = malikTutari({ tutar: para('15000'), bedelTuru: 'BRUT', stopajOrani: SIFIR, kdvOrani: yirmi })
    expect(r.satirlar).toEqual([
      { kural: 'K4', aciklama: 'Stopaj', formul: '15000.00 × 0%', sonuc: '0.00' },
      { kural: 'K4', aciklama: 'KDV', formul: '15000.00 × 20%', sonuc: '3000.00' },
      { kural: 'K4', aciklama: 'Ödenecek (brüt + KDV − stopaj)', formul: '15000.00 + 3000.00 − 0.00', sonuc: '18000.00' },
    ])
  })

  it('net sözleşme: brütleştirme ve stopaj satırları', () => {
    const r = malikTutari({ tutar: para('1000.01'), bedelTuru: 'NET', stopajOrani: yirmi, kdvOrani: SIFIR })
    expect(r.satirlar).toEqual([
      { kural: 'K4', aciklama: 'Brütleştirme (net sözleşme)', formul: '1000.01 / (1 − 20/100)', sonuc: '1250.01' },
      { kural: 'K4', aciklama: 'Stopaj = brüt − net', formul: '1250.01 − 1000.01', sonuc: '250.00' },
      { kural: 'K4', aciklama: 'Ödenecek (brüt + KDV − stopaj)', formul: '1250.01 + 0.00 − 250.00', sonuc: '1000.01' },
    ])
  })

  it('net sözleşmede stopaj oranı sıfırsa brütleştirme yapılmaz', () => {
    const r = malikTutari({ tutar: para('500'), bedelTuru: 'NET', stopajOrani: SIFIR, kdvOrani: SIFIR })
    expect(r.brut.toFixed(2)).toBe('500.00')
    expect(r.satirlar.map((x) => x.aciklama)).toEqual(['Stopaj', 'Ödenecek (brüt + KDV − stopaj)'])
  })
})
