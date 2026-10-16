import { taksitDagilimi, type DagilimParcasi, type DagilimSatiri } from '../hesap/dagilim'
import { kesintiHesabi, type Alici22a, type DamgaKalani, type GecerliSorgu, type HacizKalani, type UygulananKesinti } from '../hesap/kesinti'
import { SIFIR, formatTL, topla, type Para } from '../para'
import { enBuyukTarih, formatTarih, gunEkle, icindeMi, karsilastir, type Tarih } from '../tarih'
import type { BedelTuru } from '../tipler'
import type { UyumUyarisi } from '../uyum'
import type { Bulgu, OnKontrolSonucu } from './on-kontrol'

/** Sözleşmenin, taksit dönemiyle kesişen bir malik kaydı; statüsünün paket hesap tarihindeki oranları ve kuralıyla. */
export interface MalikDonemi {
  sozlesmeMalikId: string
  kisiId: string
  kisiAdi: string
  pay: number
  payda: number
  odemeKisiId: string
  ibanId: string | null
  ibanUygun: boolean
  gecerlilikBaslangic: Tarih
  gecerlilikBitis: Tarih | null
  stopajOrani: Para
  kdvOrani: Para
  kdvli: boolean
  stopajli: boolean
  muhsgkKodu: string | null
  teyitGerekli: boolean
  statuTeyitli: boolean
}

export interface PaketTaksitGirdisi {
  taksitId: string
  sozlesmeId: string
  sozlesmeNo: string
  durum: string
  donemBaslangic: Tarih
  donemBitis: Tarih
  vade: Tarih
  tutar: Para
  bedelTuru: BedelTuru
  artisBekliyor: boolean
  bolunsun: boolean
  malikDonemleri: readonly MalikDonemi[]
  uyumUyarilari: readonly UyumUyarisi[]
}

export interface PaketHesapGirdisi {
  taksitler: readonly PaketTaksitGirdisi[]
  damgalar: readonly DamgaKalani[]
  hacizler: readonly HacizKalani[]
  sorgular: readonly GecerliSorgu[]
  esik22aOdeme: Para
  esik22aBorc: Para
  /** `${taksitId}:${kisiId}` */
  faturalar: ReadonlySet<string>
  kalanOdenek: Para | null
  idareVknVar: boolean
}

export interface MalikParcasi { baslangic: Tarih; bitis: Tarih; malikler: readonly MalikDonemi[] }

export interface PaketSatiri extends DagilimSatiri {
  /** `${taksitId}:${parca}:${kisiId}` */
  anahtar: string
  taksitId: string
  sozlesmeId: string
  sozlesmeNo: string
  vade: Tarih
  damga: Para
  haciz: Para
  kesinti22a: Para
  net: Para
  muhsgkKodu: string | null
}

export interface PaketToplami { brut: Para; kdv: Para; stopaj: Para; damga: Para; haciz: Para; kesinti22a: Para; net: Para; gider: Para }

export interface PaketHesabi {
  satirlar: PaketSatiri[]
  kesintiler: UygulananKesinti[]
  alicilar: Alici22a[]
  toplam: PaketToplami
  onKontrol: OnKontrolSonucu
}

type ParcaGirdisi = Pick<PaketTaksitGirdisi, 'donemBaslangic' | 'donemBitis' | 'vade' | 'bolunsun' | 'malikDonemleri'>

const gecerliler = (t: ParcaGirdisi, gun: Tarih): MalikDonemi[] =>
  t.malikDonemleri.filter((m) => icindeMi(gun, { baslangic: m.gecerlilikBaslangic, bitis: m.gecerlilikBitis }))

/** `ilk`ten sonra ve `son`a kadar (dahil) malik kümesinin değişebileceği günler: geçerlilik başlangıçları ve bitişlerin ertesi günü. */
function kesimGunleri(t: ParcaGirdisi, ilk: Tarih, son: Tarih): Tarih[] {
  const gunler = new Set<Tarih>()
  for (const m of t.malikDonemleri) {
    const adaylar = m.gecerlilikBitis === null ? [m.gecerlilikBaslangic] : [m.gecerlilikBaslangic, gunEkle(m.gecerlilikBitis, 1)]
    for (const g of adaylar) if (karsilastir(g, ilk) > 0 && karsilastir(g, son) <= 0) gunler.add(g)
  }
  return [...gunler].sort((a, b) => (karsilastir(a, b) < 0 ? -1 : 1))
}

