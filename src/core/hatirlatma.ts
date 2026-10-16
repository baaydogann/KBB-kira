import { formatTL, para } from './para'
import { artisTarihleri, tespitTarihleri } from './takvim'
import {
  ayAdi, ayAnahtari, ayEkle, ayFarki, ayKaydir, birlestir, enKucukTarih, formatTarih, gunEkle, gunFarki,
  isGunuEkle, isGunuMu, karsilastir, parcala, sonrakiIsGunu, tarihinAyi, type Ay, type Tarih,
} from './tarih'
import { tbk347KapsamindaMi, type ArtisKurali, type TasinmazTuru } from './tipler'

export type Oncelik = 'KRITIK' | 'YUKSEK' | 'NORMAL'
export type HatirlatmaKurali =
  | 'H1' | 'H2' | 'H4' | 'H4_EKSIK' | 'H5' | 'H6' | 'H6_SON_GUN' | 'H6_ARSA' | 'H7' | 'H8' | 'H11' | 'H12' | 'H13'
/** Üretici bunları kendiliğinden kapatabilir. H13 (mevzuat parametresi) kullanıcı tamamlayana kadar açık kalır. */
export const OTOMATIK_KURALLAR: readonly HatirlatmaKurali[] = [
  'H1', 'H2', 'H4', 'H4_EKSIK', 'H5', 'H6', 'H6_SON_GUN', 'H6_ARSA', 'H7', 'H8', 'H11', 'H12',
]
export type IliskiliTur = 'sozlesme' | 'taksit' | 'endeks' | 'parametre' | 'sistem'

export interface HatirlatmaAdayi {
  anahtar: string
  kural: HatirlatmaKurali
  iliskiliTur: IliskiliTur
  iliskiliId: string
  sozlesmeId: string | null
  baslik: string
  aciklama: string
  hedefTarih: Tarih
  gorunurTarih: Tarih
  oncelik: Oncelik
  kararGerekli: boolean
}

export interface HatirlatmaAyarlari {
  vadeGorunurGun: number
  vadeYuksekGun: number
  odemeEmriIsGunu: number
  artisOnceGun: number
  bitisGorunurGun: number
  bitisYuksekGun: number
  bitisKritikGun: number
  fesihBildirimGun: number
  fesihSonGunGorunurGun: number
  tespitOnceAy: number
  uzama10OnceAy: number
  mevzuatOnceGun: number
}

export type EksikVeri = 'IBAN_YOK' | 'HISSE_TOPLAMI' | 'SOZLESME_PDF_YOK' | 'STATU_TEYIT' | 'ONAY_BELGESI_YOK'
export const EKSIK_VERI_BASLIK: Record<EksikVeri, string> = {
  IBAN_YOK: "Malik için ödeme IBAN'ı tanımlı değil",
  HISSE_TOPLAMI: 'Malik hisselerinin toplamı 1 değil',
  SOZLESME_PDF_YOK: "Sözleşme PDF'i yüklenmemiş",
  STATU_TEYIT: 'Malik vergi statüsü müşavir teyidi bekliyor',
  ONAY_BELGESI_YOK: 'Onay belgesi bilgisi eksik',
}

