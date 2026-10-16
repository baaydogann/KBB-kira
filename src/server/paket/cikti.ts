import { bankaSatirlari } from '@/core/paket/banka'
import type { IslemBaglami } from '../baglam'
import { artisTablosuBolumu } from '../cikti/belgeler/artis-tablosu'
import { ekListeBolumu } from '../cikti/belgeler/ek-liste'
import { fisBolumu } from '../cikti/belgeler/fis'
import { foyBolumu } from '../cikti/belgeler/foy'
import { pusulaBolumu } from '../cikti/belgeler/pusula'
import { excelUret } from '../cikti/excel'
import { pdfUret } from '../cikti/pdf'
import { prisma } from '../db'
import { paraDb, tarihDb } from '../donustur'
import { BulunamadiHatasi, IsKuraliHatasi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { disaAktarimKaydi } from '../denetim'
import { paketCiktiVerisi } from './cikti-verisi'

/**
 * Paket belgeleri tek PDF'te: föy, ek listesi, harcama pusulaları (KDV'siz gerçek kişi alıcılar), fiş önerisi, artış tabloları (varsa).
 * Kesinleşmemiş pakette filigranlı. Dışa aktarım kaydı PDF üretildikten sonra yazılır.
 */
export async function paketBelgeleriPdf(paketId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }> {
  const v = await paketCiktiVerisi(paketId)
  const icerik = await pdfUret({
    baslik: `Ödeme paketi ${v.paket.id}`, bolumler: [
      foyBolumu(v), ekListeBolumu(v),
      ...v.alicilar.filter((a) => a.tip === 'GERCEK' && !a.kdvli).map((a) => pusulaBolumu(v, a)),
      fisBolumu(v),
      ...(v.artislar.length > 0 ? [artisTablosuBolumu(v)] : []),
    ], filigran: v.kesinlesmemis ? 'TASLAK — KESİNLEŞMEMİŞ' : null,
  })
  await disaAktarimKaydi(prisma, baglam, { varlik: 'odeme_paketi', varlikId: paketId, belge: 'PAKET_BELGELERI', kayitSayisi: v.alicilar.length })
  return { dosyaAdi: `odeme-paketi-${paketId}.pdf`, icerik }
}

const BANKA_DURUMLARI = ['KESINLESTI', 'ODEME_EMRINDE', 'ODENDI']

/** Banka aktarım dosyası (Excel): yalnızca kesinleşmiş tutarla; ödeme kişisi ve IBAN başına satır, açıklamada hak sahibinin kimlik no'su. */
export async function paketBankaDosyasi(paketId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }> {
  const p = await prisma.odemePaketi.findUnique({
    where: { id: paketId },
    select: {
      durum: true,
      dagilimlar: { orderBy: { sira: 'asc' }, include: { kisi: true, odemeKisi: true, iban: true, taksit: { include: { sozlesme: { select: { sozlesmeNo: true } } } } } },
    },
  })
  if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  if (!BANKA_DURUMLARI.includes(p.durum)) throw new IsKuraliHatasi('DURUM', 'Banka dosyası yalnızca kesinleşmiş paket için üretilir.')
  const satirlar = bankaSatirlari(p.dagilimlar.filter((d) => d.iban !== null).map((d) => ({
    kisiId: String(d.kisiId), kimlikNo: (d.kisi.tip === 'GERCEK' ? d.kisi.tckn : d.kisi.vkn) ?? '', odemeKisiId: String(d.odemeKisiId),
    odemeKisiAdi: kisiGorunenAd(d.odemeKisi), ibanId: String(d.ibanId), iban: d.iban!.iban, net: paraDb(d.net), sozlesmeNo: d.taksit.sozlesme.sozlesmeNo,
    donemBaslangic: tarihDb(d.taksit.donemBaslangic),
  })))
  const icerik = await excelUret([{
    ad: 'Banka aktarımı',
    sutunlar: [{ baslik: 'Sıra', tur: 'tamsayi' }, { baslik: 'Alıcı (ödeme kişisi)', tur: 'metin', genislik: 32 }, { baslik: 'IBAN', tur: 'metin', genislik: 30 }, { baslik: 'Tutar', tur: 'para' }, { baslik: 'Açıklama', tur: 'metin', genislik: 60 }],
    satirlar: satirlar.map((s) => [s.sira, s.ad, s.iban, s.tutar, s.aciklama]),
  }])
  await disaAktarimKaydi(prisma, baglam, { varlik: 'odeme_paketi', varlikId: paketId, belge: 'BANKA_AKTARIMI', kayitSayisi: satirlar.length })
  return { dosyaAdi: `banka-aktarimi-${paketId}.xlsx`, icerik }
}