/**
 * Taksitin malik parçaları (spec §6.4). Bölünmemiş taksitte tek parça; malikleri bakış gününde geçerli kayıtlardır
 * (bakış günü = max(vade, dönem başı): peşin AYIN_GUNU vadesi dönem başından önce düşebilir). Bölünmüş taksitte dönem, malik kümesinin
 * değiştiği günlerde kesilir; aynı kümeli ardışık parçalar birleşir. `degisiklikVar`: [dönem başı, max(dönem bitişi, vade)] içinde küme değişiyor.
 */
export function malikParcalari(t: ParcaGirdisi): { parcalar: MalikParcasi[]; degisiklikVar: boolean } {
  // Her kesim günü kümeyi değiştirir: o gün bir kayıt başlar ya da bir önceki gün biten kayıt düşer (kayıt kimlikleri benzersizdir).
  const degisiklikVar = kesimGunleri(t, t.donemBaslangic, enBuyukTarih(t.donemBitis, t.vade)).length > 0
  if (!t.bolunsun) {
    return { parcalar: [{ baslangic: t.donemBaslangic, bitis: t.donemBitis, malikler: gecerliler(t, enBuyukTarih(t.vade, t.donemBaslangic)) }], degisiklikVar }
  }
  const baslangiclar = [t.donemBaslangic, ...kesimGunleri(t, t.donemBaslangic, t.donemBitis)]
  const parcalar = baslangiclar.map((bas, i) => {
    const sonraki = baslangiclar[i + 1]
    return { baslangic: bas, bitis: sonraki === undefined ? t.donemBitis : gunEkle(sonraki, -1), malikler: gecerliler(t, bas) }
  })
  return { parcalar, degisiklikVar }
}

const donemMetni = (t: PaketTaksitGirdisi) => `${formatTarih(t.donemBaslangic)} – ${formatTarih(t.donemBitis)}`

/** Sıralama anahtarı: vade, sözleşme no, taksit kimliği (sayısal; sıfırla doldurulur). Anahtarlar benzersizdir. */
const taksitSirasi = (t: PaketTaksitGirdisi): string => `${t.vade}|${t.sozlesmeNo}|${t.taksitId.padStart(12, '0')}`

function siraliTaksitler(ts: readonly PaketTaksitGirdisi[]): PaketTaksitGirdisi[] {
  return [...ts].sort((a, b) => (taksitSirasi(a) < taksitSirasi(b) ? -1 : 1))
}

/**
 * Paket hesabı: taksit başına malik parçaları ve dağılım (K3+K4), ardından paket genelinde kesintiler (damga, haciz, 22/A; spec §6.5) ve
 * ön kontrol bulguları (spec §10.1-2). Hatalı taksit atlanır, diğerleri hesaplanır; artış bekleyen taksit önizleme için yine hesaplanır.
 */