export interface SozlesmeOzeti {
  id: string
  no: string
  kisaAd: string
  tasinmazTuru: TasinmazTuru
  baslangic: Tarih
  bitis: Tarih | null
  ilkKiraBaslangici: Tarih
  sonKiraDonemiBaslangici: Tarih
  uzamaSayisi: number
  artisKurali: ArtisKurali
  artisPeriyoduAy: number
  eksikler: EksikVeri[]
  /**
   * İleri tarihli fesih ya da sona erme (FESHEDILDI/SONA_ERDI, etkin bitiş bugün veya sonra; bkz. `artisYururlugu`). Böyle sözleşmede
   * yalnızca etkin bitişe kadar başlayan artışlar (H5) ve eksik veri (H12) hatırlatılır; bitiş, uzama ve tespit kuralları susar.
   */
  sonaErmekte: boolean
  /** Fesih tarihi, yoksa sözleşme bitişi (belirsiz sürelide null). */
  bitisEtkin: Tarih | null
  /**
   * Yenilemenin tek kira dönemi başlangıçtaki, henüz artışla ayarlanmamış ILK dönemdir: o başlangıç bir artış tarihiyse
   * (kira yılı sınırında başlayan yenileme) artışı bekleniyor; onaylanınca ILK dönemin bedeli değişir.
   */
  ilkDonemArtisBekliyor: boolean
}
export interface TaksitOzeti {
  id: string
  sozlesmeId: string
  sozlesmeNo: string
  kisaAd: string
  vade: Tarih
  tutar: string
}
/** Aktifleştirilmemiş sözleşme taslağı (loader yalnızca başlangıcına `TASLAK_HATIRLATMA_GUN` ya da daha az kalanları verir). */
export interface TaslakOzeti { id: string; no: string; kisaAd: string; baslangic: Tarih }
/** Taslak hatırlatması başlangıçtan bu kadar gün önce görünür. */
export const TASLAK_HATIRLATMA_GUN = 15
export interface ArtisOzeti { sozlesmeId: string; donemBaslangic: Tarih; durum: 'BEKLEMEDE' | 'HESAPLANDI' | 'ONAYLANDI' }
export interface EndeksOzeti { id: string; seri: string; ay: Ay }
/** Yürürlük kaydı. Loader her anahtar için yalnızca ardılı olmayan (en son) yürürlük kaydını verir. */
export interface ParametreBitisi { anahtar: string; yururlukBitis: Tarih }

export interface HatirlatmaVerisi {
  bugun: Tarih
  tatiller: ReadonlySet<string>
  ayarlar: HatirlatmaAyarlari
  sozlesmeler: readonly SozlesmeOzeti[]
  planliTaksitler: readonly TaksitOzeti[]
  artislar: readonly ArtisOzeti[]
  bekleyenEndeksler: readonly EndeksOzeti[]
  sonOnayliTufe12Ayi: Ay | null
  parametreBitisleri: readonly ParametreBitisi[]
  taslaklar: readonly TaslakOzeti[]
}

type Ekle = (a: HatirlatmaAdayi) => void

export function hatirlatmalariUret(v: HatirlatmaVerisi): HatirlatmaAdayi[] {
  const sonuc: HatirlatmaAdayi[] = []
  const ekle: Ekle = (a) => {
    if (karsilastir(a.gorunurTarih, v.bugun) <= 0) sonuc.push(a)
  }
  odemeKurallari(v, ekle)
  endeksKurallari(v, ekle)
  for (const s of v.sozlesmeler) sozlesmeKurallari(v, s, ekle)
  for (const s of v.taslaklar) taslakKurali(v, s, ekle)
  sistemKurallari(v, ekle)
  return sonuc
}

function odemeKurallari(v: HatirlatmaVerisi, ekle: Ekle): void {
  const a = v.ayarlar
  for (const t of v.planliTaksitler) {
    const kalan = gunFarki(v.bugun, t.vade)
    const gecikmis = kalan < 0
    ekle({
      anahtar: `H1:taksit:${t.id}:${t.vade}`, kural: 'H1', iliskiliTur: 'taksit', iliskiliId: t.id, sozlesmeId: t.sozlesmeId,
      baslik: gecikmis ? `Gecikmiş kira ödemesi — ${t.sozlesmeNo}` : `Kira ödemesi — ${t.sozlesmeNo}`,
      aciklama: `${t.kisaAd}: ${formatTL(para(t.tutar))}, vade ${formatTarih(t.vade)}${gecikmis ? ` (${-kalan} gün gecikti)` : ''}.`,
      hedefTarih: t.vade, gorunurTarih: gunEkle(t.vade, -a.vadeGorunurGun),
      oncelik: gecikmis ? 'KRITIK' : kalan <= a.vadeYuksekGun ? 'YUKSEK' : 'NORMAL', kararGerekli: false,
    })
    if (gecikmis) continue
    const hedef = isGunuEkle(t.vade, -a.odemeEmriIsGunu, v.tatiller)
    ekle({
      anahtar: `H2:taksit:${t.id}:${hedef}`, kural: 'H2', iliskiliTur: 'taksit', iliskiliId: t.id, sozlesmeId: t.sozlesmeId,
      baslik: `Ödeme emri hazırla — ${t.sozlesmeNo}`,
      aciklama: `${t.kisaAd}: ${formatTarih(t.vade)} vadeli taksit için ödeme emri hazırlığı.`,
      hedefTarih: hedef, gorunurTarih: hedef, oncelik: 'YUKSEK', kararGerekli: false,
    })
  }
}

