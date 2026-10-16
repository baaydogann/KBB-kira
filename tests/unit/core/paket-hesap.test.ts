import { describe, expect, it } from 'vitest'
import { malikParcalari, paketHesabi, type MalikDonemi, type PaketHesapGirdisi, type PaketTaksitGirdisi } from '@/core/paket/hesap'
import type { Bulgu } from '@/core/paket/on-kontrol'
import { para } from '@/core/para'
import { tarih as t } from '@/core/tarih'

function md(kisiId: string, pay: number, payda: number, ek: Partial<MalikDonemi> = {}): MalikDonemi {
  return {
    sozlesmeMalikId: `m${kisiId}`, kisiId, kisiAdi: `Kişi ${kisiId}`, pay, payda, odemeKisiId: kisiId, ibanId: `i${kisiId}`, ibanUygun: true,
    gecerlilikBaslangic: t('2026-01-01'), gecerlilikBitis: null,
    stopajOrani: para('20'), kdvOrani: para('0'), kdvli: false, stopajli: true, muhsgkKodu: '041', teyitGerekli: false, statuTeyitli: false, ...ek,
  }
}
function tk(id: string, ek: Partial<PaketTaksitGirdisi> = {}): PaketTaksitGirdisi {
  return {
    taksitId: id, sozlesmeId: '10', sozlesmeNo: 'S-10', durum: 'PLANLANDI', donemBaslangic: t('2026-03-01'), donemBitis: t('2026-03-31'),
    vade: t('2026-03-01'), tutar: para('3100.00'), bedelTuru: 'BRUT', artisBekliyor: false, bolunsun: false, malikDonemleri: [md('1', 1, 1)], uyumUyarilari: [], ...ek,
  }
}
function g(taksitler: PaketTaksitGirdisi[], ek: Partial<PaketHesapGirdisi> = {}): PaketHesapGirdisi {
  return {
    taksitler, damgalar: [], hacizler: [], sorgular: [], esik22aOdeme: para('5000'), esik22aBorc: para('5000'),
    faturalar: new Set(), kalanOdenek: null, idareVknVar: true, ...ek,
  }
}
const kodlar = (b: Bulgu[]) => b.map((x) => x.kod)
const degisenMalikler = () => [
  md('1', 1, 1, { gecerlilikBitis: t('2026-03-10') }),
  md('2', 1, 1, { gecerlilikBaslangic: t('2026-03-11') }),
]

