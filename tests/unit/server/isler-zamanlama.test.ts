import { describe, expect, it } from 'vitest'
import {
  EVDS_PENCERESI, GOZETIM_GERI_CEKILME_MS, GOZETIM_TOLERANSI_MS, gozetimKarari, IS_SIRASI, IS_ZAMANLARI, sonZamanlananZaman,
} from '@/server/isler/zamanlama'

const an = (s: string) => new Date(s)

describe('sonZamanlananZaman (Europe/Istanbul)', () => {
  // İstanbul UTC+3 (yaz saati uygulaması yok): 05:30 = 02:30Z, 06:00 = 03:00Z, 17:15 = 14:15Z.
  it('günlük işlerin en son zamanlanmış anı', () => {
    const simdi = an('2026-10-16T09:12:00Z') // 12:12
    expect(sonZamanlananZaman(IS_ZAMANLARI['takvim-guncelle'], simdi)).toEqual(an('2026-10-16T02:30:00Z'))
    expect(sonZamanlananZaman(IS_ZAMANLARI['hatirlatma-uret'], simdi)).toEqual(an('2026-10-16T03:00:00Z'))
  })

  it('zamanlanmış andan önce bir önceki günün anı döner; tam anda kendisi değil bir öncekisi', () => {
    expect(sonZamanlananZaman(IS_ZAMANLARI['takvim-guncelle'], an('2026-10-16T02:29:59Z'))).toEqual(an('2026-10-15T02:30:00Z'))
    expect(sonZamanlananZaman(IS_ZAMANLARI['takvim-guncelle'], an('2026-10-16T02:30:01Z'))).toEqual(an('2026-10-16T02:30:00Z'))
  })

  it('gün sınırı İstanbul takvimine göredir: UTC 21:00 sonrası ertesi İstanbul günüdür', () => {
    // 2026-10-15 21:30Z = 2026-10-16 00:30 İstanbul; son 05:30 hâlâ 15'inde.
    expect(sonZamanlananZaman(IS_ZAMANLARI['takvim-guncelle'], an('2026-10-15T21:30:00Z'))).toEqual(an('2026-10-15T02:30:00Z'))
  })

  it('endeks işi yalnızca ayın 3-10\'u 10:15-17:15 arasında saatlik zamanlanır', () => {
    const e = IS_ZAMANLARI['endeks-cek']
    // Pencere dışı (15 Ekim): 10 Ekim 17:15.
    expect(sonZamanlananZaman(e, an('2026-10-15T09:00:00Z'))).toEqual(an('2026-10-10T14:15:00Z'))
    // Pencere içi (5 Kasım 12:00): aynı gün 11:15.
    expect(sonZamanlananZaman(e, an('2026-11-05T09:00:00Z'))).toEqual(an('2026-11-05T08:15:00Z'))
    // Ayın 3'ü 10:15'ten önce: bir önceki ayın 10'u 17:15.
    expect(sonZamanlananZaman(e, an('2026-11-03T07:00:00Z'))).toEqual(an('2026-10-10T14:15:00Z'))
    // Ay sonu: 30 Kasım'da hâlâ 10 Kasım 17:15.
    expect(sonZamanlananZaman(e, an('2026-11-30T09:00:00Z'))).toEqual(an('2026-11-10T14:15:00Z'))
  })
})

describe('EVDS penceresi', () => {
  it('3-10 aralığı tek yerde tanımlıdır ve endeks çizelgesi ondan türer', () => {
    expect(EVDS_PENCERESI).toEqual({ ilkGun: 3, sonGun: 10 })
    expect(IS_ZAMANLARI['endeks-cek']).toBe('15 10-17 3-10 * *')
  })
})

