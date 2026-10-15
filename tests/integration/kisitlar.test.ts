import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/server/db'
import { benzersizIhlaliMi } from '@/server/hata'
import { temizle } from './yardimci'
import { ornekKisi, ornekSozlesme } from './ornekler'

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

describe('veritabanı kısıtları', () => {
  it('aynı sözleşmede kira dönemleri çakışamaz', async () => {
    const s = await ornekSozlesme()
    await prisma.kiraDonemi.create({ data: { sozlesmeId: s.id, baslangic: new Date('2026-01-01'), bitis: null, bedelTutari: '1', bedelTabani: 'AYLIK', kaynak: 'ILK' } })
    await expect(prisma.kiraDonemi.create({ data: { sozlesmeId: s.id, baslangic: new Date('2026-06-01'), bitis: null, bedelTutari: '2', bedelTabani: 'AYLIK', kaynak: 'ARTIS' } }))
      .rejects.toThrow(/kira_donemi_cakismaz/)
  })

  it('parametre yürürlük aralıkları çakışamaz', async () => {
    await prisma.parametre.create({ data: { anahtar: 'X', deger: '1', yururlukBaslangic: new Date('2026-01-01') } })
    await expect(prisma.parametre.create({ data: { anahtar: 'X', deger: '2', yururlukBaslangic: new Date('2026-06-01') } }))
      .rejects.toThrow(/parametre_cakismaz/)
  })

  it('olay günlüğü güncellenemez ve silinemez', async () => {
    const o = await prisma.olayGunlugu.create({ data: { varlik: 'x', varlikId: '1', eylem: 'TEST' } })
    await expect(prisma.olayGunlugu.update({ where: { id: o.id }, data: { eylem: 'DEGISTI' } })).rejects.toThrow(/yalnızca eklemeye/)
    await expect(prisma.olayGunlugu.delete({ where: { id: o.id } })).rejects.toThrow(/yalnızca eklemeye/)
  })

  it('aktif sözleşmede hisse toplamı 1 olmalı; taslakta serbest', async () => {
    const s = await ornekSozlesme()
    const a = await ornekKisi()
    const b = await ornekKisi()
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: a.id, pay: 1, payda: 2, gecerlilikBaslangic: new Date('2026-01-01') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).rejects.toThrow(/HISSE_TOPLAMI_HATALI/)
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: b.id, pay: 1, payda: 2, gecerlilikBaslangic: new Date('2026-01-01') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).resolves.toBeTruthy()
  })

  it('üç eşit üçte bir hisse kabul edilir', async () => {
    const s = await ornekSozlesme()
    for (let i = 0; i < 3; i++) {
      const k = await ornekKisi()
      await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: k.id, pay: 1, payda: 3, gecerlilikBaslangic: new Date('2026-01-01') } })
    }
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).resolves.toBeTruthy()
  })

  it('aynı dönem için iki aktif taksit olamaz; iptal edilen sayılmaz', async () => {
    const s = await ornekSozlesme()
    const temel = { sozlesmeId: s.id, tur: 'NORMAL' as const, donemBaslangic: new Date('2026-01-01'), donemBitis: new Date('2026-01-31'), vadeTarihi: new Date('2026-01-01'), tutar: '1', hesapGoruntusu: {} }
    await prisma.taksit.create({ data: { ...temel, durum: 'IPTAL' } })
    await prisma.taksit.create({ data: temel })
    // Kısmi tekil indeks (taksit_donem_tekil) Prisma'da P2002 + sütun hedefi olarak görünür.
    const hata = await prisma.taksit.create({ data: temel }).catch((e: unknown) => e)
    expect(benzersizIhlaliMi(hata)).toBe(true)
    expect((hata as Prisma.PrismaClientKnownRequestError).meta?.target).toEqual(['sozlesme_id', 'donem_baslangic'])
  })

  it('geçiş bedeli olmadan geçiş tarihi girilemez', async () => {
    await expect(ornekSozlesme({ gecisTarihi: new Date('2026-06-01') })).rejects.toThrow(/sozlesme_gecis/)
  })

  it('geçiş tarihi olmadan geçiş bedeli girilemez', async () => {
    await expect(ornekSozlesme({ gecisBedeli: '5000.00' })).rejects.toThrow(/sozlesme_gecis_cift/)
  })

  it('FARK taksiti ana taksit ve kira dönemine bağlı olmalı; artış hesabı gerekmez', async () => {
    const s = await ornekSozlesme()
    const ana = await prisma.taksit.create({
      data: { sozlesmeId: s.id, tur: 'NORMAL', donemBaslangic: new Date('2026-01-01'), donemBitis: new Date('2026-01-31'), vadeTarihi: new Date('2026-01-01'), tutar: '1', hesapGoruntusu: {} },
    })
    const kd = await prisma.kiraDonemi.create({ data: { sozlesmeId: s.id, baslangic: new Date('2026-01-01'), bitis: null, bedelTutari: '1', bedelTabani: 'AYLIK', kaynak: 'ILK' } })
    const fark = { sozlesmeId: s.id, tur: 'FARK' as const, donemBaslangic: new Date('2026-01-01'), donemBitis: new Date('2026-01-31'), vadeTarihi: new Date('2026-01-01'), tutar: '1', hesapGoruntusu: {} }
    await expect(prisma.taksit.create({ data: fark })).rejects.toThrow(/taksit_fark_baglantili/)
    await expect(prisma.taksit.create({ data: { ...fark, anaTaksitId: ana.id } })).rejects.toThrow(/taksit_fark_baglantili/)
    await expect(prisma.taksit.create({ data: { ...fark, kiraDonemiId: kd.id } })).rejects.toThrow(/taksit_fark_baglantili/)
    await expect(prisma.taksit.create({ data: { ...fark, anaTaksitId: ana.id, kiraDonemiId: kd.id } })).resolves.toMatchObject({ artisHesabiId: null })
  })

  it('aynı ana taksit için aynı kira dönemi en çok bir aktif FARK doğurur; iptal edilen sayılmaz', async () => {
    const s = await ornekSozlesme()
    const ana = await prisma.taksit.create({
      data: { sozlesmeId: s.id, tur: 'NORMAL', donemBaslangic: new Date('2026-01-01'), donemBitis: new Date('2026-01-31'), vadeTarihi: new Date('2026-01-01'), tutar: '1', hesapGoruntusu: {} },
    })
    const kd1 = await prisma.kiraDonemi.create({ data: { sozlesmeId: s.id, baslangic: new Date('2026-01-01'), bitis: new Date('2026-01-14'), bedelTutari: '1', bedelTabani: 'AYLIK', kaynak: 'ILK' } })
    const kd2 = await prisma.kiraDonemi.create({ data: { sozlesmeId: s.id, baslangic: new Date('2026-01-15'), bitis: null, bedelTutari: '2', bedelTabani: 'AYLIK', kaynak: 'TESPIT' } })
    const fark = { sozlesmeId: s.id, tur: 'FARK' as const, anaTaksitId: ana.id, donemBaslangic: new Date('2026-01-01'), donemBitis: new Date('2026-01-31'), vadeTarihi: new Date('2026-01-01'), tutar: '1', hesapGoruntusu: {} }
    const ilk = await prisma.taksit.create({ data: { ...fark, kiraDonemiId: kd1.id } })
    expect(benzersizIhlaliMi(await prisma.taksit.create({ data: { ...fark, kiraDonemiId: kd1.id } }).catch((e: unknown) => e))).toBe(true)
    // Başka bir kira dönemi aynı ana taksit için ayrı FARK doğurabilir.
    await expect(prisma.taksit.create({ data: { ...fark, kiraDonemiId: kd2.id } })).resolves.toBeTruthy()
    await prisma.taksit.update({ where: { id: ilk.id }, data: { durum: 'IPTAL' } })
    await expect(prisma.taksit.create({ data: { ...fark, kiraDonemiId: kd1.id } })).resolves.toBeTruthy()
  })
})

