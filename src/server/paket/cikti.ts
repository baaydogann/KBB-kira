import type { IslemBaglami } from '../baglam'
import { ekListeBolumu } from '../cikti/belgeler/ek-liste'
import { foyBolumu } from '../cikti/belgeler/foy'
import { pdfUret } from '../cikti/pdf'
import { prisma } from '../db'
import { disaAktarimKaydi } from '../denetim'
import { paketCiktiVerisi } from './cikti-verisi'

/** Paket belgeleri (föy ve ek listesi) tek PDF'te; kesinleşmemiş pakette filigranlı. Dışa aktarım kaydı PDF üretildikten sonra yazılır. */
export async function paketBelgeleriPdf(paketId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }> {
  const v = await paketCiktiVerisi(paketId)
  const icerik = await pdfUret({
    baslik: `Ödeme paketi ${v.paket.id}`, bolumler: [foyBolumu(v), ekListeBolumu(v)], filigran: v.kesinlesmemis ? 'TASLAK — KESİNLEŞMEMİŞ' : null,
  })
  await disaAktarimKaydi(prisma, baglam, { varlik: 'odeme_paketi', varlikId: paketId, belge: 'PAKET_BELGELERI', kayitSayisi: v.alicilar.length })
  return { dosyaAdi: `odeme-paketi-${paketId}.pdf`, icerik }
}
