import type { IslemBaglami } from '../baglam'
import { artisTablosuBolumu } from '../cikti/belgeler/artis-tablosu'
import { ekListeBolumu } from '../cikti/belgeler/ek-liste'
import { fisBolumu } from '../cikti/belgeler/fis'
import { foyBolumu } from '../cikti/belgeler/foy'
import { pusulaBolumu } from '../cikti/belgeler/pusula'
import { pdfUret } from '../cikti/pdf'
import { prisma } from '../db'
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