describe('hisse toplamı: bitmiş hisseler ve doğrudan AKTIF ekleme', () => {
  const BASLANGIC = new Date('2026-01-01')

  it('tek malikin hissesi sözleşme bitmeden bitip yerine kimse gelmezse reddedilir', async () => {
    const s = await ornekSozlesme()
    const a = await ornekKisi()
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: a.id, pay: 1, payda: 1, gecerlilikBaslangic: BASLANGIC, gecerlilikBitis: new Date('2026-06-30') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).rejects.toThrow(/HISSE_TOPLAMI_HATALI/)
  })

  it('yarım hisse sözleşme ortasında bitip yerine kimse gelmezse reddedilir', async () => {
    const s = await ornekSozlesme()
    const a = await ornekKisi()
    const b = await ornekKisi()
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: a.id, pay: 1, payda: 2, gecerlilikBaslangic: BASLANGIC } })
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: b.id, pay: 1, payda: 2, gecerlilikBaslangic: BASLANGIC, gecerlilikBitis: new Date('2026-06-30') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).rejects.toThrow(/HISSE_TOPLAMI_HATALI/)
  })

  it('devir kabul edilir: eski malik D-1 günü biter, yeni malik D günü başlar', async () => {
    const s = await ornekSozlesme()
    const eski = await ornekKisi()
    const yeni = await ornekKisi()
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: eski.id, pay: 1, payda: 1, gecerlilikBaslangic: BASLANGIC, gecerlilikBitis: new Date('2026-06-30') } })
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: yeni.id, pay: 1, payda: 1, gecerlilikBaslangic: new Date('2026-07-01') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).resolves.toBeTruthy()
  })

  it('hisse tam sözleşme bitiş gününde biterse kabul edilir', async () => {
    const s = await ornekSozlesme()
    const a = await ornekKisi()
    await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: a.id, pay: 1, payda: 1, gecerlilikBaslangic: BASLANGIC, gecerlilikBitis: new Date('2026-12-31') } })
    await expect(prisma.sozlesme.update({ where: { id: s.id }, data: { durum: 'AKTIF' } })).resolves.toBeTruthy()
  })

  it('maliksiz sözleşme doğrudan AKTIF eklenemez', async () => {
    await expect(ornekSozlesme({ durum: 'AKTIF' })).rejects.toThrow(/HISSE_TOPLAMI_HATALI/)
  })
})
