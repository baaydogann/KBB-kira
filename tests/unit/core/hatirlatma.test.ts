import { describe, expect, it } from 'vitest'
import { tarih as t } from '@/core/tarih'
import {
  EKSIK_VERI_BASLIK, OTOMATIK_KURALLAR, TASLAK_HATIRLATMA_GUN, hatirlatmalariUret, type HatirlatmaKurali, type HatirlatmaVerisi, type SozlesmeOzeti, type TaksitOzeti,
} from '@/core/hatirlatma'

const AYAR = {
  vadeGorunurGun: 7, vadeYuksekGun: 3, odemeEmriIsGunu: 10, artisOnceGun: 30, bitisGorunurGun: 90,
  bitisYuksekGun: 60, bitisKritikGun: 30, fesihBildirimGun: 15, fesihSonGunGorunurGun: 15,
  tespitOnceAy: 6, uzama10OnceAy: 3, mevzuatOnceGun: 30,
}

function sozlesme(ek: Partial<SozlesmeOzeti> = {}): SozlesmeOzeti {
  return {
    id: '1', no: 'S-1', kisaAd: 'Meram depo', tasinmazTuru: 'ISYERI',
    baslangic: t('2025-01-01'), bitis: t('2027-12-31'), ilkKiraBaslangici: t('2025-01-01'),
    sonKiraDonemiBaslangici: t('2026-01-01'), uzamaSayisi: 0, artisKurali: 'YOK', artisPeriyoduAy: 12, eksikler: [],
    sonaErmekte: false, bitisEtkin: t('2027-12-31'), ilkDonemArtisBekliyor: false,
    ...ek,
  }
}

function veri(ek: Partial<HatirlatmaVerisi> = {}): HatirlatmaVerisi {
  return {
    bugun: t('2026-10-15'), tatiller: new Set(['2026-10-29']), ayarlar: AYAR,
    sozlesmeler: [sozlesme()], planliTaksitler: [], artislar: [], bekleyenEndeksler: [],
    sonOnayliTufe12Ayi: { yil: 2026, ay: 9 }, parametreBitisleri: [], taslaklar: [], ...ek,
  }
}

function taksit(id: string, vade: string, ek: Partial<TaksitOzeti> = {}): TaksitOzeti {
  return { id, sozlesmeId: '1', sozlesmeNo: 'S-1', kisaAd: 'Meram depo', vade: t(vade), tutar: '10000.00', ...ek }
}

/** Birçok kuralın aynı anda ürettiği, 2026-10-15 itibarıyla görünür adaylar içeren senaryo. */
function zengin(bugun: string): HatirlatmaVerisi {
  return veri({
    bugun: t(bugun),
    sozlesmeler: [sozlesme({
      ilkKiraBaslangici: t('2021-11-01'), baslangic: t('2021-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'),
      bitis: t('2026-12-31'), artisKurali: 'TUFE12', eksikler: ['IBAN_YOK'],
    })],
    planliTaksitler: [
      taksit('1', '2026-10-13'), // gecikmiş: KRITIK, H2 yok
      taksit('2', '2026-10-17'), // 2 gün kala: YUKSEK, H2 görünür
      taksit('3', '2026-11-30'), // gelecek: hiçbiri görünmez
    ],
    bekleyenEndeksler: [{ id: '5', seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 } }],
    sonOnayliTufe12Ayi: { yil: 2026, ay: 7 },
    parametreBitisleri: [{ anahtar: 'DAMGA_AZAMI', yururlukBitis: t('2026-10-31') }],
  })
}

const kurallar = (v: HatirlatmaVerisi) => hatirlatmalariUret(v)
const bul = (v: HatirlatmaVerisi, kural: string) => kurallar(v).filter((h) => h.kural === kural)

describe('genel', () => {
  it('görünür tarihi gelmemiş aday dönmez, anahtarlar benzersizdir', () => {
    const v = zengin('2026-10-15')
    const h = kurallar(v)
    expect(h.length).toBeGreaterThan(0)
    expect(h.every((x) => x.gorunurTarih <= v.bugun)).toBe(true)
    expect(new Set(h.map((x) => x.anahtar)).size).toBe(h.length)
    expect(new Set(h.map((x) => x.kural))).toEqual(
      new Set<HatirlatmaKurali>(['H1', 'H2', 'H4', 'H4_EKSIK', 'H5', 'H6', 'H7', 'H12', 'H13']),
    )
    expect(h.some((x) => x.iliskiliTur === 'taksit' && x.iliskiliId === '3')).toBe(false)
  })
  it('ertesi gün aynı anahtar ve kimlik taşıyan hatırlatmalar değişmez (H12 dahil)', () => {
    const bugunki = kurallar(zengin('2026-10-15'))
    const yarinki = new Map(kurallar(zengin('2026-10-16')).map((x) => [x.anahtar, x]))
    const ortak = bugunki.filter((x) => yarinki.has(x.anahtar))
    expect(ortak.some((x) => x.kural === 'H12')).toBe(true)
    for (const x of ortak) {
      // H12 hedefTarih'i gözlem günüdür (bugün) ve her gün değişir; kimlik alanları sabit kalmalıdır.
      const kimlik = { kural: x.kural, iliskiliId: x.iliskiliId, sozlesmeId: x.sozlesmeId }
      expect(yarinki.get(x.anahtar)).toMatchObject(x.kural === 'H12' ? kimlik : { ...kimlik, hedefTarih: x.hedefTarih })
    }
  })
})