describe('malikParcalari', () => {
  it('değişiklik yoksa tek parça, degisiklikVar false', () => {
    const p = malikParcalari(tk('1'))
    expect(p.degisiklikVar).toBe(false)
    expect(p.parcalar.map((x) => [x.baslangic, x.bitis, x.malikler.map((m) => m.kisiId)])).toEqual([['2026-03-01', '2026-03-31', ['1']]])
  })
  it('bölünmüş taksit: A nın bitişi ve B nin başlangıcı aynı kesimi üretir; değişmeyen C her iki parçada', () => {
    const p = malikParcalari(tk('1', {
      bolunsun: true,
      malikDonemleri: [
        md('1', 1, 2, { gecerlilikBitis: t('2026-03-10') }), md('2', 1, 2, { gecerlilikBaslangic: t('2026-03-11') }), md('3', 1, 2),
      ],
    }))
    expect(p.parcalar.map((x) => [x.baslangic, x.bitis, x.malikler.map((m) => m.kisiId)])).toEqual([
      ['2026-03-01', '2026-03-10', ['1', '3']], ['2026-03-11', '2026-03-31', ['2', '3']],
    ])
  })
  it('yalnız bitişle değişim (biten kaydın yerine yenisi yok) değişiklik sayılır', () => {
    const p = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2, { gecerlilikBitis: t('2026-03-10') }), md('2', 1, 2)] }))
    expect(p.degisiklikVar).toBe(true)
  })
  it('yalnız başlangıçla değişim (bitişsiz yeni kayıt) değişiklik sayılır', () => {
    const p = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2), md('2', 1, 2, { gecerlilikBaslangic: t('2026-03-11') })] }))
    expect(p.degisiklikVar).toBe(true)
  })
  it('dönem başından önceki değişim sayılmaz; dönemin son günündeki değişim sayılır', () => {
    const once = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2), md('2', 1, 2, { gecerlilikBaslangic: t('2026-02-01'), gecerlilikBitis: t('2026-02-20') })] }))
    expect(once.degisiklikVar).toBe(false)
    const sonGun = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2), md('2', 1, 2, { gecerlilikBaslangic: t('2026-03-31') })] }))
    expect(sonGun.degisiklikVar).toBe(true)
    const baslangicGunu = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2), md('2', 1, 2, { gecerlilikBaslangic: t('2026-03-01') })] }))
    expect(baslangicGunu.degisiklikVar).toBe(false)
  })
  it('vadeden ve dönem sonundan sonraki değişim sayılmaz', () => {
    const p = malikParcalari(tk('1', { malikDonemleri: [md('1', 1, 2), md('2', 1, 2, { gecerlilikBaslangic: t('2026-04-10') })] }))
    expect(p.degisiklikVar).toBe(false)
  })
  it('bölünmüş taksitte parçalar kesim günü sırasıyla (kayıt sırasından bağımsız)', () => {
    const p = malikParcalari(tk('1', {
      bolunsun: true,
      malikDonemleri: [md('3', 1, 1, { gecerlilikBaslangic: t('2026-03-21') }), md('2', 1, 1, { gecerlilikBaslangic: t('2026-03-11'), gecerlilikBitis: t('2026-03-20') }),
        md('1', 1, 1, { gecerlilikBitis: t('2026-03-10') })],
    }))
    expect(p.parcalar.map((x) => [x.baslangic, x.bitis, x.malikler.map((m) => m.kisiId)])).toEqual([
      ['2026-03-01', '2026-03-10', ['1']], ['2026-03-11', '2026-03-20', ['2']], ['2026-03-21', '2026-03-31', ['3']],
    ])
  })
  it('vadeden sonra değişen malik (dönem sonu ödeme) değişiklik sayılır', () => {
    const p = malikParcalari(tk('1', {
      vade: t('2026-04-05'),
      malikDonemleri: [md('1', 1, 1, { gecerlilikBitis: t('2026-04-02') }), md('2', 1, 1, { gecerlilikBaslangic: t('2026-04-03') })],
    }))
    expect(p.degisiklikVar).toBe(true)
    expect(p.parcalar[0]!.malikler.map((m) => m.kisiId)).toEqual(['2'])
  })
})

