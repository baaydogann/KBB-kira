import { SIFIR, yuvarla, type Para } from '../para'
import { basarili, hatali, type Sonuc } from '../sonuc'
import { ayEkle, ayFarki, gunEkle, gunFarki, karsilastir, kesisim, type Tarih } from '../tarih'
import type { BedelTabani, KistYontemi, OdemePeriyodu } from '../tipler'
import type { HesapSatiri } from './goruntu'

export interface KiraDonemiGirdi {
  id: string
  baslangic: Tarih
  bitis: Tarih | null
  bedel: Para
  taban: BedelTabani
}

export interface TaksitTutariGirdi {
  donem: { baslangic: Tarih; bitis: Tarih }
  periyotAy: OdemePeriyodu
  /** Kira aylarının çapası: sözleşme başlangıcı. */
  kiraAyiCapasi: Tarih
  kiraDonemleri: readonly KiraDonemiGirdi[]
  kist: KistYontemi
}

export interface TaksitTutari {
  tutar: Para
  satirlar: HesapSatiri[]
}

type Parca = { tutar: Para; satirlar: HesapSatiri[] }

/** K1 — taksit dönemi için sözleşme bedel türünde (BRÜT veya NET) dönem tutarı. */
export function taksitTutari(g: TaksitTutariGirdi): Sonuc<TaksitTutari> {
  const satirlar: HesapSatiri[] = []
  let toplam = SIFIR
  let kapsananGun = 0
  for (const kd of g.kiraDonemleri) {
    const k = kesisim({ baslangic: g.donem.baslangic, bitis: g.donem.bitis }, { baslangic: kd.baslangic, bitis: kd.bitis })
    if (k === null || k.bitis === null) continue
    kapsananGun += gunFarki(k.baslangic, k.bitis) + 1
    const parca = yillikKesinParca(g, kd, k.baslangic, k.bitis) ?? aylikParcalar(g, kd, k.baslangic, k.bitis)
    toplam = toplam.plus(parca.tutar)
    satirlar.push(...parca.satirlar)
  }
  const donemGun = gunFarki(g.donem.baslangic, g.donem.bitis) + 1
  if (kapsananGun !== donemGun) {
    return hatali({
      kod: 'DONEM_DISI',
      mesaj: 'Taksit döneminin bir kısmı için kira bedeli tanımlı değil.',
      ayrinti: { donemGun, kapsananGun },
    })
  }
  const tutar = yuvarla(toplam)
  satirlar.push({ kural: 'K1', aciklama: 'Taksit tutarı (kuruşa yarım yukarı)', formul: toplam.toString(), sonuc: tutar.toFixed(2) })
  return basarili({ tutar, satirlar })
}

/** Yıllık bedelin hizalı, tam dönemli taksiti: ⌊Y×p/12⌋, kira yılının son taksiti artığı alır. */
function yillikKesinParca(g: TaksitTutariGirdi, kd: KiraDonemiGirdi, bas: Tarih, bit: Tarih): Parca | null {
  if (kd.taban !== 'YILLIK') return null
  if (bas !== g.donem.baslangic || bit !== g.donem.bitis) return null
  const i = ayFarki(g.kiraAyiCapasi, g.donem.baslangic)
  if (ayEkle(g.kiraAyiCapasi, i) !== g.donem.baslangic) return null
  if (g.donem.bitis !== gunEkle(ayEkle(g.kiraAyiCapasi, i + g.periyotAy), -1)) return null
  const s0 = ayFarki(g.kiraAyiCapasi, kd.baslangic)
  if (ayEkle(g.kiraAyiCapasi, s0) !== kd.baslangic) return null
  const m = i - s0
  if (m < 0 || m % g.periyotAy !== 0) return null
  const adet = 12 / g.periyotAy
  const j = (m / g.periyotAy) % adet
  const parca = yuvarla(kd.bedel.times(g.periyotAy).dividedBy(12), 'ASAGI')
  const sonTaksit = j === adet - 1
  const tutar = sonTaksit ? kd.bedel.minus(parca.times(adet - 1)) : parca
  return {
    tutar,
    satirlar: [{
      kural: 'K1',
      aciklama: sonTaksit
        ? `Yıllık bedelin kira yılındaki son taksiti (${j + 1}/${adet}), kuruş artığı dahil`
        : `Yıllık bedelin ${j + 1}/${adet}. taksiti (kuruşa aşağı)`,
      formul: sonTaksit
        ? `${kd.bedel.toFixed(2)} − ${parca.toFixed(2)} × ${adet - 1}`
        : `${kd.bedel.toFixed(2)} × ${g.periyotAy} / 12`,
      sonuc: tutar.toFixed(2),
    }],
  }
}

/** Kira aylarına (sözleşme başlangıcına çapalı) böl; tam aylar aylık bedel, kıst aylar gün oranı. */
function aylikParcalar(g: TaksitTutariGirdi, kd: KiraDonemiGirdi, bas: Tarih, bit: Tarih): Parca {
  const aylik = kd.taban === 'YILLIK' ? kd.bedel.dividedBy(12) : kd.bedel
  const satirlar: HesapSatiri[] = []
  let tutar = SIFIR
  let tamAy = 0
  for (let i = ayFarki(g.kiraAyiCapasi, bas); ; i++) {
    const ayBas = ayEkle(g.kiraAyiCapasi, i)
    if (karsilastir(ayBas, bit) > 0) break
    const aySon = gunEkle(ayEkle(g.kiraAyiCapasi, i + 1), -1)
    const kes = kesisim({ baslangic: ayBas, bitis: aySon }, { baslangic: bas, bitis: bit })
    if (kes === null || kes.bitis === null) continue
    const kesGun = gunFarki(kes.baslangic, kes.bitis) + 1
    const ayGun = gunFarki(ayBas, aySon) + 1
    if (kesGun === ayGun) {
      tutar = tutar.plus(aylik)
      tamAy += 1
      continue
    }
    const bolen = g.kist === 'GERCEK_GUN' ? ayGun : 30
    const gun = g.kist === 'OTUZ_GUN' && kesGun > 30 ? 30 : kesGun
    const kistTutar = aylik.times(gun).dividedBy(bolen)
    tutar = tutar.plus(kistTutar)
    satirlar.push({
      kural: 'K1',
      aciklama: `Kıst dönem ${kes.baslangic} – ${kes.bitis} (${g.kist === 'GERCEK_GUN' ? 'gerçek gün' : '30 gün esası'})`,
      formul: `${aylik.toString()} × ${gun} / ${bolen}`,
      sonuc: kistTutar.toString(),
    })
  }
  if (tamAy > 0) {
    satirlar.unshift({
      kural: 'K1',
      aciklama: `${tamAy} tam kira ayı${kd.taban === 'YILLIK' ? ' (yıllık bedel / 12)' : ''}`,
      formul: `${aylik.toString()} × ${tamAy}`,
      sonuc: aylik.times(tamAy).toString(),
    })
  }
  return { tutar, satirlar }
}
