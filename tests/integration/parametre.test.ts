import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { tarih as t } from '@/core/tarih'
import {
  ParametreYokHatasi, hatirlatmaAyarlari, parametreBitisleri, parametreEkle, parametreGetir, parametreOran,
  statuKurallari, varsayilanEkonomikKod, vergiOranlari,
} from '@/server/parametre/servis'
import { tatilKumesi } from '@/server/tatil/servis'
import { hatirlatmalariUret } from '@/core/hatirlatma'
import { onayliOranlariYukle } from '@/server/endeks/oranlar'
import { endeksOnayla } from '@/server/endeks/servis'
import { hatirlatmaVerisiYukle } from '@/server/hatirlatma/servis'
import { IsKuraliHatasi } from '@/server/hata'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { PARAMETRELER } from '../../prisma/seed-veri/parametreler'
import { TEST_BAGLAMI, temizle } from './yardimci'

beforeEach(async () => {
  await temizle()
  await seedVerisiniYukle(prisma, { tufeOnayli: true })
})
afterAll(() => prisma.$disconnect())

describe('I9: TÜFE12 tohumu onay bekler', () => {
  const tufe = () => prisma.endeksDegeri.findMany({ where: { seri: 'TUFE_12AY_ORT' }, orderBy: [{ yil: 'asc' }, { ay: 'asc' }] })

  it('varsayılan tohum 24 TÜFE12 değerini onay bekleyen (ELLE, EVDS değeri boş) yükler; onaylanmadan hesapta kullanılmaz, H4 ile listelenir', async () => {
    await temizle()
    await seedVerisiniYukle(prisma)
    const satirlar = await tufe()
    expect(satirlar).toHaveLength(24)
    expect(satirlar.every((e) => e.onayDurumu === 'BEKLIYOR' && e.kaynak === 'ELLE' && e.evdsDegeri === null && e.onayZamani === null)).toBe(true)
    expect((await onayliOranlariYukle()).sonOnayliTufe12).toBeNull()
    const adaylar = hatirlatmalariUret(await prisma.$transaction((tx) => hatirlatmaVerisiYukle(tx, t('2026-10-15'))))
    expect(adaylar.filter((x) => x.kural === 'H4')).toHaveLength(24)
  })

  it('tohum yalnızca eksikleri oluşturur: onaylanmış değer yeniden tohumlamada onay beklemeye dönmez; tufeOnayli seçeneği onaylı yükler', async () => {
    await temizle()
    await seedVerisiniYukle(prisma)
    const [ilk] = await tufe()
    await endeksOnayla(ilk!.id, null, TEST_BAGLAMI)
    await seedVerisiniYukle(prisma)
    const sonra = await tufe()
    expect([sonra.length, sonra.filter((e) => e.onayDurumu === 'ONAYLANDI').map((e) => e.id)]).toEqual([24, [ilk!.id]])
    await temizle()
    await seedVerisiniYukle(prisma, { tufeOnayli: true })
    expect((await tufe()).every((e) => e.onayDurumu === 'ONAYLANDI' && e.onayZamani !== null)).toBe(true)
  })
})

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
    await seedVerisiniYukle(prisma, { tufeOnayli: true })
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

  describe('parametreEkle değer doğrulaması', () => {
    const girdi = (anahtar: string, deger: string) =>
      ({ anahtar, deger, yururlukBaslangic: t('2027-01-01'), yururlukBitis: null, mevzuatDayanagi: null, aciklama: null })

    it.each(['21,5', '1.234,50', '%21', 'abc'])('sayısal parametreye %s girilemez (nokta ondalıklı sayı beklenir)', async (deger) => {
      await expect(parametreEkle(girdi('KDV_GENEL', deger), TEST_BAGLAMI))
        .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER', alan: 'deger' })
      // reddedilen ekleme önceki açık kaydı kapatmamış olmalı
      expect(await parametreGetir('KDV_GENEL', t('2027-02-01'))).toBe('20')
    })

    it('sayısal parametreye nokta ondalıklı değer girilebilir', async () => {
      await parametreEkle(girdi('DAMGA_KIRA_BINDE', '2.5'), TEST_BAGLAMI)
      expect(await parametreGetir('DAMGA_KIRA_BINDE', t('2027-02-01'))).toBe('2.5')
    })

    it('tamsayı olarak okunan parametreye ondalıklı değer girilemez', async () => {
      await expect(parametreEkle(girdi('FARK_VADE_GUN', '7.5'), TEST_BAGLAMI))
        .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER', alan: 'deger' })
      expect(await parametreGetir('FARK_VADE_GUN', t('2027-02-01'))).toBe('10')
      await parametreEkle(girdi('FARK_VADE_GUN', '7'), TEST_BAGLAMI)
      expect(await parametreGetir('FARK_VADE_GUN', t('2027-02-01'))).toBe('7')
    })

    it('parametreTamsayi ile okunan tüm anahtarlar tamsayı kuralına tabidir', async () => {
      const okunanlar = [
        ...PARAMETRELER.map((p) => p.anahtar).filter((a) => a.startsWith('HATIRLATMA_')),
        'TBK347_FESIH_BILDIRIM_GUN', 'TAKVIM_UFUK_AY', 'ARTIS_HESAP_UFUK_GUN', 'FARK_VADE_GUN',
      ]
      expect(new Set(okunanlar).size).toBeGreaterThanOrEqual(15)
      for (const anahtar of new Set(okunanlar)) {
        await expect(parametreEkle(girdi(anahtar, '7.5'), TEST_BAGLAMI), anahtar)
          .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER', alan: 'deger' })
      }
    })

    it('oran olarak okunan parametre değeri tamsayı olsa da ondalıklı girilebilir', async () => {
      await parametreEkle(girdi('KDV_GENEL', '20.5'), TEST_BAGLAMI)
      expect((await parametreOran('KDV_GENEL', t('2027-02-01'))).toString()).toBe('20.5')
      await parametreEkle(girdi('STOPAJ_94_5A', '17.5'), TEST_BAGLAMI)
      expect((await parametreOran('STOPAJ_94_5A', t('2027-02-01'))).toString()).toBe('17.5')
      await parametreEkle(girdi('TBK344_KONUT_SINIR', '25.5'), TEST_BAGLAMI)
      expect(await parametreGetir('TBK344_KONUT_SINIR', t('2027-02-01'))).toBe('25.5')
    })

    it('statü kuralı geçersiz JSON ise reddedilir', async () => {
      await expect(parametreEkle(girdi('STATU_KURALI_GMSI_GERCEK', '{bozuk json'), TEST_BAGLAMI))
        .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER', alan: 'deger' })
    })

    it('statü kuralı şemaya uymuyorsa reddedilir', async () => {
      const gecersizler = [
        '{"stopaj":"STOPAJ_YOK","kdvli":false,"teyitGerekli":false,"muhsgkKodu":"041"}',
        '{"stopaj":null,"kdvli":true}',
        '[]',
      ]
      for (const deger of gecersizler) {
        await expect(parametreEkle(girdi('STATU_KURALI_GMSI_GERCEK', deger), TEST_BAGLAMI))
          .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER', alan: 'deger' })
      }
      expect((await statuKurallari(t('2027-02-01'))).GMSI_GERCEK.stopaj).toBe('STOPAJ_94_5A')
    })

    it('geçerli statü kuralı eklenebilir ve okunabilir', async () => {
      await parametreEkle(
        girdi('STATU_KURALI_GMSI_GERCEK', '{"stopaj":"STOPAJ_94_5B","kdvli":false,"teyitGerekli":true,"muhsgkKodu":"041"}'),
        TEST_BAGLAMI,
      )
      expect((await statuKurallari(t('2027-02-01'))).GMSI_GERCEK).toMatchObject({ stopaj: 'STOPAJ_94_5B', teyitGerekli: true })
      expect((await statuKurallari(t('2026-12-31'))).GMSI_GERCEK).toMatchObject({ stopaj: 'STOPAJ_94_5A', teyitGerekli: false })
    })

    it('bilinmeyen anahtar reddedilir ve kayıt oluşmaz', async () => {
      const once = await prisma.parametre.count()
      await expect(parametreEkle(girdi('KDV_GENELL', '21'), TEST_BAGLAMI))
        .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'ANAHTAR', alan: 'anahtar' })
      expect(await prisma.parametre.count()).toBe(once)
    })

    it('metin parametre serbesttir ancak boş değer reddedilir', async () => {
      await parametreEkle(girdi('EKONOMIK_KOD_DEPO', '03.5.5.91'), TEST_BAGLAMI)
      expect(await parametreGetir('EKONOMIK_KOD_DEPO', t('2027-02-01'))).toBe('03.5.5.91')
      await expect(parametreEkle(girdi('EKONOMIK_KOD_DEPO', '   '), TEST_BAGLAMI))
        .rejects.toMatchObject({ name: 'IsKuraliHatasi', kod: 'DEGER' })
    })
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
