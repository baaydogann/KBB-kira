import { hisseyeDagit, type Hisse } from '../hisse'
import { kurusaCevir, kurustanPara, type Para } from '../para'
import { basarili, hatali, type Sonuc } from '../sonuc'
import { gunFarki, karsilastir, type Tarih } from '../tarih'
import type { BedelTuru } from '../tipler'
import type { HesapSatiri } from './goruntu'
import { malikTutari } from './vergi'

/** Bir parçadaki malik: hissesi, ödemenin yapılacağı kişi ve IBAN, statüsünün oranları (yüzde; 20 = %20). */
export interface DagilimMaligi extends Hisse {
  sozlesmeMalikId: string
  odemeKisiId: string
  ibanId: string | null
  stopajOrani: Para
  kdvOrani: Para
}

/** Taksit döneminin, kendi malik seti olan bir parçası (dönem içinde malik değişikliğinde "böl"). */
export interface DagilimParcasi { baslangic: Tarih; bitis: Tarih; malikler: readonly DagilimMaligi[] }

export interface TaksitDagilimGirdisi { tutar: Para; bedelTuru: BedelTuru; parcalar: readonly DagilimParcasi[] }

export interface DagilimSatiri {
  parca: number
  parcaBaslangic: Tarih
  parcaBitis: Tarih
  kisiId: string
  sozlesmeMalikId: string
  odemeKisiId: string
  ibanId: string | null
  pay: number
  payda: number
  /** Taksit tutarından bu malike düşen pay: BRÜT sözleşmede brüt, NET sözleşmede net. */
  payTutari: Para
  brut: Para
  kdv: Para
  stopaj: Para
  stopajOrani: Para
  kdvOrani: Para
  /** brut + kdv − stopaj (kesintiler öncesi). */
  odenecek: Para
  satirlar: HesapSatiri[]
}

const gecersiz = (mesaj: string) => hatali({ kod: 'GECERSIZ_GIRDI' as const, mesaj })

function gunSayisi(p: DagilimParcasi): number {
  return gunFarki(p.baslangic, p.bitis) + 1
}

/**
 * K3 + K4 — taksit tutarının parçalara (gün oranı) ve parçanın maliklerine (hisse) en büyük kalan yöntemiyle bölünmesi, ardından malik
 * payı için KDV ve stopaj. Σ payTutari = tutar (kuruş korunur). Çıktı parça sırasıyla, parçada kişi kimliğine (sayısal) göre sıralıdır.
 */
export function taksitDagilimi(g: TaksitDagilimGirdisi): Sonuc<DagilimSatiri[]> {
  // Negatif tutarı aşağıdaki ilk `hisseyeDagit` GECERSIZ_GIRDI ile reddeder.
  if (g.tutar.decimalPlaces() > 2) return gecersiz('Tutar kuruştan küçük kesir içeremez.')
  if (g.parcalar.length === 0) return gecersiz('Taksit en az bir parçadan oluşmalı.')
  for (const [i, p] of g.parcalar.entries()) {
    if (karsilastir(p.bitis, p.baslangic) < 0) return gecersiz('Parça bitişi başlangıcından önce olamaz.')
    const onceki = g.parcalar[i - 1]
    if (onceki !== undefined && karsilastir(p.baslangic, onceki.bitis) <= 0) return gecersiz('Parçalar sıralı ve çakışmasız olmalı.')
  }

  const toplamKurus = kurusaCevir(g.tutar)
  const gunler = g.parcalar.map(gunSayisi)
  const toplamGun = gunler.reduce((a, b) => a + b, 0)
  // Parçalar gün sayılarıyla tartılır (tek parçada pay = payda: tutarın tamamı).
  const parcaPaylari = hisseyeDagit(toplamKurus, gunler.map((gun, i) => ({ kisiId: String(i + 1), pay: gun, payda: toplamGun })))
  if (!parcaPaylari.ok) return parcaPaylari
  const parcaKuruslari = parcaPaylari.deger.map((p) => p.kurus)

  const satirlar: DagilimSatiri[] = []
  for (const [i, p] of g.parcalar.entries()) {
    const parcaKurus = parcaKuruslari[i]!
    const parcaTutari = kurustanPara(parcaKurus)
    const paylar = hisseyeDagit(parcaKurus, p.malikler)
    if (!paylar.ok) return paylar
    const parcaSatiri: HesapSatiri[] = g.parcalar.length > 1
      ? [{ kural: 'K3', aciklama: 'Parça payı (gün oranı)', formul: `${g.tutar.toFixed(2)} × ${gunler[i]}/${toplamGun} gün`, sonuc: parcaTutari.toFixed(2) }]
      : []
    const parcadakiler = paylar.deger.map((pay, j) => {
      const malik = p.malikler[j]!
      const payTutari = kurustanPara(pay.kurus)
      const vergi = malikTutari({ tutar: payTutari, bedelTuru: g.bedelTuru, stopajOrani: malik.stopajOrani, kdvOrani: malik.kdvOrani })
      return {
        parca: i, parcaBaslangic: p.baslangic, parcaBitis: p.bitis,
        kisiId: malik.kisiId, sozlesmeMalikId: malik.sozlesmeMalikId, odemeKisiId: malik.odemeKisiId, ibanId: malik.ibanId,
        pay: malik.pay, payda: malik.payda, payTutari,
        brut: vergi.brut, kdv: vergi.kdv, stopaj: vergi.stopaj, stopajOrani: malik.stopajOrani, kdvOrani: malik.kdvOrani, odenecek: vergi.net,
        satirlar: [
          ...parcaSatiri,
          { kural: 'K3', aciklama: 'Hisse payı (en büyük kalan)', formul: `${parcaTutari.toFixed(2)} × ${malik.pay}/${malik.payda}`, sonuc: payTutari.toFixed(2) },
          ...vergi.satirlar,
        ],
      }
    })
    // Kimlikler benzersizdir (hisseyeDagit denetler): eşitlik dalı gerekmez.
    parcadakiler.sort((a, b) => (BigInt(a.kisiId) < BigInt(b.kisiId) ? -1 : 1))
    satirlar.push(...parcadakiler)
  }
  return basarili(satirlar)
}
