import { describe, expect, it } from 'vitest'
import { sozlesmeGirdisiSemasi } from '@/server/sozlesme/sema'

const temel = {
  sozlesmeNo: 'T-1', tasinmazId: 1, birimId: 1, ekonomikKod: null, imzaTarihi: '2025-12-20', baslangic: '2026-01-01', bitis: '2026-12-31', ilkKiraBaslangici: null,
  bedelTutari: '10.000,00', bedelTabani: 'AYLIK', bedelTuru: 'BRUT', odemePeriyoduAy: 1, odemeZamani: 'PESIN', vadeKurali: 'DONEM_BASI_ARTI_GUN', vadeParametresi: 0,
  artisKurali: 'TUFE12', artisDegisimTuru: 'ON_IKI_AY_ORT', sabitArtisOrani: null, artisPeriyoduAy: 12, kistYontemi: 'GERCEK_GUN', damgaTahsil: 'ISTIHKAKTAN',
  ihaleDayanagi: 'DT_4734_22E', onayBelgesiNo: null, onayBelgesiTarihi: null, piyasaArastirmaTarihi: null, encumenKararNo: null, gecisTarihi: null, gecisBedeli: null,
  odenmisSayilanSonTarih: null, notlar: null, malikler: [{ kisiId: 1, pay: 1, payda: 1, ibanId: null, vekilKisiId: null }],
}

const alanHatalari = (ek: Record<string, unknown>) => {
  const r = sozlesmeGirdisiSemasi.safeParse({ ...temel, ...ek })
  return r.success ? null : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}

describe('sözleşme şeması: tutarlar', () => {
  it('geçerli girdi kabul edilir', () => {
    expect(alanHatalari({})).toBeNull()
  })

  it('sıfır bedel alan hatası verir (decimal.js isPositive() +0 için true döner)', () => {
    for (const sifir of ['0', '0,00']) {
      expect(alanHatalari({ bedelTutari: sifir }), sifir).toEqual({ bedelTutari: 'Tutar sıfırdan büyük olmalı.' })
    }
  })

  it('sıfır geçiş bedeli alan hatası verir', () => {
    expect(alanHatalari({ gecisTarihi: '2026-06-01', gecisBedeli: '0,00' })).toEqual({ gecisBedeli: 'Tutar sıfırdan büyük olmalı.' })
  })
})