function yayinGunu(ay: Ay, tatiller: ReadonlySet<string>): Tarih {
  return sonrakiIsGunu(birlestir(ay.yil, ay.ay, 3), tatiller)
}

function endeksKurallari(v: HatirlatmaVerisi, ekle: Ekle): void {
  for (const e of v.bekleyenEndeksler) {
    const hedef = yayinGunu(ayKaydir(e.ay, 1), v.tatiller)
    ekle({
      anahtar: `H4:endeks:${e.id}:${ayAnahtari(e.ay)}`, kural: 'H4', iliskiliTur: 'endeks', iliskiliId: e.id, sozlesmeId: null,
      baslik: `Endeks onayı bekliyor — ${e.seri} ${ayAdi(e.ay)}`,
      aciklama: 'EVDS değerini TÜİK bülteniyle karşılaştırıp onaylayın. Onaylanmamış endeks hiçbir hesapta kullanılmaz.',
      hedefTarih: hedef, gorunurTarih: hedef, oncelik: 'YUKSEK', kararGerekli: true,
    })
  }
  const beklenen = ayKaydir(tarihinAyi(v.bugun), -1)
  const bekleyenAylar = new Set(
    v.bekleyenEndeksler.filter((e) => e.seri === 'TUFE_12AY_ORT').map((e) => ayAnahtari(e.ay)),
  )
  for (const m of eksikTufeAylari(v.sonOnayliTufe12Ayi, beklenen)) {
    if (bekleyenAylar.has(ayAnahtari(m))) continue
    const hedef = yayinGunu(ayKaydir(m, 1), v.tatiller)
    ekle({
      anahtar: `H4_EKSIK:endeks:${ayAnahtari(m)}`, kural: 'H4_EKSIK', iliskiliTur: 'endeks', iliskiliId: ayAnahtari(m), sozlesmeId: null,
      baslik: `${ayAdi(m)} TÜFE12 oranı sistemde yok`,
      aciklama: "EVDS'ten gelmedi veya onaylanmadı. TÜİK bülteninden elle girin; artış hesapları bekliyor.",
      hedefTarih: hedef, gorunurTarih: gunEkle(hedef, 1), oncelik: 'KRITIK', kararGerekli: true,
    })
  }
}

/**
 * Son onaylı aydan beklenen aya kadar (dahil) eksik TÜFE12 ayları, en çok son 12 ay.
 * Onaylı ay hiç yoksa yalnızca beklenen ay.
 */
function eksikTufeAylari(sonOnayli: Ay | null, beklenen: Ay): Ay[] {
  if (sonOnayli === null) return [beklenen]
  const fark = (beklenen.yil - sonOnayli.yil) * 12 + (beklenen.ay - sonOnayli.ay)
  const aylar: Ay[] = []
  for (let k = Math.max(1, fark - 11); k <= fark; k++) aylar.push(ayKaydir(sonOnayli, k))
  return aylar
}