describe('paketHesabi — malik değişikliği ve bölme (Review Focus #5)', () => {
  it('vade günü malik seti: A 03-10 bitiyor, B 03-11 başlıyor, vade 03-01 → tek parça A, MALIK_DEGISIKLIGI uyarısı', () => {
    const h = paketHesabi(g([tk('1', { malikDonemleri: degisenMalikler() })]))
    expect(h.satirlar.map((s) => [s.kisiId, s.payTutari.toFixed(2), s.brut.toFixed(2), s.stopaj.toFixed(2), s.odenecek.toFixed(2)]))
      .toEqual([['1', '3100.00', '3100.00', '620.00', '2480.00']])
    expect(h.onKontrol.uyarilar.filter((u) => u.kod === 'MALIK_DEGISIKLIGI').map((u) => u.taksitId)).toEqual(['1'])
    expect(h.onKontrol.hatalar).toEqual([])
  })
  it('böl: aynı senaryo bolunsun=true → A 1.000,00 (03-01–10) + B 2.100,00 (03-11–31), uyarı yok', () => {
    const h = paketHesabi(g([tk('1', { malikDonemleri: degisenMalikler(), bolunsun: true })]))
    expect(h.satirlar.map((s) => [s.kisiId, s.parca, s.parcaBaslangic, s.parcaBitis, s.payTutari.toFixed(2)])).toEqual([
      ['1', 0, '2026-03-01', '2026-03-10', '1000.00'], ['2', 1, '2026-03-11', '2026-03-31', '2100.00'],
    ])
    expect(kodlar(h.onKontrol.uyarilar)).not.toContain('MALIK_DEGISIKLIGI')
  })
  it('bakış günü: dönem 2026-01-15–02-14, vade 2026-01-10 (AYIN_GUNU), malik 01-15 te başlıyor → MALIK_YOK değil, malik bulunur', () => {
    const h = paketHesabi(g([tk('1', {
      donemBaslangic: t('2026-01-15'), donemBitis: t('2026-02-14'), vade: t('2026-01-10'), malikDonemleri: [md('1', 1, 1, { gecerlilikBaslangic: t('2026-01-15') })],
    })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual([])
    expect(h.satirlar.map((s) => s.kisiId)).toEqual(['1'])
  })
  it('MALIK_YOK: bölünmüş taksitte bir parçada (boşluk) malik yoksa taksit atlanır', () => {
    const h = paketHesabi(g([tk('1', {
      bolunsun: true, malikDonemleri: [md('1', 1, 1, { gecerlilikBitis: t('2026-03-10') }), md('2', 1, 1, { gecerlilikBaslangic: t('2026-03-15') })],
    })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual(['MALIK_YOK'])
    expect(h.satirlar).toEqual([])
  })
  it('MALIK_YOK: dönemde geçerli malik yoksa taksit atlanır', () => {
    const h = paketHesabi(g([tk('1', { malikDonemleri: [md('1', 1, 1, { gecerlilikBaslangic: t('2026-05-01') })] })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual(['MALIK_YOK'])
    expect(h.satirlar).toEqual([])
  })
})

describe('paketHesabi — hatalar', () => {
  it('IBAN_YOK hata; KDVli malik (SIRKET) faturasız FATURA_YOK, faturalı hatasız', () => {
    const iban = paketHesabi(g([tk('1', { malikDonemleri: [md('1', 1, 1, { ibanUygun: false })] })]))
    expect(iban.onKontrol.hatalar.map((x) => [x.kod, x.kisiId, x.taksitId])).toEqual([['IBAN_YOK', '1', '1']])
    const sirket = md('1', 1, 1, { kdvli: true, stopajli: false, stopajOrani: para('0'), kdvOrani: para('20'), muhsgkKodu: null })
    const faturasiz = paketHesabi(g([tk('1', { malikDonemleri: [sirket] })]))
    expect(faturasiz.onKontrol.hatalar.map((x) => [x.kod, x.kisiId, x.taksitId])).toEqual([['FATURA_YOK', '1', '1']])
    expect(faturasiz.onKontrol.hatalar[0]!.mesaj).toContain('Kişi 1')
    const faturali = paketHesabi(g([tk('1', { malikDonemleri: [sirket] })], { faturalar: new Set(['1:1']) }))
    expect(faturali.onKontrol.hatalar).toEqual([])
    expect(faturali.satirlar[0]!.kdv.toFixed(2)).toBe('620.00')
  })
  it('ARTIS_BEKLIYOR hata ama satırlar hesaplanır', () => {
    const h = paketHesabi(g([tk('1', { artisBekliyor: true })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual(['ARTIS_BEKLIYOR'])
    expect(h.satirlar).toHaveLength(1)
  })
  it('TAKSIT_DURUMU: PAKETTE taksit atlanır, diğer taksit hesaplanır', () => {
    const h = paketHesabi(g([tk('1', { durum: 'PAKETTE' }), tk('2')]))
    expect(h.onKontrol.hatalar.map((x) => [x.kod, x.taksitId, x.mesaj]))
      .toEqual([['TAKSIT_DURUMU', '1', 'S-10 01.03.2026 – 31.03.2026: taksit PAKETTE durumunda; paketten çıkarın.']])
    expect(h.satirlar.map((s) => s.taksitId)).toEqual(['2'])
  })
  it('HISSE_TOPLAMI: tek malik 1/2 → taksit atlanır', () => {
    const h = paketHesabi(g([tk('1', { malikDonemleri: [md('1', 1, 2)] })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual(['HISSE_TOPLAMI'])
    expect(h.satirlar).toEqual([])
  })
  it('HESAP_HATASI: kuruştan küçük tutar', () => {
    const h = paketHesabi(g([tk('1', { tutar: para('1.005') })]))
    expect(kodlar(h.onKontrol.hatalar)).toEqual(['HESAP_HATASI'])
  })
  it('SORGU_22A_YOK: GMSİ 10.000 (ödenecek 8.000) sorgusuz hata; 6.000 (ödenecek 4.800) hatasız', () => {
    const h = paketHesabi(g([tk('1', { tutar: para('10000.00') })]))
    expect(h.onKontrol.hatalar.map((x) => [x.kod, x.kisiId])).toEqual([['SORGU_22A_YOK', '1']])
    expect(h.onKontrol.hatalar[0]!.mesaj).toContain('Kişi 1')
    expect(h.alicilar.map((a) => [a.kisiId, a.sorguGerekli])).toEqual([['1', true]])
    expect(paketHesabi(g([tk('1', { tutar: para('6000.00') })])).onKontrol.hatalar).toEqual([])
  })
  it('aynı kişinin iki sözleşmeden satırları 22/A için toplanır: 4.000 + 4.000 > 5.000 → hata', () => {
    const h = paketHesabi(g([
      tk('1', { tutar: para('5000.00') }),
      tk('2', { tutar: para('5000.00'), sozlesmeId: '11', sozlesmeNo: 'S-11', malikDonemleri: [md('1', 1, 1, { sozlesmeMalikId: 'x1' })] }),
    ]))
    expect(h.onKontrol.hatalar.map((x) => [x.kod, x.kisiId])).toEqual([['SORGU_22A_YOK', '1']])
  })
  it('borç yok sorgusu varsa SORGU_22A_YOK yok; borçlu sorguda kesinti satıra yazılır', () => {
    const h = paketHesabi(g([tk('1', { tutar: para('10000.00') })], {
      sorgular: [{ borcSorguId: '50', kisiId: '1', borcVar: true, borcTutari: para('6000'), kalanBorc: para('6000') }],
    }))
    expect(h.onKontrol.hatalar).toEqual([])
    expect([h.satirlar[0]!.kesinti22a.toFixed(2), h.satirlar[0]!.net.toFixed(2)]).toEqual(['6000.00', '2000.00'])
    expect(h.kesintiler.map((k) => [k.tur, k.satirAnahtari])).toEqual([['KESINTI_22A', h.satirlar[0]!.anahtar]])
    expect(h.satirlar[0]!.satirlar.at(-1)!.aciklama).toBe('Net ödenecek (kesintiler sonrası)')
  })
})

describe('paketHesabi — uyarılar', () => {
  it('ODENEK_YETERSIZ: gider 10.000,00, kalan 9.999,99 uyarı; 10.000,00 uyarı yok', () => {
    const s = [tk('1', { tutar: para('10000.00') })]
    const sorgular = [{ borcSorguId: '50', kisiId: '1', borcVar: false, borcTutari: para('0'), kalanBorc: para('0') }]
    expect(kodlar(paketHesabi(g(s, { sorgular, kalanOdenek: para('9999.99') })).onKontrol.uyarilar)).toEqual(['ODENEK_YETERSIZ'])
    expect(paketHesabi(g(s, { sorgular, kalanOdenek: para('10000.00') })).onKontrol.uyarilar).toEqual([])
  })
  it('STATU_TEYIT ve MUHSGK_KODU_YOK (VAKIF_DERNEK) kişi başına bir kez; UYUM sözleşme başına', () => {
    const vakif = md('1', 1, 1, { teyitGerekli: true, statuTeyitli: false, muhsgkKodu: null })
    const uyum = [{ kod: 'GENELGE_DONEM_SONU' as const, mesaj: 'genelge md. 3' }]
    const h = paketHesabi(g([
      tk('1', { malikDonemleri: [vakif], uyumUyarilari: uyum }),
      tk('2', { malikDonemleri: [vakif], uyumUyarilari: uyum, donemBaslangic: t('2026-04-01'), donemBitis: t('2026-04-30'), vade: t('2026-04-01') }),
    ]))
    expect(kodlar(h.onKontrol.uyarilar).sort()).toEqual(['MUHSGK_KODU_YOK', 'STATU_TEYIT', 'UYUM'])
    expect(h.onKontrol.uyarilar.find((u) => u.kod === 'UYUM')!).toMatchObject({ sozlesmeId: '10', mesaj: 'S-10: genelge md. 3' })
  })
  it('teyitli statü ve kodlu stopaj uyarı üretmez; stopajsız statüde kod aranmaz', () => {
    const h = paketHesabi(g([tk('1', { malikDonemleri: [md('1', 1, 1, { teyitGerekli: true, statuTeyitli: true })] }),
      tk('2', { malikDonemleri: [md('2', 1, 1, { stopajli: false, stopajOrani: para('0'), muhsgkKodu: null })] })]))
    expect(h.onKontrol.uyarilar).toEqual([])
  })
  it('IDARE_VKN_YOK uyarısı; BOS_PAKET hatası', () => {
    expect(kodlar(paketHesabi(g([tk('1')], { idareVknVar: false })).onKontrol.uyarilar)).toEqual(['IDARE_VKN_YOK'])
    const bos = paketHesabi(g([]))
    expect(kodlar(bos.onKontrol.hatalar)).toEqual(['BOS_PAKET'])
    expect(bos.toplam.net.toFixed(2)).toBe('0.00')
  })
  it('DAMGA_KESINTISI: damga payı kesilen sözleşme için bir uyarı; damga yoksa uyarı yok', () => {
    const damgalar = [{ damgaPayiId: '100', sozlesmeId: '10', kisiId: '1', olayTarihi: t('2025-12-20'), kalan: para('226.80') }]
    const h = paketHesabi(g([tk('1'), tk('2', { donemBaslangic: t('2026-04-01'), donemBitis: t('2026-04-30'), vade: t('2026-04-01') })], { damgalar }))
    const u = h.onKontrol.uyarilar.filter((x) => x.kod === 'DAMGA_KESINTISI')
    expect(u.map((x) => [x.sozlesmeId, x.mesaj])).toEqual([
      ['10', 'S-10: damga vergisi 226,80 ₺ istihkaktan kesiliyor. Damga sistem dışında ödendiyse Damga sekmesinden kaydı iptal edip yeniden hesaplayın.'],
    ])
    expect(paketHesabi(g([tk('1')])).onKontrol.uyarilar).toEqual([])
  })
  it('DAMGA_KESINTISI yalnız damga tutarını ve damganın sözleşmesini anar (haciz ayrı)', () => {
    const damgalar = [{ damgaPayiId: '100', sozlesmeId: '11', kisiId: '1', olayTarihi: t('2025-12-20'), kalan: para('100.00') }]
    const hacizler = [{ hacizId: '7', kisiId: '1', tebligTarihi: t('2026-01-10'), kalan: para('50.00') }]
    const h = paketHesabi(g([tk('1'), tk('2', { sozlesmeId: '11', sozlesmeNo: 'S-11', malikDonemleri: [md('1', 1, 1, { sozlesmeMalikId: 'x1' })] })], { damgalar, hacizler }))
    const u = h.onKontrol.uyarilar.filter((x) => x.kod === 'DAMGA_KESINTISI')
    expect(u.map((x) => x.sozlesmeId)).toEqual(['11'])
    expect(u[0]!.mesaj.startsWith('S-11: damga vergisi 100,00 ₺ istihkaktan kesiliyor.')).toBe(true)
  })
})

describe('paketHesabi — toplam ve sıra', () => {
  it('toplamlar ve satır sırası: vade, sözleşme no, taksit, parça, kişi; anahtarlar benzersiz', () => {
    const iki = [md('2', 1, 2), md('1', 1, 2)]
    const h = paketHesabi(g([
      tk('30', { sozlesmeNo: 'S-20', sozlesmeId: '20', vade: t('2026-03-01'), malikDonemleri: [md('5', 1, 1)] }),
      tk('9', { sozlesmeNo: 'S-10', vade: t('2026-03-01'), malikDonemleri: iki }),
      tk('4', { sozlesmeNo: 'S-10', vade: t('2026-02-01'), donemBaslangic: t('2026-02-01'), donemBitis: t('2026-02-28') }),
      tk('10', { sozlesmeNo: 'S-10', vade: t('2026-03-01'), malikDonemleri: [md('1', 1, 1, { kdvli: true, kdvOrani: para('20'), stopajli: false, stopajOrani: para('0') })] }),
    ], { faturalar: new Set(['10:1']) }))
    expect(h.satirlar.map((s) => `${s.taksitId}/${s.kisiId}`)).toEqual(['4/1', '9/1', '9/2', '10/1', '30/5'])
    expect(new Set(h.satirlar.map((s) => s.anahtar)).size).toBe(5)
    expect(h.satirlar.map((s) => s.anahtar)).toEqual(['4:0:1', '9:0:1', '9:0:2', '10:0:1', '30:0:5'])
    expect(h.satirlar.map((s) => s.sozlesmeNo)).toEqual(['S-10', 'S-10', 'S-10', 'S-10', 'S-20'])
    expect(h.satirlar[3]!.muhsgkKodu).toBe('041')
    const tp = h.toplam
    expect([tp.brut, tp.kdv, tp.stopaj, tp.damga, tp.haciz, tp.kesinti22a, tp.net, tp.gider].map((x) => x.toFixed(2)))
      .toEqual(['12400.00', '620.00', '1860.00', '0.00', '0.00', '0.00', '11160.00', '13020.00'])
  })
})
