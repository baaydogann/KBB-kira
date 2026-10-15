import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { tatilEkle, tatilListesi, tatilSil } from '@/server/tatil/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { TEST_BAGLAMI, temizle } from './yardimci'

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

describe('tatil yönetimi', () => {
  it('ekler, listeler, aynı tarihi reddeder, siler ve audit yazar', async () => {
    const id = await tatilEkle({ tarih: t('2028-02-25'), ad: 'Ramazan Bayramı arifesi', yarimGun: true }, TEST_BAGLAMI)
    await expect(tatilEkle({ tarih: t('2028-02-25'), ad: 'Tekrar', yarimGun: false }, TEST_BAGLAMI)).rejects.toBeInstanceOf(IsKuraliHatasi)
    expect(await tatilListesi(2028)).toEqual([{ id, tarih: '2028-02-25', ad: 'Ramazan Bayramı arifesi', yarimGun: true }])
    await tatilSil(id, TEST_BAGLAMI)
    expect(await tatilListesi(2028)).toEqual([])
    expect(await prisma.olayGunlugu.count({ where: { varlik: 'tatil' } })).toBe(2)
  })
})