describe('H1 / H2 ödeme', () => {
  it('vadeye 5 gün: NORMAL; 2 gün: YUKSEK; geçmiş: KRITIK ve H2 yok', () => {
    const h = bul(veri({ planliTaksitler: [taksit('1', '2026-10-20'), taksit('2', '2026-10-17'), taksit('3', '2026-10-13')] }), 'H1')
    expect(h.map((x) => [x.iliskiliId, x.oncelik])).toEqual([['1', 'NORMAL'], ['2', 'YUKSEK'], ['3', 'KRITIK']])
    expect(h[2]!.baslik).toContain('Gecikmiş')
    expect(h[0]!.aciklama).toContain('10.000,00 ₺')
    expect(bul(veri({ planliTaksitler: [taksit('3', '2026-10-13')] }), 'H2')).toHaveLength(0)
  })
  it('H2 hedefi vadeden 10 iş günü önce (tatil ve hafta sonu atlanır)', () => {
    const h = bul(veri({ planliTaksitler: [taksit('7', '2026-10-30', { tutar: '1.00' })] }), 'H2')
    expect(h).toHaveLength(1)
    expect(h[0]!.hedefTarih).toBe('2026-10-15')
    expect(h[0]!.anahtar).toBe('H2:taksit:7:2026-10-15')
  })
  it('sözleşme aktif listede olmasa da taksit için H1 ve H2 üretilir', () => {
    const v = veri({
      sozlesmeler: [],
      planliTaksitler: [
        taksit('4', '2026-10-20', { sozlesmeId: '99', sozlesmeNo: 'S-99', kisaAd: 'Eski depo' }),
        taksit('5', '2026-10-13', { sozlesmeId: '99', sozlesmeNo: 'S-99' }),
      ],
    })
    expect(bul(v, 'H1').map((x) => x.iliskiliId)).toEqual(['4', '5'])
    expect(bul(v, 'H1')[0]).toMatchObject({ sozlesmeId: '99', baslik: 'Kira ödemesi — S-99' })
    expect(bul(v, 'H2').map((x) => x.iliskiliId)).toEqual(['4'])
  })
})

describe('öncelik sınırları (dahil)', () => {
  it('H1: vadeye 3 ve 0 gün kala YUKSEK; 1 gün geçmiş KRITIK; 4 gün kala NORMAL', () => {
    const oncelik = (vade: string) => bul(veri({ planliTaksitler: [taksit('1', vade)] }), 'H1')[0]!.oncelik
    expect(oncelik('2026-10-18')).toBe('YUKSEK')
    expect(oncelik('2026-10-15')).toBe('YUKSEK')
    expect(oncelik('2026-10-14')).toBe('KRITIK')
    expect(oncelik('2026-10-19')).toBe('NORMAL')
  })
  it('H6: 30 gün kala KRITIK, 60 gün kala YUKSEK, 61 gün kala NORMAL', () => {
    const oncelik = (bitis: string) => bul(veri({ sozlesmeler: [sozlesme({ bitis: t(bitis) })] }), 'H6')[0]!.oncelik
    expect(oncelik('2026-11-14')).toBe('KRITIK')
    expect(oncelik('2026-12-14')).toBe('YUKSEK')
    expect(oncelik('2026-12-15')).toBe('NORMAL')
  })
  it('H6_SON_GUN son günde görünür, ertesi gün yok', () => {
    const v = (bugun: string) => veri({ bugun: t(bugun), sozlesmeler: [sozlesme({ bitis: t('2026-12-31') })] })
    expect(bul(v('2026-12-16'), 'H6_SON_GUN')).toHaveLength(1)
    expect(bul(v('2026-12-17'), 'H6_SON_GUN')).toHaveLength(0)
  })
})

