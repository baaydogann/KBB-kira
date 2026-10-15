import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { para, D } from '@/core/para'
import { tarih as t, ayEkle, gunEkle, type Tarih } from '@/core/tarih'
import { taksitTutari, type KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import type { OdemePeriyodu } from '@/core/tipler'

const kd = (bas: string, bit: string | null, bedel: string, taban: 'AYLIK' | 'YILLIK' = 'AYLIK', id = '1'): KiraDonemiGirdi =>
  ({ id, baslangic: t(bas), bitis: bit === null ? null : t(bit), bedel: para(bedel), taban })

function hesapla(bas: string, bit: string, periyotAy: OdemePeriyodu, donemler: KiraDonemiGirdi[], kist: 'GERCEK_GUN' | 'OTUZ_GUN' = 'GERCEK_GUN', capa = '2026-01-01') {
  const s = taksitTutari({ donem: { baslangic: t(bas), bitis: t(bit) }, periyotAy, kiraAyiCapasi: t(capa), kiraDonemleri: donemler, kist })
  if (!s.ok) throw new Error(s.hata.mesaj)
  return s.deger.tutar.toFixed(2)
}

describe('K1 aylık taban', () => {
  it('tam ay ve üç aylık', () => {
    expect(hesapla('2026-01-01', '2026-01-31', 1, [kd('2026-01-01', null, '10000')])).toBe('10000.00')
    expect(hesapla('2026-01-01', '2026-03-31', 3, [kd('2026-01-01', null, '10000')])).toBe('30000.00')
  })
  it('kıst son dönem: gerçek gün ve 30 gün esası', () => {
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')])).toBe('4838.71')
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')], 'OTUZ_GUN')).toBe('5000.00')
  })
  it('dönem içinde artışla değişen bedel parça parça toplanır', () => {
    const donemler = [kd('2025-01-01', '2026-02-28', '10000', 'AYLIK', '1'), kd('2026-03-01', null, '13339', 'AYLIK', '2')]
    expect(hesapla('2026-01-01', '2026-03-31', 3, donemler, 'GERCEK_GUN', '2025-01-01')).toBe('33339.00')
  })
  it('kira bedeli olmayan gün varsa DONEM_DISI', () => {
    const s = taksitTutari({
      donem: { baslangic: t('2026-01-01'), bitis: t('2026-01-31') }, periyotAy: 1, kiraAyiCapasi: t('2026-01-01'),
      kiraDonemleri: [kd('2026-01-10', null, '10000')], kist: 'GERCEK_GUN',
    })
    expect(!s.ok && s.hata.kod).toBe('DONEM_DISI')
  })
})

describe('K1 yıllık taban', () => {
  it('aylık ödemede 11 × 8.333,33 + son taksit 8.333,37', () => {
    const donemler = [kd('2026-01-01', null, '100000', 'YILLIK')]
    const tutarlar: string[] = []
    for (let i = 0; i < 12; i++) {
      const bas = ayEkle(t('2026-01-01'), i)
      tutarlar.push(hesapla(bas, gunEkle(ayEkle(t('2026-01-01'), i + 1), -1), 1, donemler))
    }
    expect(tutarlar.slice(0, 11).every((x) => x === '8333.33')).toBe(true)
    expect(tutarlar[11]).toBe('8333.37')
  })
  it('üç aylıkta kuruş artığı son taksite', () => {
    const donemler = [kd('2026-01-01', null, '100000.01', 'YILLIK')]
    expect(hesapla('2026-01-01', '2026-03-31', 3, donemler)).toBe('25000.00')
    expect(hesapla('2026-10-01', '2026-12-31', 3, donemler)).toBe('25000.01')
    expect(hesapla('2027-01-01', '2027-03-31', 3, donemler)).toBe('25000.00')
  })
  it('kıst dönemde aylık eşdeğerle hesaplar', () => {
    expect(hesapla('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '120000', 'YILLIK')])).toBe('4838.71')
  })
  it('kira dönemi ödeme dönemine hizalı değilse aylık eşdeğerle hesaplar', () => {
    expect(hesapla('2026-02-01', '2026-02-28', 1, [kd('2026-01-15', null, '120000', 'YILLIK')], 'GERCEK_GUN', '2026-01-01')).toBe('10000.00')
  })
  it('şubat sonunda başlayan sözleşmede ikinci yıl taksitleri bedeli tam toplar', () => {
    const capa = t('2024-02-29')
    const donemler: KiraDonemiGirdi[] = [
      { id: '1', baslangic: capa, bitis: t('2025-02-27'), bedel: para('100000.00'), taban: 'YILLIK' },
      { id: '2', baslangic: ayEkle(capa, 12), bitis: null, bedel: para('100079.20'), taban: 'YILLIK' },
    ]
    let toplam = new D(0)
    for (let i = 0; i < 12; i++) {
      const s = taksitTutari({
        donem: { baslangic: ayEkle(capa, 12 + i), bitis: gunEkle(ayEkle(capa, 13 + i), -1) },
        periyotAy: 1, kiraAyiCapasi: capa, kiraDonemleri: donemler, kist: 'GERCEK_GUN',
      })
      if (!s.ok) throw new Error(s.hata.mesaj)
      toplam = toplam.plus(s.deger.tutar)
    }
    expect(toplam.toFixed(2)).toBe('100079.20')
  })
  it('özellik: bir kira yılındaki taksitlerin toplamı yıllık bedele eşittir', () => {
    fc.assert(fc.property(
      fc.bigInt({ min: 1n, max: 10n ** 11n }),
      fc.constantFrom<OdemePeriyodu>(1, 3, 6, 12),
      fc.date({ min: new Date('2015-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }),
      (kurus, periyot, tarihD) => {
        const bas = t(tarihD.toISOString().slice(0, 10)) as Tarih
        const yillik = new D(kurus.toString()).dividedBy(100)
        const donemler = [{ id: '1', baslangic: bas, bitis: null, bedel: yillik, taban: 'YILLIK' as const }]
        let toplam = new D(0)
        for (let i = 0; i < 12 / periyot; i++) {
          const s = taksitTutari({
            donem: { baslangic: ayEkle(bas, i * periyot), bitis: gunEkle(ayEkle(bas, (i + 1) * periyot), -1) },
            periyotAy: periyot, kiraAyiCapasi: bas, kiraDonemleri: donemler, kist: 'GERCEK_GUN',
          })
          expect(s.ok).toBe(true)
          if (s.ok) {
            expect(s.deger.tutar.isNegative()).toBe(false)
            toplam = toplam.plus(s.deger.tutar)
          }
        }
        expect(toplam.toFixed(2)).toBe(yillik.toFixed(2))
      },
    ))
  })
})

describe('hesap izi', () => {
  it('her sonuç satır listesi içerir ve son satır K1 toplamıdır', () => {
    const s = taksitTutari({
      donem: { baslangic: t('2026-03-01'), bitis: t('2026-03-15') }, periyotAy: 1, kiraAyiCapasi: t('2026-01-01'),
      kiraDonemleri: [kd('2026-01-01', null, '10000')], kist: 'GERCEK_GUN',
    })
    expect(s.ok).toBe(true)
    if (s.ok) {
      expect(s.deger.satirlar.length).toBeGreaterThanOrEqual(2)
      expect(s.deger.satirlar.at(-1)!.sonuc).toBe('4838.71')
      expect(s.deger.satirlar.every((x) => x.kural === 'K1')).toBe(true)
    }
  })
})

describe('mutasyon kapısı: hesap izi satırları ve kenar durumlar', () => {
  function sonuc(bas: string, bit: string, periyotAy: OdemePeriyodu, donemler: KiraDonemiGirdi[], kist: 'GERCEK_GUN' | 'OTUZ_GUN' = 'GERCEK_GUN', capa = '2026-01-01') {
    const s = taksitTutari({ donem: { baslangic: t(bas), bitis: t(bit) }, periyotAy, kiraAyiCapasi: t(capa), kiraDonemleri: donemler, kist })
    if (!s.ok) throw new Error(s.hata.mesaj)
    return s.deger
  }

  it('DONEM_DISI hatası kapsanan ve gerekli gün sayısını taşır', () => {
    const s = taksitTutari({
      donem: { baslangic: t('2026-01-01'), bitis: t('2026-01-31') }, periyotAy: 1, kiraAyiCapasi: t('2026-01-01'),
      kiraDonemleri: [kd('2026-01-10', null, '10000')], kist: 'GERCEK_GUN',
    })
    expect(!s.ok && s.hata.ayrinti).toEqual({ donemGun: 31, kapsananGun: 22 })
  })

  it('tam aylar tek satırda, aylık tabanda ek açıklama olmadan toplanır', () => {
    const r = sonuc('2026-01-01', '2026-03-31', 3, [kd('2026-01-01', null, '10000')])
    expect(r.satirlar).toEqual([
      { kural: 'K1', aciklama: '3 tam kira ayı', formul: '10000 × 3', sonuc: '30000' },
      { kural: 'K1', aciklama: 'Taksit tutarı (kuruşa yarım yukarı)', formul: '30000', sonuc: '30000.00' },
    ])
  })

  it('yıllık tabanda hizasız dönemin tam ayları "(yıllık bedel / 12)" notuyla yazılır', () => {
    const r = sonuc('2026-02-01', '2026-02-28', 1, [kd('2026-01-15', null, '120000', 'YILLIK')])
    expect(r.satirlar[0]).toEqual({ kural: 'K1', aciklama: '1 tam kira ayı (yıllık bedel / 12)', formul: '10000 × 1', sonuc: '10000' })
  })

  it('yalnızca kıst dönemde "tam kira ayı" satırı yoktur; gerçek gün ve 30 gün esası açıklamaları ayrışır', () => {
    const gercek = sonuc('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')])
    expect(gercek.satirlar).toHaveLength(2)
    expect(gercek.satirlar[0]).toEqual({
      kural: 'K1', aciklama: 'Kıst dönem 2026-03-01 – 2026-03-15 (gerçek gün)', formul: '10000 × 15 / 31', sonuc: new D(10000).times(15).dividedBy(31).toString(),
    })
    const otuz = sonuc('2026-03-01', '2026-03-15', 1, [kd('2026-01-01', null, '10000')], 'OTUZ_GUN')
    expect(otuz.satirlar).toHaveLength(2)
    expect(otuz.satirlar[0]).toEqual({
      kural: 'K1', aciklama: 'Kıst dönem 2026-03-01 – 2026-03-15 (30 gün esası)', formul: '10000 × 15 / 30', sonuc: '5000',
    })
  })

  it('tam ay + kıst birlikte: önce tam ay satırı, sonra kıst, sonra toplam', () => {
    const r = sonuc('2026-01-01', '2026-02-15', 3, [kd('2026-01-01', null, '10000')])
    expect(r.satirlar.map((x) => x.aciklama)).toEqual([
      '1 tam kira ayı', 'Kıst dönem 2026-02-01 – 2026-02-15 (gerçek gün)', 'Taksit tutarı (kuruşa yarım yukarı)',
    ])
    expect(r.tutar.toFixed(2)).toBe('15357.14')
  })

  it('dönemin son günü yeni kira ayının ilk gününe denk gelirse o 1 günlük kıst da hesaplanır', () => {
    expect(sonuc('2026-01-01', '2026-02-01', 1, [kd('2026-01-01', null, '10000')]).tutar.toFixed(2)).toBe('10357.14')
  })

  it('yıllık tam dönem taksitinin hesap izi: ara taksit ve kira yılının son taksiti', () => {
    const donemler = [kd('2026-01-01', null, '100000', 'YILLIK')]
    expect(sonuc('2026-01-01', '2026-01-31', 1, donemler).satirlar[0]).toEqual({
      kural: 'K1', aciklama: 'Yıllık bedelin 1/12. taksiti (kuruşa aşağı)', formul: '100000.00 × 1 / 12', sonuc: '8333.33',
    })
    expect(sonuc('2026-12-01', '2026-12-31', 1, donemler).satirlar[0]).toEqual({
      kural: 'K1', aciklama: 'Yıllık bedelin kira yılındaki son taksiti (12/12), kuruş artığı dahil', formul: '100000.00 − 8333.33 × 11', sonuc: '8333.37',
    })
    expect(sonuc('2026-04-01', '2026-06-30', 3, donemler).satirlar[0]).toMatchObject({
      aciklama: 'Yıllık bedelin 2/4. taksiti (kuruşa aşağı)', formul: '100000.00 × 3 / 12', sonuc: '25000.00',
    })
    expect(sonuc('2026-10-01', '2026-12-31', 3, donemler).satirlar[0]).toMatchObject({
      aciklama: 'Yıllık bedelin kira yılındaki son taksiti (4/4), kuruş artığı dahil', formul: '100000.00 − 25000.00 × 3', sonuc: '25000.00',
    })
    expect(sonuc('2026-12-01', '2026-12-31', 1, donemler).satirlar).toHaveLength(2)
  })

  it('yıllık dönemin ödeme dönemi ortasında bitmesi hizalı taksit kısayolunu devre dışı bırakır', () => {
    const donemler = [kd('2026-01-01', '2026-02-14', '120000', 'YILLIK', '1'), kd('2026-02-15', null, '20000', 'AYLIK', '2')]
    // Ocak 10.000 + Şubat 14/28 × 10.000 (5.000) + Şubat 14/28 × 20.000 (10.000) + Mart 20.000
    expect(sonuc('2026-01-01', '2026-03-31', 3, donemler).tutar.toFixed(2)).toBe('45000.00')
  })

  it('ödeme dönemi kira ayı sınırında başlamıyorsa yıllık kısayol kullanılmaz', () => {
    expect(sonuc('2026-01-15', '2026-01-31', 1, [kd('2026-01-01', null, '120000', 'YILLIK')]).tutar.toFixed(2)).toBe('5483.87')
  })

  it('kira dönemi kira ayı sınırında başlamıyorsa yıllık kısayol kullanılmaz (son taksit artığı dağıtılmaz)', () => {
    expect(sonuc('2026-12-01', '2026-12-31', 1, [kd('2026-01-15', null, '100000', 'YILLIK')]).tutar.toFixed(2)).toBe('8333.33')
  })

  it('yıllık kısayol kira döneminin başlangıç ayına göre taksit sırasını bulur', () => {
    // Kira dönemi Mart'ta başlar (s0=2); Şubat 2027 o kira yılının 12. taksitidir.
    expect(sonuc('2027-02-01', '2027-02-28', 1, [kd('2026-03-01', null, '100000', 'YILLIK')]).tutar.toFixed(2)).toBe('8333.37')
  })

  it('kira döneminin başlangıcı ödeme periyoduna oturmuyorsa yıllık kısayol kullanılmaz', () => {
    // 3 aylık taksit Nisan–Haziran; kira dönemi Şubat'ta başlar (2 ay fark, 3'ün katı değil): aylık eşdeğer, yarım kuruş yukarı.
    expect(sonuc('2026-04-01', '2026-06-30', 3, [kd('2026-02-01', null, '100000.02', 'YILLIK')]).tutar.toFixed(2)).toBe('25000.01')
  })
})