function sozlesmeKurallari(v: HatirlatmaVerisi, s: SozlesmeOzeti, ekle: Ekle): void {
  const a = v.ayarlar
  const tbk = tbk347KapsamindaMi(s.tasinmazTuru)
  const ortak = { iliskiliTur: 'sozlesme' as const, iliskiliId: s.id, sozlesmeId: s.id }

  if (s.artisKurali !== 'YOK') {
    const ufuk = gunEkle(v.bugun, a.artisOnceGun)
    // Arsa kirası bitişte sona erer. TBK 347 kapsamı ve açık uçlu sözleşmelerde artış ufka kadar aranır; sona ermekte olan sözleşmede
    // etkin bitişe kadar (uzamayacaktır).
    const son = s.sonaErmekte ? enKucukTarih(s.bitisEtkin ?? ufuk, ufuk) : s.bitis === null || tbk ? ufuk : enKucukTarih(s.bitis, ufuk)
    for (const d of artisTarihleri({ ilkKiraBaslangici: s.ilkKiraBaslangici, periyotAy: s.artisPeriyoduAy, sonTarih: son })) {
      // Son kira dönemiyle başlayan artış o dönemle uygulanmıştır; yalnızca ayarlanmamış yenileme ILK dönemi bekler.
      const sira = karsilastir(d, s.sonKiraDonemiBaslangici)
      if (sira < 0 || (sira === 0 && !s.ilkDonemArtisBekliyor)) continue
      const kayit = v.artislar.find((x) => x.sozlesmeId === s.id && x.donemBaslangic === d)
      if (kayit?.durum === 'ONAYLANDI') continue
      const durumMetni = kayit === undefined ? 'yaklaşıyor' : kayit.durum === 'BEKLEMEDE' ? 'endeks bekleniyor' : 'onayınızı bekliyor'
      ekle({
        ...ortak, anahtar: `H5:sozlesme:${s.id}:${d}`, kural: 'H5',
        baslik: `Kira artışı ${durumMetni} — ${s.no}`,
        aciklama: `${s.kisaAd}: ${formatTarih(d)} tarihinde başlayan kira döneminin artışı.`,
        hedefTarih: d, gorunurTarih: gunEkle(d, -a.artisOnceGun),
        oncelik: karsilastir(d, v.bugun) <= 0 ? 'KRITIK' : 'YUKSEK',
        kararGerekli: kayit?.durum === 'HESAPLANDI',
      })
    }
  }

  if (!s.sonaErmekte) bitisVeUzamaKurallari(v, s, ekle)
  eksikVeriKurallari(v, s, ekle)
}