describe('H4 endeks', () => {
  it('bekleyen endeks için karar gerektiren H4', () => {
    const h = bul(veri({ bekleyenEndeksler: [{ id: '5', seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 } }], sonOnayliTufe12Ayi: { yil: 2026, ay: 8 } }), 'H4')
    expect(h).toHaveLength(1)
    expect(h[0]!.hedefTarih).toBe('2026-10-05')
    expect(h[0]!.kararGerekli).toBe(true)
  })
  it('yayın gününden sonra oran yoksa H4_EKSIK KRITIK', () => {
    const h = bul(veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 8 } }), 'H4_EKSIK')
    expect(h).toHaveLength(1)
    expect(h[0]!.oncelik).toBe('KRITIK')
    expect(bul(veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 8 }, bugun: t('2026-10-05') }), 'H4_EKSIK')).toHaveLength(0)
    expect(bul(veri(), 'H4_EKSIK')).toHaveLength(0)
    expect(bul(veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 8 }, bekleyenEndeksler: [{ id: '5', seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 } }] }), 'H4_EKSIK')).toHaveLength(0)
  })
  it('H4_EKSIK: onaylı son aydan beklenen aya kadar her ay için ayrı hatırlatma', () => {
    const h = bul(veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 7 } }), 'H4_EKSIK')
    expect(h.map((x) => x.anahtar)).toEqual(['H4_EKSIK:endeks:2026-08', 'H4_EKSIK:endeks:2026-09'])
    expect(h[0]).toMatchObject({ oncelik: 'KRITIK', kararGerekli: true, hedefTarih: '2026-09-03', gorunurTarih: '2026-09-04' })
    expect(h[0]!.baslik).toContain('Ağustos 2026')
  })
  it('bekleyen TÜFE kaydı olan ay için H4_EKSIK üretilmez', () => {
    const v = veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 7 }, bekleyenEndeksler: [{ id: '5', seri: 'TUFE_12AY_ORT', ay: { yil: 2026, ay: 9 } }] })
    expect(bul(v, 'H4_EKSIK').map((x) => x.anahtar)).toEqual(['H4_EKSIK:endeks:2026-08'])
  })
  it('H4_EKSIK anahtarları iki ardışık günde aynıdır', () => {
    const anahtarlar = (bugun: string) =>
      bul(veri({ bugun: t(bugun), sonOnayliTufe12Ayi: { yil: 2026, ay: 7 } }), 'H4_EKSIK').map((x) => x.anahtar)
    expect(anahtarlar('2026-10-15')).toEqual(['H4_EKSIK:endeks:2026-08', 'H4_EKSIK:endeks:2026-09'])
    expect(anahtarlar('2026-10-16')).toEqual(anahtarlar('2026-10-15'))
  })
  it('H4_EKSIK en çok son 12 ayı kapsar', () => {
    const h = bul(veri({ sonOnayliTufe12Ayi: { yil: 2020, ay: 1 } }), 'H4_EKSIK')
    expect(h).toHaveLength(12)
    expect(h[0]!.anahtar).toBe('H4_EKSIK:endeks:2025-10')
    expect(h[11]!.anahtar).toBe('H4_EKSIK:endeks:2026-09')
  })
})

describe('H5 artış', () => {
  const s = sozlesme({ ilkKiraBaslangici: t('2025-11-01'), baslangic: t('2025-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'), artisKurali: 'TUFE12' })
  /** Yıllık TÜFE12 artışlı sözleşme; bitis 2026-10-31 (TBK 347 kapsamı ISYERI için artış ufka kadar aranır). */
  const artisli = (ek: Partial<SozlesmeOzeti>) => sozlesme({
    ilkKiraBaslangici: t('2025-11-01'), baslangic: t('2025-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'),
    artisKurali: 'TUFE12', bitis: t('2026-10-31'), ...ek,
  })
  it('yaklaşan artış YUKSEK, hesaplanmış artış YUKSEK + karar, onaylı artış yok', () => {
    expect(bul(veri({ sozlesmeler: [s] }), 'H5')[0]).toMatchObject({ hedefTarih: '2026-11-01', oncelik: 'YUKSEK', kararGerekli: false })
    const hesap = bul(veri({ sozlesmeler: [s], artislar: [{ sozlesmeId: '1', donemBaslangic: t('2026-11-01'), durum: 'HESAPLANDI' }] }), 'H5')[0]!
    expect(hesap.oncelik).toBe('YUKSEK')
    expect(hesap.kararGerekli).toBe(true)
    expect(bul(veri({ sozlesmeler: [s], artislar: [{ sozlesmeId: '1', donemBaslangic: t('2026-11-01'), durum: 'ONAYLANDI' }] }), 'H5')).toHaveLength(0)
  })
  it('son kira dönemi bu tarihi kapsıyorsa yok; geçmiş tarih KRITIK', () => {
    expect(bul(veri({ sozlesmeler: [{ ...s, sonKiraDonemiBaslangici: t('2026-11-01') }] }), 'H5')).toHaveLength(0)
    const gecmis = sozlesme({ ilkKiraBaslangici: t('2025-10-01'), baslangic: t('2025-10-01'), sonKiraDonemiBaslangici: t('2025-10-01'), artisKurali: 'TUFE12' })
    expect(bul(veri({ sozlesmeler: [gecmis] }), 'H5')[0]!.oncelik).toBe('KRITIK')
  })
  it('I3: yenilemenin ayarlanmamış ILK dönemi artış tarihinde başlıyorsa o tarih de hatırlatılır; bayrak yoksa atlanır', () => {
    const yenileme = sozlesme({
      ilkKiraBaslangici: t('2025-11-01'), baslangic: t('2026-11-01'), sonKiraDonemiBaslangici: t('2026-11-01'), artisKurali: 'TUFE12', bitis: t('2027-10-31'),
    })
    expect(bul(veri({ sozlesmeler: [yenileme] }), 'H5')).toHaveLength(0)
    expect(bul(veri({ sozlesmeler: [{ ...yenileme, ilkDonemArtisBekliyor: true }] }), 'H5').map((x) => [x.anahtar, x.baslik]))
      .toEqual([['H5:sozlesme:1:2026-11-01', 'Kira artışı yaklaşıyor — S-1']])
    // Bayrak yalnızca eşitliği açar: son dönemden önceki tarihler yine atlanır.
    const eski = { ...yenileme, ilkKiraBaslangici: t('2024-11-01'), ilkDonemArtisBekliyor: true }
    expect(bul(veri({ sozlesmeler: [eski] }), 'H5').map((x) => x.anahtar)).toEqual(['H5:sozlesme:1:2026-11-01'])
  })
  it('TBK 347 sözleşmesinde bitişten sonra başlayan artış ufka kadar aranır', () => {
    expect(bul(veri({ sozlesmeler: [artisli({})] }), 'H5').map((x) => x.anahtar)).toEqual(['H5:sozlesme:1:2026-11-01'])
  })
  it('arsa sözleşmesinde bitişten sonraki artış aranmaz', () => {
    expect(bul(veri({ sozlesmeler: [artisli({ tasinmazTuru: 'ARSA' })] }), 'H5')).toHaveLength(0)
  })
  it('açık uçlu arsa sözleşmesinde artış ufka kadar aranır', () => {
    expect(bul(veri({ sozlesmeler: [artisli({ tasinmazTuru: 'ARSA', bitis: null })] }), 'H5').map((x) => x.anahtar))
      .toEqual(['H5:sozlesme:1:2026-11-01'])
  })
})

