import { describe, expect, it } from 'vitest'
import { tarih as t } from '@/core/tarih'
import { hatirlatmalariUret, type HatirlatmaVerisi, type SozlesmeOzeti } from '@/core/hatirlatma'

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
    ...ek,
  }
}

function veri(ek: Partial<HatirlatmaVerisi> = {}): HatirlatmaVerisi {
  return {
    bugun: t('2026-10-15'), tatiller: new Set(['2026-10-29']), ayarlar: AYAR,
    sozlesmeler: [sozlesme()], planliTaksitler: [], artislar: [], bekleyenEndeksler: [],
    sonOnayliTufe12Ayi: { yil: 2026, ay: 9 }, parametreBitisleri: [], ...ek,
  }
}

const kurallar = (v: HatirlatmaVerisi) => hatirlatmalariUret(v)
const bul = (v: HatirlatmaVerisi, kural: string) => kurallar(v).filter((h) => h.kural === kural)

describe('genel', () => {
  it('görünür tarihi gelmemiş aday dönmez, anahtarlar benzersizdir', () => {
    const v = veri({ planliTaksitler: [{ id: '9', sozlesmeId: '1', vade: t('2026-11-30'), tutar: '10000.00' }] })
    const h = kurallar(v)
    expect(h.every((x) => x.gorunurTarih <= v.bugun)).toBe(true)
    expect(new Set(h.map((x) => x.anahtar)).size).toBe(h.length)
    expect(h.some((x) => x.kural === 'H1')).toBe(false)
  })
})

describe('H1 / H2 ödeme', () => {
  it('vadeye 5 gün: NORMAL; 2 gün: YUKSEK; geçmiş: KRITIK ve H2 yok', () => {
    const taksit = (id: string, vade: string) => ({ id, sozlesmeId: '1', vade: t(vade), tutar: '10000.00' })
    const h = bul(veri({ planliTaksitler: [taksit('1', '2026-10-20'), taksit('2', '2026-10-17'), taksit('3', '2026-10-13')] }), 'H1')
    expect(h.map((x) => [x.iliskiliId, x.oncelik])).toEqual([['1', 'NORMAL'], ['2', 'YUKSEK'], ['3', 'KRITIK']])
    expect(h[2]!.baslik).toContain('Gecikmiş')
    expect(h[0]!.aciklama).toContain('10.000,00 ₺')
    expect(bul(veri({ planliTaksitler: [taksit('3', '2026-10-13')] }), 'H2')).toHaveLength(0)
  })
  it('H2 hedefi vadeden 10 iş günü önce (tatil ve hafta sonu atlanır)', () => {
    const h = bul(veri({ planliTaksitler: [{ id: '7', sozlesmeId: '1', vade: t('2026-10-30'), tutar: '1.00' }] }), 'H2')
    expect(h).toHaveLength(1)
    expect(h[0]!.hedefTarih).toBe('2026-10-15')
    expect(h[0]!.anahtar).toBe('H2:taksit:7:2026-10-15')
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
})

describe('H5 artış', () => {
  const s = sozlesme({ ilkKiraBaslangici: t('2025-11-01'), baslangic: t('2025-11-01'), sonKiraDonemiBaslangici: t('2025-11-01'), artisKurali: 'TUFE12' })
  it('yaklaşan artış NORMAL, hesaplanmış artış YUKSEK + karar, onaylı artış yok', () => {
    expect(bul(veri({ sozlesmeler: [s] }), 'H5')[0]).toMatchObject({ hedefTarih: '2026-11-01', oncelik: 'NORMAL', kararGerekli: false })
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
})