/** H6, H6_SON_GUN, H6_ARSA, H7, H8: yalnızca uzayabilecek (sona ermekte olmayan) sözleşmeler için. */
function bitisVeUzamaKurallari(v: HatirlatmaVerisi, s: SozlesmeOzeti, ekle: Ekle): void {
  const a = v.ayarlar
  const tbk = tbk347KapsamindaMi(s.tasinmazTuru)
  const ortak = { iliskiliTur: 'sozlesme' as const, iliskiliId: s.id, sozlesmeId: s.id }

  if (s.bitis !== null) {
    const kalan = gunFarki(v.bugun, s.bitis)
    if (kalan >= 0) {
      ekle({
        ...ortak, anahtar: `H6:sozlesme:${s.id}:${s.bitis}`, kural: 'H6',
        baslik: `Sözleşme bitişi yaklaşıyor — ${s.no}`,
        aciklama: tbk
          ? `${s.kisaAd}: ${formatTarih(s.bitis)} tarihinde biter. Yenileme, fesih veya uzama kararı verin.`
          : `${s.kisaAd}: arsa kirası ${formatTarih(s.bitis)} tarihinde sona erer; kendiliğinden uzamaz (TBK 327).`,
        hedefTarih: s.bitis, gorunurTarih: gunEkle(s.bitis, -a.bitisGorunurGun),
        oncelik: kalan <= a.bitisKritikGun ? 'KRITIK' : kalan <= a.bitisYuksekGun ? 'YUKSEK' : 'NORMAL',
        kararGerekli: true,
      })
    }
    if (tbk) {
      // Yasal son gün anahtar ve görünürlük için kullanılır; hatırlatılan tarih ise ondan önceki son iş günüdür.
      const sonGun = gunEkle(s.bitis, -a.fesihBildirimGun)
      if (karsilastir(v.bugun, sonGun) <= 0) {
        let hedef = sonGun
        while (!isGunuMu(hedef, v.tatiller)) hedef = gunEkle(hedef, -1)
        ekle({
          ...ortak, anahtar: `H6_SON_GUN:sozlesme:${s.id}:${sonGun}`, kural: 'H6_SON_GUN',
          baslik: `Fesih bildirimi son günü — ${s.no}`,
          aciklama: `${formatTarih(hedef)} tarihine kadar yazılı fesih bildirimi yapılmazsa sözleşme 1 yıl uzar (TBK 347).`,
          hedefTarih: hedef, gorunurTarih: gunEkle(hedef, -a.fesihSonGunGorunurGun), oncelik: 'KRITIK', kararGerekli: true,
        })
      }
    } else if (kalan < 0) {
      ekle({
        ...ortak, anahtar: `H6_ARSA:sozlesme:${s.id}:${s.bitis}`, kural: 'H6_ARSA',
        baslik: `Arsa kirası süresi doldu — ${s.no}`,
        aciklama: 'Kullanım sürüyorsa yenileme sözleşmesi girin veya belirsiz süreliye çevirin; sürmüyorsa sona erdi olarak kapatın.',
        hedefTarih: s.bitis, gorunurTarih: s.bitis, oncelik: 'KRITIK', kararGerekli: true,
      })
    }
  }

  if (tbk) {
    for (const d of tespitTarihleri(s.ilkKiraBaslangici, ayEkle(v.bugun, a.tespitOnceAy))) {
      if (karsilastir(d, v.bugun) < 0) continue
      ekle({
        ...ortak, anahtar: `H7:sozlesme:${s.id}:${d}`, kural: 'H7',
        baslik: `5 yıllık kira tespit dönemi — ${s.no}`,
        aciklama: `${formatTarih(d)} itibarıyla kiraya veren emsal kira için tespit davası açabilir (TBK 344/3). Emsal araştırması yapın.`,
        hedefTarih: d, gorunurTarih: ayEkle(d, -a.tespitOnceAy), oncelik: 'NORMAL', kararGerekli: false,
      })
    }
    // 10 uzama yılı: uzama sayacı ya da (göç edilmiş sözleşmede sayaç sıfırdan başladığı için) ilk kira başlangıcından geçen 120 ay.
    if ((s.uzamaSayisi >= 10 || ayFarki(s.ilkKiraBaslangici, v.bugun) >= 120) && s.bitis !== null) {
      const hedef = ayEkle(s.bitis, -a.uzama10OnceAy)
      if (karsilastir(v.bugun, hedef) <= 0) {
        ekle({
          ...ortak, anahtar: `H8:sozlesme:${s.id}:${s.bitis}`, kural: 'H8',
          baslik: `10 uzama yılı doldu — ${s.no}`,
          aciklama: `Kiraya veren ${formatTarih(hedef)} tarihine kadar bildirimde bulunarak sözleşmeyi gerekçesiz feshedebilir (TBK 347/1).`,
          hedefTarih: hedef, gorunurTarih: gunEkle(hedef, -30), oncelik: 'NORMAL', kararGerekli: false,
        })
      }
    }
  }
}

function eksikVeriKurallari(v: HatirlatmaVerisi, s: SozlesmeOzeti, ekle: Ekle): void {
  const ortak = { iliskiliTur: 'sozlesme' as const, iliskiliId: s.id, sozlesmeId: s.id }
  for (const e of s.eksikler) {
    ekle({
      ...ortak, anahtar: `H12:sozlesme:${s.id}:${e}`, kural: 'H12',
      baslik: `${EKSIK_VERI_BASLIK[e]} — ${s.no}`, aciklama: s.kisaAd,
      hedefTarih: v.bugun, gorunurTarih: v.bugun, oncelik: 'NORMAL', kararGerekli: false,
    })
  }
}