describe('I2: sona ermekte olan sözleşme (ileri tarihli fesih / sona erme)', () => {
  /** Konut: AKTIF iken H5 (2026-11-01), H6 (77 gün), H7 (2026-11-01 tespit) ve H12 üretir. */
  const konut = (ek: Partial<SozlesmeOzeti> = {}) => sozlesme({
    tasinmazTuru: 'KONUT', ilkKiraBaslangici: t('2021-11-01'), baslangic: t('2021-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'),
    bitis: t('2026-12-31'), bitisEtkin: t('2026-12-31'), artisKurali: 'TUFE12', eksikler: ['IBAN_YOK'], ...ek,
  })
  const sozlesmeKurallari = (s: SozlesmeOzeti, bugun = '2026-10-15') =>
    new Set(kurallar(veri({ bugun: t(bugun), sozlesmeler: [s], sonOnayliTufe12Ayi: null })).filter((x) => x.sozlesmeId === '1').map((x) => x.kural))

  it('yalnızca H5 ve H12 üretir; H6 ve H7 üretmez', () => {
    expect(sozlesmeKurallari(konut())).toEqual(new Set(['H5', 'H6', 'H7', 'H12']))
    expect(sozlesmeKurallari(konut({ sonaErmekte: true, bitisEtkin: t('2026-11-10') }))).toEqual(new Set(['H5', 'H12']))
  })

  it('H6_SON_GUN ve H8 üretmez', () => {
    const aktif = sozlesme({ uzamaSayisi: 10, bitis: t('2027-02-28') })
    expect(sozlesmeKurallari(aktif, '2026-11-01')).toEqual(new Set(['H8']))
    expect(sozlesmeKurallari({ ...aktif, sonaErmekte: true, bitisEtkin: t('2026-12-31') }, '2026-11-01')).toEqual(new Set())
    const sonGun = sozlesme({ bitis: t('2026-12-31') })
    expect(sozlesmeKurallari(sonGun, '2026-12-05')).toEqual(new Set(['H6', 'H6_SON_GUN']))
    expect(sozlesmeKurallari({ ...sonGun, sonaErmekte: true, bitisEtkin: t('2026-12-20') }, '2026-12-05')).toEqual(new Set())
  })

  it('artış tarihi etkin bitişe eşit ya da önceyse hatırlatılır, sonraysa hatırlatılmaz (TBK 347 ufku uygulanmaz)', () => {
    const h5 = (bitisEtkin: string) => bul(veri({ sozlesmeler: [konut({ sonaErmekte: true, bitisEtkin: t(bitisEtkin) })] }), 'H5').map((x) => x.anahtar)
    expect(h5('2026-11-01')).toEqual(['H5:sozlesme:1:2026-11-01'])
    expect(h5('2026-10-31')).toEqual([])
  })
})

