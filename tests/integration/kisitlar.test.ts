import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
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
    await expect(prisma.taksit.create({ data: temel })).rejects.toThrow()
  })

  it('geçiş bedeli olmadan geçiş tarihi girilemez', async () => {
    await expect(ornekSozlesme({ gecisTarihi: new Date('2026-06-01') })).rejects.toThrow(/sozlesme_gecis/)
  })
})