/**
 * Başlangıcı yaklaşan ya da geçen taslak aktifleştirilmeden taksit planı ve hatırlatmaları oluşmaz: karar gerektiren H12. Aktifleştirme
 * ya da taslağın silinmesiyle aday düşer ve kayıt kendiliğinden kapanır (H12 otomatik kuraldır).
 */
function taslakKurali(v: HatirlatmaVerisi, s: TaslakOzeti, ekle: Ekle): void {
  const basladi = karsilastir(s.baslangic, v.bugun) < 0
  ekle({
    anahtar: `H12:sozlesme:${s.id}:TASLAK_AKTIF_DEGIL`, kural: 'H12', iliskiliTur: 'sozlesme', iliskiliId: s.id, sozlesmeId: s.id,
    baslik: `Sözleşme taslağı aktifleştirilmedi — ${s.no}`,
    aciklama: `${s.kisaAd}: ${formatTarih(s.baslangic)} tarihinde ${basladi ? 'başladı' : 'başlıyor'}. Taslak aktifleştirilmedikçe taksit planı ve hatırlatmalar oluşmaz.`,
    hedefTarih: s.baslangic, gorunurTarih: gunEkle(s.baslangic, -TASLAK_HATIRLATMA_GUN), oncelik: basladi ? 'KRITIK' : 'NORMAL', kararGerekli: true,
  })
}

function sistemKurallari(v: HatirlatmaVerisi, ekle: Ekle): void {
  const { yil } = parcala(v.bugun)
  const butceSon = birlestir(yil, 9, 30)
  if (karsilastir(v.bugun, butceSon) <= 0) {
    ekle({
      anahtar: `H11:sistem:butce:${yil}`, kural: 'H11', iliskiliTur: 'sistem', iliskiliId: 'butce', sozlesmeId: null,
      baslik: `${yil + 1} kira bütçesi hazırlığı`,
      aciklama: 'Gelecek yılın kira giderlerini artış varsayımlarıyla bütçe hazırlık sürecine bildirin.',
      hedefTarih: butceSon, gorunurTarih: birlestir(yil, 9, 1), oncelik: 'NORMAL', kararGerekli: false,
    })
  }
  for (const p of v.parametreBitisleri) {
    // Yürürlüğü 30 günden uzun önce biten parametre sessizce geçilir (geçmiş kayıtlar).
    if (karsilastir(v.bugun, gunEkle(p.yururlukBitis, 30)) > 0) continue
    const doldu = karsilastir(v.bugun, p.yururlukBitis) > 0
    ekle({
      anahtar: `H13:parametre:${p.anahtar}:${p.yururlukBitis}`, kural: 'H13', iliskiliTur: 'parametre', iliskiliId: p.anahtar, sozlesmeId: null,
      baslik: doldu ? `Mevzuat parametresinin süresi doldu — ${p.anahtar}` : `Mevzuat parametresi süresi doluyor — ${p.anahtar}`,
      aciklama: doldu
        ? `${formatTarih(p.yururlukBitis)} tarihinde yürürlüğü sona erdi ve sonrası için yeni değer girilmedi. Güncel mevzuatı kontrol edip yeni yürürlük kaydı ekleyin.`
        : `${formatTarih(p.yururlukBitis)} sonrası için yeni değer girilmedi. Güncel mevzuatı kontrol edip yeni yürürlük kaydı ekleyin.`,
      hedefTarih: p.yururlukBitis, gorunurTarih: gunEkle(p.yururlukBitis, -v.ayarlar.mevzuatOnceGun),
      oncelik: doldu ? 'KRITIK' : 'NORMAL', kararGerekli: true,
    })
  }
}