describe('H6 bitiş', () => {
  it('işyeri: 77 gün kala NORMAL; son gün henüz görünmez', () => {
    const v = veri({ sozlesmeler: [sozlesme({ bitis: t('2026-12-31') })] })
    expect(bul(v, 'H6')[0]!.oncelik).toBe('NORMAL')
    expect(bul(v, 'H6_SON_GUN')).toHaveLength(0)
  })
  it('işyeri: 26 gün kala KRITIK ve fesih son günü uyarısı; son gün geçince yok', () => {
    const v = veri({ bugun: t('2026-12-05'), sozlesmeler: [sozlesme({ bitis: t('2026-12-31') })], sonOnayliTufe12Ayi: { yil: 2026, ay: 11 } })
    expect(bul(v, 'H6')[0]!.oncelik).toBe('KRITIK')
    expect(bul(v, 'H6_SON_GUN')[0]).toMatchObject({ hedefTarih: '2026-12-16', oncelik: 'KRITIK', kararGerekli: true })
    expect(bul({ ...v, bugun: t('2026-12-17') }, 'H6_SON_GUN')).toHaveLength(0)
  })
  it('H6_SON_GUN yasal son gün hafta sonuna denk gelirse hatırlatılan tarih önceki iş günüdür, anahtar yasal günü taşır', () => {
    // 2026-11-22 Pazar; bitis = yasal son gün + 15 gün = 2026-12-07
    const v = veri({ bugun: t('2026-11-20'), sozlesmeler: [sozlesme({ bitis: t('2026-12-07') })] })
    const h = bul(v, 'H6_SON_GUN')
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ anahtar: 'H6_SON_GUN:sozlesme:1:2026-11-22', hedefTarih: '2026-11-20' })
    expect(h[0]!.aciklama).toContain('20.11.2026')
    expect(h[0]!.gorunurTarih).toBe('2026-11-05')
  })
  it('arsa: son gün uyarısı yok; süre dolunca H6_ARSA', () => {
    const v = veri({ bugun: t('2026-12-05'), sozlesmeler: [sozlesme({ tasinmazTuru: 'ARSA', bitis: t('2026-12-31') })], sonOnayliTufe12Ayi: { yil: 2026, ay: 11 } })
    expect(bul(v, 'H6')).toHaveLength(1)
    expect(bul(v, 'H6_SON_GUN')).toHaveLength(0)
    const doldu = veri({ sozlesmeler: [sozlesme({ tasinmazTuru: 'ARSA', bitis: t('2026-10-01') })] })
    expect(bul(doldu, 'H6_ARSA')[0]!.oncelik).toBe('KRITIK')
    expect(bul(doldu, 'H6')).toHaveLength(0)
  })
})

describe('H7 / H8', () => {
  it('5 yıllık tespit 6 ay önce görünür, arsada yok', () => {
    const konut = sozlesme({ tasinmazTuru: 'KONUT', ilkKiraBaslangici: t('2021-12-01') })
    expect(bul(veri({ sozlesmeler: [konut] }), 'H7')[0]!.hedefTarih).toBe('2026-12-01')
    expect(bul(veri({ sozlesmeler: [{ ...konut, tasinmazTuru: 'ARSA' }] }), 'H7')).toHaveLength(0)
  })
  it('10 uzama yılından sonra kiraya veren fesih riski', () => {
    const s = sozlesme({ uzamaSayisi: 10, bitis: t('2027-02-28') })
    expect(bul(veri({ sozlesmeler: [s] }), 'H8')).toHaveLength(0)
    expect(bul(veri({ sozlesmeler: [s], bugun: t('2026-11-01') }), 'H8')[0]!.hedefTarih).toBe('2026-11-28')
  })
  it('I5: uzama sayacı sıfır olsa da ilk kira başlangıcından 10 yıl (120 ay) geçmişse H8 üretilir (göç edilmiş sözleşme)', () => {
    const gocmus = (ilk: string) => sozlesme({ uzamaSayisi: 0, ilkKiraBaslangici: t(ilk), baslangic: t('2026-03-01'), bitis: t('2027-02-28') })
    expect(bul(veri({ sozlesmeler: [gocmus('2014-03-01')], bugun: t('2026-11-01') }), 'H8').map((x) => [x.anahtar, x.hedefTarih]))
      .toEqual([['H8:sozlesme:1:2027-02-28', '2026-11-28']])
    // 3 yıllık sözleşme: yok. Sınır: tam 120 ay dahil, 119 ay hariç.
    expect(bul(veri({ sozlesmeler: [gocmus('2023-03-01')], bugun: t('2026-11-01') }), 'H8')).toHaveLength(0)
    expect(bul(veri({ sozlesmeler: [gocmus('2016-11-01')], bugun: t('2026-11-01') }), 'H8')).toHaveLength(1)
    expect(bul(veri({ sozlesmeler: [gocmus('2016-11-02')], bugun: t('2026-11-01') }), 'H8')).toHaveLength(0)
    // Arsa (TBK 347 dışı) ve belirsiz süreli sözleşmede yine yok; hedef geçince yok.
    expect(bul(veri({ sozlesmeler: [{ ...gocmus('2014-03-01'), tasinmazTuru: 'ARSA' }], bugun: t('2026-11-01') }), 'H8')).toHaveLength(0)
    expect(bul(veri({ sozlesmeler: [{ ...gocmus('2014-03-01'), bitis: null }], bugun: t('2026-11-01') }), 'H8')).toHaveLength(0)
    expect(bul(veri({ sozlesmeler: [gocmus('2014-03-01')], bugun: t('2026-11-29') }), 'H8')).toHaveLength(0)
  })
  it('H8 bildirim son tarihi (hedef) geçince üretilmez', () => {
    const s = sozlesme({ uzamaSayisi: 10, bitis: t('2027-02-28') })
    expect(bul(veri({ sozlesmeler: [s], bugun: t('2026-11-28') }), 'H8')).toHaveLength(1)
    expect(bul(veri({ sozlesmeler: [s], bugun: t('2026-11-29') }), 'H8')).toHaveLength(0)
  })
})

