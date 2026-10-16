import type { KesintiTuru, PaketDurumu, Prisma } from '@/generated/prisma'
import { prisma } from '@/server/db'
import { ornekKisi, ornekSozlesme } from './ornekler'

const g = (s: string) => new Date(`${s}T00:00:00.000Z`)

export interface PaketZemini { birimId: number; sozlesmeId: number; taksitId: number; kisiId: number; sozlesmeMalikId: number }

/** Paket satırları için en küçük zemin: taslak sözleşme, tek malik, Şubat 2026 taksiti. Servisleri değil, tabloları sınamak içindir. */
export async function paketZemini(kisiId?: number): Promise<PaketZemini> {
  const s = await ornekSozlesme()
  const kisi = kisiId ?? (await ornekKisi()).id
  const m = await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: kisi, pay: 1, payda: 1, gecerlilikBaslangic: g('2026-01-01') } })
  const t = await prisma.taksit.create({
    data: { sozlesmeId: s.id, tur: 'NORMAL', donemBaslangic: g('2026-02-01'), donemBitis: g('2026-02-28'), vadeTarihi: g('2026-02-01'), tutar: '10000.00', hesapGoruntusu: {} },
  })
  return { birimId: s.birimId, sozlesmeId: s.id, taksitId: t.id, kisiId: kisi, sozlesmeMalikId: m.id }
}

export interface SatirliPaketSecenegi {
  durum: PaketDurumu
  kesinti?: { tur: KesintiTuru; tutar: string; hacizId?: number; borcSorguId?: number; damgaPayiId?: number }
  onKontrol?: Prisma.InputJsonValue
  hesapParmakIzi?: Prisma.InputJsonValue
  hesapTarihi?: string
}

/**
 * Bir taksit, bir dağılım satırı (brüt 10.000, stopaj 2.000) ve isteğe bağlı bir kesinti satırıyla paket kurar. Paket önce HESAPLANDI açılır
 * (dağılım tetikleyicisi yalnız TASLAK/HESAPLANDI pakete yazdırır), sonra istenen duruma kısıtların istediği alanlarla geçirilir.
 */
export async function satirliPaket(z: PaketZemini, o: SatirliPaketSecenegi): Promise<{ paketId: number; dagilimId: number }> {
  const hesapTarihi = g(o.hesapTarihi ?? '2026-01-25')
  const p = await prisma.odemePaketi.create({
    data: {
      birimId: z.birimId, ad: 'Test paketi', vadeBaslangic: g('2026-02-01'), vadeBitis: g('2026-02-28'), durum: 'HESAPLANDI', hesapTarihi,
      onKontrol: o.onKontrol, hesapParmakIzi: o.hesapParmakIzi,
    },
  })
  await prisma.paketTaksit.create({ data: { paketId: p.id, taksitId: z.taksitId, aktif: o.durum !== 'IPTAL' } })
  const kesinti = o.kesinti?.tutar ?? '0.00'
  const alan = o.kesinti?.tur === 'DAMGA' ? 'damgaKesintisi' : o.kesinti?.tur === 'HACIZ' ? 'hacizKesintisi' : 'kesinti22a'
  const net = (800000n - BigInt(Math.round(Number(kesinti) * 100))).toString()
  const d = await prisma.taksitDagilim.create({
    data: {
      paketId: p.id, taksitId: z.taksitId, sozlesmeMalikId: z.sozlesmeMalikId, kisiId: z.kisiId, odemeKisiId: z.kisiId, sira: 0,
      parcaBaslangic: g('2026-02-01'), parcaBitis: g('2026-02-28'), pay: 1, payda: 1,
      brut: '10000.00', kdv: '0.00', stopaj: '2000.00', kdvOrani: '0', stopajOrani: '20',
      [alan]: kesinti, net: `${net.slice(0, -2) || '0'}.${net.slice(-2).padStart(2, '0')}`, hesapGoruntusu: {},
    },
  })
  if (o.kesinti) {
    await prisma.dagilimKesinti.create({
      data: {
        paketId: p.id, dagilimId: d.id, tur: o.kesinti.tur, tutar: o.kesinti.tutar,
        hacizId: o.kesinti.hacizId ?? null, borcSorguId: o.kesinti.borcSorguId ?? null, damgaPayiId: o.kesinti.damgaPayiId ?? null,
      },
    })
  }
  if (o.durum !== 'HESAPLANDI') {
    const kesin = ['KESINLESTI', 'ODEME_EMRINDE', 'ODENDI'].includes(o.durum)
    const emirde = ['ODEME_EMRINDE', 'ODENDI'].includes(o.durum)
    await prisma.odemePaketi.update({
      where: { id: p.id },
      data: {
        durum: o.durum,
        ...(kesin ? { kesinlesmeZamani: new Date() } : {}),
        ...(emirde ? { muhasebeOdemeEmriNo: 'OE-1', muhasebeOdemeEmriTarihi: hesapTarihi } : {}),
        ...(o.durum === 'ODENDI' ? { odemeTarihi: hesapTarihi } : {}),
        ...(o.durum === 'IPTAL' ? { iptalNedeni: 'test' } : {}),
      },
    })
  }
  return { paketId: p.id, dagilimId: d.id }
}