describe('gozetimKarari', () => {
  const zamanlanan = an('2026-10-16T02:30:00Z')
  const sonra = (dakika: number) => new Date(zamanlanan.getTime() + dakika * 60_000)

  it('zamanlanmış andan sonra başarılı çalışma yoksa çalıştırır', () => {
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(60) })).toBe('calistir')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: an('2026-10-15T02:31:00Z'), simdi: sonra(60) })).toBe('calistir')
  })

  it('zamanlanmış andan sonraki başarılı çalışma işi günceller; tam zamanlanmış anda başlayan da sayılır', () => {
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: an('2026-10-16T02:31:00Z'), simdi: sonra(60) })).toBe('guncel')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: zamanlanan, simdi: sonra(60) })).toBe('guncel')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: an('2026-10-16T02:29:59.999Z'), simdi: sonra(60) })).toBe('calistir')
  })

  it('zamanlanmış an tolerans içindeyse zamanlayıcının tetiklemesi beklenir', () => {
    const tolerans = GOZETIM_TOLERANSI_MS / 60_000
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(0) })).toBe('bekle')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(tolerans - 1) })).toBe('bekle')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(tolerans) })).toBe('calistir')
    // Tolerans içinde bile zamanlayıcı işi bitirdiyse iş günceldir.
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: sonra(1), simdi: sonra(2) })).toBe('guncel')
  })

  it('tolerans parametreyle değiştirilebilir', () => {
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(1), toleransMs: 0 })).toBe('calistir')
    expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: sonra(30), toleransMs: 3_600_000 })).toBe('bekle')
  })

  describe('geri çekilme (HATALI biten işi 2 saat yeniden denememe)', () => {
    const simdi = sonra(180)
    const once = (dakika: number) => new Date(simdi.getTime() - dakika * 60_000)

    it('son çalışması 2 saatten kısa süre önce HATALI başlamışsa geri çekilir', () => {
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: once(1), simdi })).toBe('geri-cekil')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: once(119), simdi })).toBe('geri-cekil')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: new Date(simdi.getTime() - GOZETIM_GERI_CEKILME_MS + 1), simdi })).toBe('geri-cekil')
    })

    it('tam 2 saat ya da daha eskiyse yeniden denenir', () => {
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: once(120), simdi })).toBe('calistir')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: once(600), simdi })).toBe('calistir')
    })

    it('HATALI kaydı yoksa (null/belirsiz) geri çekilme olmaz', () => {
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: null, simdi })).toBe('calistir')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi })).toBe('calistir')
    })

    it('zamanlanmış andan sonra başarı varsa iş güncel kalır (geri çekilme değil)', () => {
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: once(10), sonHatali: once(1), simdi })).toBe('guncel')
    })

    it('zamanlanmış an toleransta ise bekle önceliklidir; açılış turu (tolerans 0) geri çekilmeyi yine uygular', () => {
      const yakin = sonra(2)
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: new Date(yakin.getTime() - 60_000), simdi: yakin })).toBe('bekle')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: new Date(yakin.getTime() - 60_000), simdi: yakin, toleransMs: 0 })).toBe('geri-cekil')
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, simdi: yakin, toleransMs: 0 })).toBe('calistir')
    })

    it('geri çekilme süresi parametreyle değiştirilebilir', () => {
      expect(gozetimKarari({ sonZamanlanan: zamanlanan, sonBasari: null, sonHatali: once(30), simdi, geriCekilmeMs: 10 * 60_000 })).toBe('calistir')
    })
  })

  it('geçmişte zamanlanmış an yoksa karar verilmez', () => {
    expect(gozetimKarari({ sonZamanlanan: null, sonBasari: null, simdi: zamanlanan })).toBe('zamanlama-yok')
  })

  it('gerçek çizelgeyle: kapalı kalan sunucu açılışta yalnızca kaçan işi çalıştırır', () => {
    // Sunucu 05:00-08:00 arası kapalıydı; 08:10'da (İstanbul) açılıyor. Takvim 05:30'da başarılıydı, hatırlatma 06:00'da kaçtı.
    const simdi = an('2026-10-16T05:10:00Z')
    const son: Record<string, Date | null> = {
      'takvim-guncelle': an('2026-10-16T02:30:10Z'),
      'endeks-cek': an('2026-10-10T14:15:20Z'),
      'hatirlatma-uret': an('2026-10-15T03:00:10Z'),
    }
    const kararlar = IS_SIRASI.map((ad) => [ad, gozetimKarari({ sonZamanlanan: sonZamanlananZaman(IS_ZAMANLARI[ad], simdi), sonBasari: son[ad] ?? null, simdi })])
    expect(kararlar).toEqual([['takvim-guncelle', 'guncel'], ['endeks-cek', 'guncel'], ['hatirlatma-uret', 'calistir']])
  })

  it('gözetim sırası takvim, endeks, hatırlatmadır', () => {
    expect(IS_SIRASI).toEqual(['takvim-guncelle', 'endeks-cek', 'hatirlatma-uret'])
  })
})