describe('H11 / H12 / H13', () => {
  it('bütçe hatırlatması Eylül ayında', () => {
    expect(bul(veri({ bugun: t('2026-09-10'), sonOnayliTufe12Ayi: { yil: 2026, ay: 8 } }), 'H11')).toHaveLength(1)
    expect(bul(veri(), 'H11')).toHaveLength(0)
  })
  it('eksik veri ve parametre bitişi', () => {
    expect(bul(veri({ sozlesmeler: [sozlesme({ eksikler: ['IBAN_YOK', 'SOZLESME_PDF_YOK'] })] }), 'H12')).toHaveLength(2)
    const p = { anahtar: 'DAMGA_AZAMI', yururlukBitis: t('2026-12-31') }
    expect(bul(veri({ parametreBitisleri: [p] }), 'H13')).toHaveLength(0)
    expect(bul(veri({ parametreBitisleri: [p], bugun: t('2026-12-05'), sonOnayliTufe12Ayi: { yil: 2026, ay: 11 } }), 'H13')).toHaveLength(1)
  })
  it('H13: yürürlük bitişinden önce NORMAL; bittikten bir gün sonra KRITIK ve süresi doldu başlığı', () => {
    const p = { anahtar: 'DAMGA_AZAMI', yururlukBitis: t('2026-12-31') }
    const onceki = bul(veri({ parametreBitisleri: [p], bugun: t('2026-12-31') }), 'H13')[0]!
    expect(onceki).toMatchObject({ oncelik: 'NORMAL', baslik: 'Mevzuat parametresi süresi doluyor — DAMGA_AZAMI' })
    const sonra = bul(veri({ parametreBitisleri: [p], bugun: t('2027-01-01') }), 'H13')[0]!
    expect(sonra).toMatchObject({ oncelik: 'KRITIK', baslik: 'Mevzuat parametresinin süresi doldu — DAMGA_AZAMI', anahtar: onceki.anahtar })
    expect(sonra.aciklama).toContain('yürürlüğü sona erdi')
  })
  it('H13: yürürlük bitişinden 30 gün sonrasına kadar görünür, sonrasında sessiz', () => {
    const p = { anahtar: 'DAMGA_AZAMI', yururlukBitis: t('2026-12-31') }
    expect(bul(veri({ parametreBitisleri: [p], bugun: t('2027-01-30') }), 'H13')).toHaveLength(1)
    expect(bul(veri({ parametreBitisleri: [p], bugun: t('2027-01-31') }), 'H13')).toHaveLength(0)
  })
})

describe('I7: aktifleştirilmemiş taslak', () => {
  const taslak = (baslangic: string) => ({ id: '7', no: 'T-7', kisaAd: 'Meram depo', baslangic: t(baslangic) })

  it('başlangıcına 15 gün kalan taslak için karar gerektiren NORMAL H12; başlangıç geçtiyse KRITIK', () => {
    const [h] = bul(veri({ sozlesmeler: [], taslaklar: [taslak('2026-10-30')] }), 'H12')
    expect(h).toEqual({
      anahtar: 'H12:sozlesme:7:TASLAK_AKTIF_DEGIL', kural: 'H12', iliskiliTur: 'sozlesme', iliskiliId: '7', sozlesmeId: '7',
      baslik: 'Sözleşme taslağı aktifleştirilmedi — T-7',
      aciklama: 'Meram depo: 30.10.2026 tarihinde başlıyor. Taslak aktifleştirilmedikçe taksit planı ve hatırlatmalar oluşmaz.',
      hedefTarih: '2026-10-30', gorunurTarih: '2026-10-15', oncelik: 'NORMAL', kararGerekli: true,
    })
    expect(bul(veri({ sozlesmeler: [], taslaklar: [taslak('2026-10-15')] }), 'H12')[0]).toMatchObject({ oncelik: 'NORMAL' })
    const gecmis = bul(veri({ sozlesmeler: [], taslaklar: [taslak('2026-10-14')] }), 'H12')[0]!
    expect([gecmis.oncelik, gecmis.aciklama]).toEqual(['KRITIK', 'Meram depo: 14.10.2026 tarihinde başladı. Taslak aktifleştirilmedikçe taksit planı ve hatırlatmalar oluşmaz.'])
  })

  it('başlangıcına 15 günden fazla kalan taslak henüz görünmez', () => {
    expect(bul(veri({ sozlesmeler: [], taslaklar: [taslak('2026-10-31')] }), 'H12')).toHaveLength(0)
    expect(TASLAK_HATIRLATMA_GUN).toBe(15)
  })
})

describe('OTOMATIK_KURALLAR', () => {
  const TUM_KURALLAR: Record<HatirlatmaKurali, true> = {
    H1: true, H2: true, H4: true, H4_EKSIK: true, H5: true, H6: true, H6_SON_GUN: true, H6_ARSA: true,
    H7: true, H8: true, H11: true, H12: true, H13: true,
  }
  it('H13 hariç tüm kuralları kapsar', () => {
    const beklenen = (Object.keys(TUM_KURALLAR) as HatirlatmaKurali[]).filter((k) => k !== 'H13')
    expect([...OTOMATIK_KURALLAR].sort()).toEqual([...beklenen].sort())
  })
  it('H13 otomatik kapatılmaz', () => {
    expect(OTOMATIK_KURALLAR).not.toContain('H13')
  })
})