export function paketHesabi(g: PaketHesapGirdisi): PaketHesabi {
  const hatalar: Bulgu[] = []
  const uyarilar: Bulgu[] = []
  const tekUyari = new Set<string>()
  const birKez = (anahtar: string, b: Bulgu): void => {
    if (tekUyari.has(anahtar)) return
    tekUyari.add(anahtar)
    uyarilar.push(b)
  }
  if (g.taksitler.length === 0) hatalar.push({ kod: 'BOS_PAKET', mesaj: 'Pakette taksit yok; önce taksit ekleyin.' })
  if (!g.idareVknVar) {
    uyarilar.push({ kod: 'IDARE_VKN_YOK', mesaj: 'İdare VKN parametresi girilmemiş; föyde VKN boş kalır (Yönetim > Parametreler: IDARE_VKN).' })
  }

  const satirlar: PaketSatiri[] = []
  const kisiAdlari = new Map<string, string>()
  for (const t of siraliTaksitler(g.taksitler)) {
    const ozne = { taksitId: t.taksitId, sozlesmeId: t.sozlesmeId }
    for (const u of t.uyumUyarilari) birKez(`UYUM:${t.sozlesmeId}:${u.kod}`, { kod: 'UYUM', mesaj: `${t.sozlesmeNo}: ${u.mesaj}`, sozlesmeId: t.sozlesmeId })
    if (t.durum !== 'PLANLANDI') {
      hatalar.push({ kod: 'TAKSIT_DURUMU', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: taksit ${t.durum} durumunda; paketten çıkarın.`, ...ozne })
      continue
    }
    if (t.artisBekliyor) {
      hatalar.push({ kod: 'ARTIS_BEKLIYOR', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: kira artışı onay bekliyor, tutar kesin değil. Artışı onaylayıp yeniden hesaplayın.`, ...ozne })
    }
    const { parcalar, degisiklikVar } = malikParcalari(t)
    if (degisiklikVar && !t.bolunsun) {
      uyarilar.push({
        kod: 'MALIK_DEGISIKLIGI', ...ozne,
        mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: dönem içinde malik değişiyor; vade günündeki malikler kullanıldı. Gün oranında paylaştırmak için "böl"ü işaretleyin.`,
      })
    }
    if (parcalar.some((p) => p.malikler.length === 0)) {
      hatalar.push({ kod: 'MALIK_YOK', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: bu tarihte geçerli malik yok; malik kayıtlarını düzeltin.`, ...ozne })
      continue
    }
    const dagilimParcalari: DagilimParcasi[] = parcalar.map((p) => ({
      baslangic: p.baslangic, bitis: p.bitis,
      malikler: p.malikler.map((m) => ({
        kisiId: m.kisiId, pay: m.pay, payda: m.payda, sozlesmeMalikId: m.sozlesmeMalikId, odemeKisiId: m.odemeKisiId, ibanId: m.ibanId,
        stopajOrani: m.stopajOrani, kdvOrani: m.kdvOrani,
      })),
    }))
    const dagilim = taksitDagilimi({ tutar: t.tutar, bedelTuru: t.bedelTuru, parcalar: dagilimParcalari })
    if (!dagilim.ok) {
      if (dagilim.hata.kod === 'HISSE_TOPLAMI_HATALI') {
        hatalar.push({ kod: 'HISSE_TOPLAMI', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: malik hisselerinin toplamı 1 değil; malik kayıtlarını düzeltin.`, ...ozne })
      } else {
        hatalar.push({ kod: 'HESAP_HATASI', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: ${dagilim.hata.mesaj}`, ...ozne })
      }
      continue
    }
    const kullanilan = new Map(parcalar.flatMap((p) => p.malikler).map((m) => [m.kisiId, m]))
    for (const m of kullanilan.values()) {
      kisiAdlari.set(m.kisiId, m.kisiAdi)
      if (!m.ibanUygun) {
        hatalar.push({ kod: 'IBAN_YOK', mesaj: `${t.sozlesmeNo}: ${m.kisiAdi} için ödemenin yapılacağı kişiye ait aktif IBAN yok.`, ...ozne, kisiId: m.kisiId })
      }
      if (m.kdvli && !g.faturalar.has(`${t.taksitId}:${m.kisiId}`)) {
        hatalar.push({ kod: 'FATURA_YOK', mesaj: `${t.sozlesmeNo} ${donemMetni(t)}: ${m.kisiAdi} için fatura no ve tarihi girilmedi.`, ...ozne, kisiId: m.kisiId })
      }
      if (m.teyitGerekli && !m.statuTeyitli) {
        birKez(`STATU_TEYIT:${m.kisiId}`, { kod: 'STATU_TEYIT', mesaj: `${m.kisiAdi}: vergi statüsü müşavir teyidi bekliyor.`, kisiId: m.kisiId })
      }
      if (m.stopajli && m.muhsgkKodu === null) {
        birKez(`MUHSGK:${m.kisiId}`, {
          kod: 'MUHSGK_KODU_YOK', mesaj: `${m.kisiAdi}: stopajlı statünün muhtasar ödeme türü kodu belirlenmemiş (müşavir teyidi).`, kisiId: m.kisiId,
        })
      }
    }
    const kodlar = new Map(parcalar.flatMap((p) => p.malikler).map((m) => [m.sozlesmeMalikId, m.muhsgkKodu]))
    for (const d of dagilim.deger) {
      satirlar.push({
        ...d, anahtar: `${t.taksitId}:${d.parca}:${d.kisiId}`, taksitId: t.taksitId, sozlesmeId: t.sozlesmeId, sozlesmeNo: t.sozlesmeNo,
        vade: t.vade, damga: SIFIR, haciz: SIFIR, kesinti22a: SIFIR, net: d.odenecek,
        muhsgkKodu: kodlar.get(d.sozlesmeMalikId) ?? null,
      })
    }
  }

  const kesinti = kesintiHesabi({
    satirlar: satirlar.map((s) => ({ anahtar: s.anahtar, sozlesmeId: s.sozlesmeId, kisiId: s.kisiId, vade: s.vade, odenecek: s.odenecek })),
    damgalar: g.damgalar, hacizler: g.hacizler, sorgular: g.sorgular, esik22aOdeme: g.esik22aOdeme, esik22aBorc: g.esik22aBorc,
  })
  const satirKesintisi = new Map(kesinti.satirlar.map((k) => [k.anahtar, k]))
  const sonSatirlar = satirlar.map((s) => {
    const k = satirKesintisi.get(s.anahtar)!
    return { ...s, damga: k.damga, haciz: k.haciz, kesinti22a: k.kesinti22a, net: k.net, satirlar: [...s.satirlar, ...k.satirlar] }
  })

  for (const a of kesinti.alicilar) {
    if (!a.sorguGerekli || a.borcSorguId !== null) continue
    hatalar.push({
      kod: 'SORGU_22A_YOK', kisiId: a.kisiId,
      mesaj: `${kisiAdlari.get(a.kisiId) ?? a.kisiId}: ödenecek ${formatTL(a.odenecek)} 22/A eşiğini aşıyor; bugün geçerli borç sorgusu yok (6183 md. 22/A).`,
    })
  }
  const satirSozlesmesi = new Map(sonSatirlar.map((s) => [s.anahtar, s]))
  const damgaToplami = new Map<string, Para[]>()
  for (const k of kesinti.kesintiler) {
    if (k.tur !== 'DAMGA') continue
    const s = satirSozlesmesi.get(k.satirAnahtari)!
    damgaToplami.set(s.sozlesmeId, [...(damgaToplami.get(s.sozlesmeId) ?? []), k.tutar])
  }
  for (const [sozlesmeId, tutarlar] of damgaToplami) {
    const no = sonSatirlar.find((s) => s.sozlesmeId === sozlesmeId)!.sozlesmeNo
    uyarilar.push({
      kod: 'DAMGA_KESINTISI', sozlesmeId,
      mesaj: `${no}: damga vergisi ${formatTL(topla(tutarlar))} istihkaktan kesiliyor. Damga sistem dışında ödendiyse Damga sekmesinden kaydı iptal edip yeniden hesaplayın.`,
    })
  }

  const top = (alan: 'brut' | 'kdv' | 'stopaj' | 'damga' | 'haciz' | 'kesinti22a' | 'net') => topla(sonSatirlar.map((s) => s[alan]))
  const toplam: PaketToplami = {
    brut: top('brut'), kdv: top('kdv'), stopaj: top('stopaj'), damga: top('damga'), haciz: top('haciz'), kesinti22a: top('kesinti22a'), net: top('net'),
    gider: top('brut').plus(top('kdv')),
  }
  if (g.kalanOdenek !== null && toplam.gider.greaterThan(g.kalanOdenek)) {
    uyarilar.push({ kod: 'ODENEK_YETERSIZ', mesaj: `Paket gideri ${formatTL(toplam.gider)} kalan ödenekten (${formatTL(g.kalanOdenek)}) fazla.` })
  }
  return { satirlar: sonSatirlar, kesintiler: kesinti.kesintiler, alicilar: kesinti.alicilar, toplam, onKontrol: { hatalar, uyarilar } }
}
