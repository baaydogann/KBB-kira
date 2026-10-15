import { describe, expect, it } from 'vitest'
import { uyumUyarilari } from '@/core/uyum'

const temel = { odemePeriyoduAy: 1, odemeZamani: 'PESIN' as const, artisPeriyoduAy: 12, artisKurali: 'TUFE12' as const, kullanimAmaci: 'DEPO' as const, taslak: false, tasarrufGenelgesiYururlukte: true }

describe('uyumUyarilari (spec §6.9)', () => {
  it('uyumlu sözleşmede uyarı yok', () => expect(uyumUyarilari(temel)).toEqual([]))
  it('3 aydan uzun peşin ve dönem sonu ödeme 2019 genelgesine aykırı', () => {
    expect(uyumUyarilari({ ...temel, odemePeriyoduAy: 12 }).map((u) => u.kod)).toEqual(['GENELGE_ODEME_PERIYODU'])
    expect(uyumUyarilari({ ...temel, odemeZamani: 'DONEM_SONU' }).map((u) => u.kod)).toEqual(['GENELGE_DONEM_SONU'])
  })
  it('12 aydan kısa artış periyodu uyarılır, artış yoksa uyarılmaz', () => {
    expect(uyumUyarilari({ ...temel, artisPeriyoduAy: 6 }).map((u) => u.kod)).toEqual(['ARTIS_PERIYODU_KISA'])
    expect(uyumUyarilari({ ...temel, artisPeriyoduAy: 6, artisKurali: 'YOK' })).toEqual([])
  })
  it('yeni hizmet binası/lojman taslağında tasarruf genelgesi izni hatırlatılır', () => {
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'LOJMAN', taslak: true }).map((u) => u.kod)).toEqual(['TASARRUF_GENELGESI'])
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'HIZMET_BINASI', taslak: true, tasarrufGenelgesiYururlukte: false })).toEqual([])
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'HIZMET_BINASI', taslak: false })).toEqual([])
  })
})

describe('mutasyon kapısı: uyum eşikleri', () => {
  it('3 aylık ödeme periyodu uyarı vermez; 4 aydan itibaren verir', () => {
    expect(uyumUyarilari({ ...temel, odemePeriyoduAy: 3 })).toEqual([])
    expect(uyumUyarilari({ ...temel, odemePeriyoduAy: 4 }).map((u) => u.kod)).toEqual(['GENELGE_ODEME_PERIYODU'])
  })
  it('tasarruf genelgesi uyarısı hizmet binası ve lojman taslağında verilir, diğer kullanım amaçlarında verilmez', () => {
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'HIZMET_BINASI', taslak: true }).map((u) => u.kod)).toEqual(['TASARRUF_GENELGESI'])
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'DEPO', taslak: true })).toEqual([])
    expect(uyumUyarilari({ ...temel, kullanimAmaci: 'LOJMAN', taslak: true, tasarrufGenelgesiYururlukte: false })).toEqual([])
  })
  it('birden çok ihlal birlikte, tanımlı sırayla döner', () => {
    const u = uyumUyarilari({ ...temel, odemePeriyoduAy: 12, odemeZamani: 'DONEM_SONU', artisPeriyoduAy: 6, kullanimAmaci: 'LOJMAN', taslak: true })
    expect(u.map((x) => x.kod)).toEqual(['GENELGE_ODEME_PERIYODU', 'GENELGE_DONEM_SONU', 'ARTIS_PERIYODU_KISA', 'TASARRUF_GENELGESI'])
  })
})