describe('mutasyon kapısı: metinler, karar bayrakları ve tarih sınırları', () => {
  const bir = (v: HatirlatmaVerisi, kural: HatirlatmaKurali) => {
    const h = bul(v, kural)
    expect(h).toHaveLength(1)
    return h[0]!
  }
  const artisliSozlesme = (ek: Partial<SozlesmeOzeti> = {}) => sozlesme({
    ilkKiraBaslangici: t('2025-11-01'), baslangic: t('2025-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'), artisKurali: 'TUFE12', ...ek,
  })

  it('eksik veri başlıkları tanımlı ve H12 başlığı sözleşme numarasıyla birleşir', () => {
    expect(EKSIK_VERI_BASLIK).toEqual({
      IBAN_YOK: "Malik için ödeme IBAN'ı tanımlı değil",
      HISSE_TOPLAMI: 'Malik hisselerinin toplamı 1 değil',
      SOZLESME_PDF_YOK: "Sözleşme PDF'i yüklenmemiş",
      STATU_TEYIT: 'Malik vergi statüsü müşavir teyidi bekliyor',
      ONAY_BELGESI_YOK: 'Onay belgesi bilgisi eksik',
    })
    const h = bul(veri({ sozlesmeler: [sozlesme({ eksikler: ['IBAN_YOK', 'ONAY_BELGESI_YOK'] })] }), 'H12')
    expect(h.map((x) => x.baslik)).toEqual(["Malik için ödeme IBAN'ı tanımlı değil — S-1", 'Onay belgesi bilgisi eksik — S-1'])
    expect(h.every((x) => x.oncelik === 'NORMAL' && x.kararGerekli === false && x.aciklama === 'Meram depo' && x.hedefTarih === '2026-10-15')).toBe(true)
  })

  it('karar gerektirmeyen kurallar kararGerekli=false, gerektirenler true taşır', () => {
    expect(bir(veri({ planliTaksitler: [taksit('1', '2026-10-20')] }), 'H1').kararGerekli).toBe(false)
    expect(bir(veri({ planliTaksitler: [taksit('1', '2026-10-30')] }), 'H2').kararGerekli).toBe(false)
    expect(bir(veri({ sozlesmeler: [sozlesme({ tasinmazTuru: 'KONUT', ilkKiraBaslangici: t('2021-12-01') })] }), 'H7').kararGerekli).toBe(false)
    expect(bir(veri({ sozlesmeler: [sozlesme({ uzamaSayisi: 10, bitis: t('2027-02-28') })], bugun: t('2026-11-01') }), 'H8').kararGerekli).toBe(false)
    expect(bir(veri({ bugun: t('2026-09-10'), sonOnayliTufe12Ayi: { yil: 2026, ay: 8 } }), 'H11').kararGerekli).toBe(false)
    expect(bir(veri({ sozlesmeler: [sozlesme({ eksikler: ['IBAN_YOK'] })] }), 'H12').kararGerekli).toBe(false)
    expect(bir(veri({ sozlesmeler: [sozlesme({ bitis: t('2026-12-31') })] }), 'H6').kararGerekli).toBe(true)
    expect(bir(veri({ sozlesmeler: [sozlesme({ tasinmazTuru: 'ARSA', bitis: t('2026-10-01') })] }), 'H6_ARSA').kararGerekli).toBe(true)
    const p = { anahtar: 'DAMGA_AZAMI', yururlukBitis: t('2026-12-31') }
    expect(bir(veri({ parametreBitisleri: [p], bugun: t('2026-12-05'), sonOnayliTufe12Ayi: { yil: 2026, ay: 11 } }), 'H13').kararGerekli).toBe(true)
    expect(bir(veri({ parametreBitisleri: [p], bugun: t('2027-01-01'), sonOnayliTufe12Ayi: { yil: 2026, ay: 11 } }), 'H13').kararGerekli).toBe(true)
  })

  it('H1 gecikmiş açıklaması gecikme gününü pozitif yazar', () => {
    const h = bir(veri({ planliTaksitler: [taksit('1', '2026-10-13')] }), 'H1')
    expect(h.aciklama).toBe('Meram depo: 10.000,00 ₺, vade 13.10.2026 (2 gün gecikti).')
  })

  it('H4_EKSIK: bekleyen kayıt başka bir seriye aitse TÜFE12 eksikliği yine bildirilir', () => {
    const v = veri({ sonOnayliTufe12Ayi: { yil: 2026, ay: 8 }, bekleyenEndeksler: [{ id: '7', seri: 'YIUFE_12AY_ORT', ay: { yil: 2026, ay: 9 } }] })
    expect(bul(v, 'H4_EKSIK').map((x) => x.anahtar)).toEqual(['H4_EKSIK:endeks:2026-09'])
    expect(bul(v, 'H4').map((x) => x.iliskiliId)).toEqual(['7'])
  })

  it('H4_EKSIK: hiç onaylı TÜFE12 yoksa yalnızca beklenen ay için üretilir', () => {
    expect(bul(veri({ sonOnayliTufe12Ayi: null }), 'H4_EKSIK').map((x) => x.anahtar)).toEqual(['H4_EKSIK:endeks:2026-09'])
  })

  it('H5: artış hükmü olmayan sözleşmede hatırlatma yok', () => {
    expect(bul(veri({ sozlesmeler: [artisliSozlesme()] }), 'H5')).toHaveLength(1)
    expect(bul(veri({ sozlesmeler: [artisliSozlesme({ artisKurali: 'YOK' })] }), 'H5')).toHaveLength(0)
  })

  it('H5: artış kaydı yalnızca aynı sözleşme ve aynı dönem başlangıcı için eşleşir', () => {
    const baslik = (artislar: HatirlatmaVerisi['artislar']) => bir(veri({ sozlesmeler: [artisliSozlesme()], artislar }), 'H5').baslik
    expect(baslik([])).toBe('Kira artışı yaklaşıyor — S-1')
    // Başka sözleşmenin onaylı kaydı bu sözleşmeyi susturmaz.
    expect(baslik([{ sozlesmeId: '2', donemBaslangic: t('2026-11-01'), durum: 'ONAYLANDI' }])).toBe('Kira artışı yaklaşıyor — S-1')
    // Aynı sözleşmenin başka dönemine ait onaylı kayıt bu dönemi susturmaz.
    expect(baslik([{ sozlesmeId: '1', donemBaslangic: t('2025-11-01'), durum: 'ONAYLANDI' }])).toBe('Kira artışı yaklaşıyor — S-1')
    expect(baslik([{ sozlesmeId: '1', donemBaslangic: t('2026-11-01'), durum: 'BEKLEMEDE' }])).toBe('Kira artışı endeks bekleniyor — S-1')
    expect(baslik([{ sozlesmeId: '1', donemBaslangic: t('2026-11-01'), durum: 'HESAPLANDI' }])).toBe('Kira artışı onayınızı bekliyor — S-1')
  })

  it('H5: artış tarihi bugünse KRITIK, gelecekteyse YUKSEK', () => {
    const bugunku = artisliSozlesme({ ilkKiraBaslangici: t('2025-10-15'), baslangic: t('2025-10-15'), sonKiraDonemiBaslangici: t('2025-10-15') })
    expect(bir(veri({ sozlesmeler: [bugunku] }), 'H5')).toMatchObject({ anahtar: 'H5:sozlesme:1:2026-10-15', oncelik: 'KRITIK' })
    expect(bir(veri({ sozlesmeler: [artisliSozlesme()] }), 'H5').oncelik).toBe('YUKSEK')
  })

  it('H6: bitiş bugünse hâlâ hatırlatılır (kalan gün 0 dahil)', () => {
    expect(bir(veri({ sozlesmeler: [sozlesme({ bitis: t('2026-10-15') })] }), 'H6').oncelik).toBe('KRITIK')
  })

  it('arsa: bitiş bugün veya gelecekte H6_ARSA üretmez; yalnızca süre dolunca üretir', () => {
    const arsa = (bitis: string) => bul(veri({ sozlesmeler: [sozlesme({ tasinmazTuru: 'ARSA', bitis: t(bitis) })] }), 'H6_ARSA')
    expect(arsa('2026-10-15')).toHaveLength(0)
    expect(arsa('2026-12-31')).toHaveLength(0)
    expect(arsa('2026-10-14')).toHaveLength(1)
    expect(bul(veri({ sozlesmeler: [sozlesme({ tasinmazTuru: 'ARSA', bitis: t('2026-10-15') })] }), 'H6')).toHaveLength(1)
  })

  it('H7: geçmişte kalan tespit tarihleri atlanır, bugüne denk gelen dahil edilir', () => {
    const konut = (ilk: string) => sozlesme({ tasinmazTuru: 'KONUT', ilkKiraBaslangici: t(ilk) })
    expect(bul(veri({ sozlesmeler: [konut('2016-12-01')] }), 'H7').map((x) => x.anahtar)).toEqual(['H7:sozlesme:1:2026-12-01'])
    expect(bul(veri({ sozlesmeler: [konut('2021-10-15')] }), 'H7').map((x) => x.anahtar)).toEqual(['H7:sozlesme:1:2026-10-15'])
  })

  it('H8: 10 uzama yılına ulaşılmadıysa veya bitiş yoksa üretilmez', () => {
    const v = (ek: Partial<SozlesmeOzeti>) => veri({ bugun: t('2026-11-01'), sozlesmeler: [sozlesme({ bitis: t('2027-02-28'), ...ek })] })
    expect(bul(v({ uzamaSayisi: 9 }), 'H8')).toHaveLength(0)
    expect(bul(v({ uzamaSayisi: 10 }), 'H8')).toHaveLength(1)
    expect(bul(v({ uzamaSayisi: 10, bitis: null }), 'H8')).toHaveLength(0)
  })

  it('H11: bütçe hazırlığı 30 Eylül dahil üretilir, ertesi gün üretilmez; başlık gelecek yılı yazar', () => {
    const son = bir(veri({ bugun: t('2026-09-30'), sonOnayliTufe12Ayi: { yil: 2026, ay: 8 } }), 'H11')
    expect(son.baslik).toBe('2027 kira bütçesi hazırlığı')
    expect(son.hedefTarih).toBe('2026-09-30')
    expect(bul(veri({ bugun: t('2026-10-01'), sonOnayliTufe12Ayi: { yil: 2026, ay: 9 } }), 'H11')).toHaveLength(0)
  })
})
