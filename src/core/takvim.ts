import { ayEkle, ayinGunSayisi, birlestir, gunEkle, karsilastir, parcala, type Tarih } from './tarih'
import type { OdemePeriyodu, OdemeZamani, VadeKurali } from './tipler'

export interface Donem { sira: number; baslangic: Tarih; bitis: Tarih; tam: boolean }

const AZAMI_DONEM = 2400

/** Dönem i başlangıcı her zaman orijinal başlangıçtan hesaplanır (zincirleme ekleme yok). */
export function odemeDonemleri(p: { baslangic: Tarih; bitis: Tarih | null; periyotAy: OdemePeriyodu; ufuk: Tarih }): Donem[] {
  const sonuc: Donem[] = []
  const son = p.bitis ?? p.ufuk
  for (let i = 0; i < AZAMI_DONEM; i++) {
    const baslangic = ayEkle(p.baslangic, i * p.periyotAy)
    if (karsilastir(baslangic, son) > 0) break
    const dogalBitis = gunEkle(ayEkle(p.baslangic, (i + 1) * p.periyotAy), -1)
    const bitis = p.bitis !== null && karsilastir(dogalBitis, p.bitis) > 0 ? p.bitis : dogalBitis
    sonuc.push({ sira: i, baslangic, bitis, tam: bitis === dogalBitis })
  }
  return sonuc
}

export function vadeTarihi(
  d: { baslangic: Tarih; bitis: Tarih },
  zaman: OdemeZamani,
  kural: VadeKurali,
  parametre: number,
): Tarih {
  switch (kural) {
    case 'DONEM_BASI_ARTI_GUN':
      return gunEkle(d.baslangic, parametre)
    case 'DONEM_SONU_ARTI_GUN':
      return gunEkle(d.bitis, parametre)
    case 'AYIN_GUNU': {
      const { yil, ay } = parcala(zaman === 'PESIN' ? d.baslangic : d.bitis)
      return birlestir(yil, ay, Math.min(parametre, ayinGunSayisi(yil, ay)))
    }
  }
}

export function artisTarihleri(p: { ilkKiraBaslangici: Tarih; periyotAy: number; sonTarih: Tarih }): Tarih[] {
  const sonuc: Tarih[] = []
  for (let k = 1; k < AZAMI_DONEM; k++) {
    const d = ayEkle(p.ilkKiraBaslangici, k * p.periyotAy)
    if (karsilastir(d, p.sonTarih) > 0) break
    sonuc.push(d)
  }
  return sonuc
}

export function tespitTarihleri(ilkKiraBaslangici: Tarih, sonTarih: Tarih): Tarih[] {
  return artisTarihleri({ ilkKiraBaslangici, periyotAy: 60, sonTarih })
}

/** TBK 347: belirli süreli sözleşme bir yıl uzar. Yeni dönem bitis+1'den başlar. */
export function uzamaBitisi(bitis: Tarih): Tarih {
  return gunEkle(ayEkle(gunEkle(bitis, 1), 12), -1)
}
