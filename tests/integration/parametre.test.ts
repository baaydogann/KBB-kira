import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import {
  ParametreYokHatasi, hatirlatmaAyarlari, parametreBitisleri, parametreEkle, parametreGetir, parametreOran,
  statuKurallari, varsayilanEkonomikKod, vergiOranlari,
} from '@/server/parametre/servis'
import { tatilKumesi } from '@/server/tatil/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { TEST_BAGLAMI, temizle } from './yardimci'

beforeEach(async () => {
  await temizle()
  await seedVerisiniYukle(prisma)
})
afterAll(() => prisma.$disconnect())

describe('parametre servisi', () => {
  it('tarihe göre doğru yürürlük kaydını seçer', async () => {
    expect(await parametreGetir('DAMGA_AZAMI', t('2025-06-01'))).toBe('24477478.90')
    expect(await parametreGetir('DAMGA_AZAMI', t('2026-06-01'))).toBe('29115961.10')
    expect((await parametreOran('KDV_GENEL', t('2023-01-01'))).toString()).toBe('18')
    expect((await parametreOran('KDV_GENEL', t('2026-01-01'))).toString()).toBe('20')
    await expect(parametreGetir('DAMGA_AZAMI', t('2027-01-01'))).rejects.toBeInstanceOf(ParametreYokHatasi)
  })

  it('seed idempotenttir', async () => {
    const once = await prisma.parametre.count()
    await seedVerisiniYukle(prisma)
    expect(await prisma.parametre.count()).toBe(once)
  })

  it('statü kuralları ve vergi oranları', async () => {
    const k = await statuKurallari(t('2026-10-15'))
    expect(Object.keys(k)).toHaveLength(8)
    expect(k.SIRKET.kdvli).toBe(true)
    const gmsi = await vergiOranlari('GMSI_GERCEK', t('2026-10-15'))
    expect([gmsi.stopaj.toString(), gmsi.kdv.toString()]).toEqual(['20', '0'])
    const sirket = await vergiOranlari('SIRKET', t('2026-10-15'))
    expect([sirket.stopaj.toString(), sirket.kdv.toString()]).toEqual(['0', '20'])
  })

  it('hatırlatma ayarları ve ekonomik kod', async () => {
    const a = await hatirlatmaAyarlari(t('2026-10-15'))
    expect(a).toMatchObject({ vadeGorunurGun: 7, fesihBildirimGun: 15, tespitOnceAy: 6 })
    expect(await varsayilanEkonomikKod('ARSA', 'DIGER', t('2026-10-15'))).toBe('03.5.5.07')
    expect(await varsayilanEkonomikKod('KONUT', 'LOJMAN', t('2026-10-15'))).toBe('03.5.5.06')
    expect(await varsayilanEkonomikKod('DEPO', 'DEPO', t('2026-10-15'))).toBe('03.5.5.90')
  })

  it('yeni değer eklemek açık önceki kaydı bir gün öncesinde kapatır', async () => {
    await parametreEkle({ anahtar: 'KDV_GENEL', deger: '21', yururlukBaslangic: t('2027-01-01'), yururlukBitis: null, mevzuatDayanagi: null, aciklama: null }, TEST_BAGLAMI)
    expect(await parametreGetir('KDV_GENEL', t('2026-12-31'))).toBe('20')
    expect(await parametreGetir('KDV_GENEL', t('2027-02-01'))).toBe('21')
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'parametre' } })).toBeGreaterThanOrEqual(2)
  })

  it('kapalı aralıkla çakışan ekleme iş kuralı hatası verir', async () => {
    await expect(parametreEkle({ anahtar: 'DAMGA_AZAMI', deger: '1', yururlukBaslangic: t('2026-06-01'), yururlukBitis: null, mevzuatDayanagi: null, aciklama: null }, TEST_BAGLAMI))
      .rejects.toBeInstanceOf(IsKuraliHatasi)
  })

  it('süresi dolmak üzere olan parametreleri listeler', async () => {
    const b = (await parametreBitisleri(t('2026-10-15'))).map((x) => x.anahtar)
    expect(b).toEqual(expect.arrayContaining(['DAMGA_AZAMI', 'TASARRUF_GENELGESI_2024_7', 'TATIL_TAKVIMI_GECERLILIK']))
    expect(b).not.toContain('TBK344_KONUT_SINIR')
    expect(b).not.toContain('KDV_GENEL')
    expect(b).not.toContain('EVDS_SERI_TUFE')
  })
})

describe('tatil servisi', () => {
  it('yalnızca tam gün tatilleri döndürür', async () => {
    expect([...(await tatilKumesi(t('2026-10-01'), t('2026-10-31')))]).toEqual(['2026-10-29'])
    expect((await tatilKumesi(t('2027-05-15'), t('2027-05-19'))).size).toBe(4)
  })
})
