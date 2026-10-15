import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { sihirbazSecenekleri, sozlesmeDetayi, sozlesmeListesi, sozlesmeTaslakFormu } from '@/server/sozlesme/sorgu'
import { TEST_BAGLAMI, temizle } from './yardimci'
import { girdi, hazirlik, type Hazirlik } from './sozlesme-yardimci'

let h: Hazirlik
beforeEach(async () => {
  await temizle()
  h = await hazirlik()
})
afterAll(() => prisma.$disconnect())

describe('sözleşme sorguları', () => {
  it('liste güncel bedeli ve bitişe kalan günü verir; durum ve aramayla süzer', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { sozlesmeNo: 'MRM-001', odemePeriyoduAy: 12 }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
    await sozlesmeTaslakKaydet(girdi(h, { sozlesmeNo: 'TSL-002' }), TEST_BAGLAMI)
    const tum = await sozlesmeListesi({}, t('2026-10-15'))
    expect(tum).toHaveLength(2)
    const a = tum.find((s) => s.sozlesmeNo === 'MRM-001')!
    expect([a.guncelBedel, a.kalanGun]).toEqual(['10000.00', 77])
    expect((await sozlesmeListesi({ durum: 'TASLAK' })).map((s) => s.sozlesmeNo)).toEqual(['TSL-002'])
    expect((await sozlesmeListesi({ q: 'mrm' })).map((s) => s.sozlesmeNo)).toEqual(['MRM-001'])
  })

  it('detay uyum uyarılarını ve tüm sekmelerin verisini içerir', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { odemePeriyoduAy: 12 }), TEST_BAGLAMI)
    await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))
    const d = await sozlesmeDetayi(id, t('2026-10-15'))
    expect(d.uyarilar.map((u) => u.kod)).toEqual(['GENELGE_ODEME_PERIYODU'])
    expect(d.taksitler).toHaveLength(1)
    expect(d.kiraDonemleri).toHaveLength(1)
    expect(d.malikler).toHaveLength(1)
    expect(d.olaylar.some((o) => o.eylem === 'AKTIFLESTIR')).toBe(true)
  })

  it('taslak formu sihirbazın beklediği biçimde döner', async () => {
    const id = await sozlesmeTaslakKaydet(girdi(h, { bedelTutari: '12.345,67' }), TEST_BAGLAMI)
    const f = await sozlesmeTaslakFormu(id)
    expect(f.veri.bedelTutari).toBe('12.345,67')
    expect(f.veri.baslangic).toBe('2026-01-01')
    expect(f.veri.malikler).toEqual([{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null }])
    const sec = await sihirbazSecenekleri()
    expect(sec.kisiler.find((k) => k.id === h.kisiA)?.ibanlar).toHaveLength(1)
  })
})
