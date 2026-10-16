import { Prisma, type OdemePaketi, type PaketDurumu } from '@/generated/prisma'
import { bugunIstanbul, karsilastir, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, paraYaz } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import type { FaturaGirdisi, PaketGirdisi } from './sema'

export const DUZENLENEBILIR_DURUMLAR = ['TASLAK', 'HESAPLANDI'] as const satisfies readonly PaketDurumu[]

const PAKETTE_MESAJI = 'Taksitlerden biri başka bir pakette; listeyi yenileyin.'

/**
 * HESAPLANDI paketi TASLAK'a döndürür: dağılım ve kesinti satırları silinir (tetikleyici yalnız TASLAK/HESAPLANDI pakette izin verir),
 * ön kontrol, parmak izi ve hesap tarihi boşalır, taksitlerin hesaplanan sürümleri temizlenir. Sürümü artırmaz (çağıran artırır).
 */
export async function taslagaDondur(tx: Tx, paketId: number): Promise<void> {
  await tx.dagilimKesinti.deleteMany({ where: { paketId } })
  await tx.taksitDagilim.deleteMany({ where: { paketId } })
  await tx.paketTaksit.updateMany({ where: { paketId }, data: { hesaplananTaksitSurumu: null } })
  await tx.odemePaketi.update({
    where: { id: paketId }, data: { durum: 'TASLAK', hesapTarihi: null, onKontrol: Prisma.DbNull, hesapParmakIzi: Prisma.DbNull },
  })
}

/** Uygun taksit: PLANLANDI, sözleşmesi taslak değil ve paketin biriminde. */
async function taksitleriDenetle(tx: Tx, birimId: number, taksitIdleri: readonly number[]): Promise<void> {
  const taksitler = await tx.taksit.findMany({ where: { id: { in: [...taksitIdleri] } }, include: { sozlesme: { select: { birimId: true, durum: true } } } })
  if (taksitler.length !== new Set(taksitIdleri).size) throw new BulunamadiHatasi('Taksit bulunamadı.')
  for (const t of taksitler) {
    if (t.sozlesme.birimId !== birimId || t.sozlesme.durum === 'TASLAK') {
      throw new IsKuraliHatasi('BIRIM', "Yalnızca paketin harcama birimindeki aktif sözleşmelerin taksitleri eklenebilir.")
    }
    if (t.durum !== 'PLANLANDI') throw new IsKuraliHatasi('TAKSIT_DURUMU', 'Yalnızca planlanmış (ödenmemiş) taksitler pakete eklenebilir.')
  }
}

/** Kısmi tekil dizin ihlali (aynı taksit başka aktif pakette ya da bu pakette) iş kuralı hatasına çevrilir. */
async function paketteHatasiCevir<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('PAKETTE', PAKETTE_MESAJI)
    throw e
  }
}

/**
 * TASLAK paket açar ve önerilen taksitleri ekler: durumu PLANLANDI, sözleşmesi bu birimde ve taslak değil, vadesi aralıkta ve aktif bir
 * pakette olmayan taksitler. Vadesi aralıktan önce kalan (gecikmiş) taksitler otomatik eklenmez; öneri listesinde işaretli gelir.
 */
export async function paketOlustur(g: PaketGirdisi, baglam: IslemBaglami): Promise<number> {
  if (karsilastir(g.vadeBitis, g.vadeBaslangic) < 0) throw new IsKuraliHatasi('TARIH', 'Vade bitişi başlangıçtan önce olamaz.', 'vadeBitis')
  return paketteHatasiCevir(() => prisma.$transaction(async (tx) => {
    const birim = await tx.birim.findUnique({ where: { id: g.birimId }, select: { aktif: true } })
    if (!birim) throw new IsKuraliHatasi('BIRIM', 'Harcama birimi bulunamadı.', 'birimId')
    if (!birim.aktif) throw new IsKuraliHatasi('BIRIM', 'Pasif birim için paket açılamaz.', 'birimId')
    const p = await tx.odemePaketi.create({
      data: {
        birimId: g.birimId, ad: g.ad, vadeBaslangic: dbTarih(g.vadeBaslangic), vadeBitis: dbTarih(g.vadeBitis),
        kalanOdenek: g.kalanOdenek === null ? null : paraYaz(g.kalanOdenek), olusturanId: baglam.kullaniciId,
      },
    })
    const taksitler = await tx.taksit.findMany({
      where: {
        durum: 'PLANLANDI', vadeTarihi: { gte: dbTarih(g.vadeBaslangic), lte: dbTarih(g.vadeBitis) },
        sozlesme: { birimId: g.birimId, durum: { not: 'TASLAK' } }, paketKayitlari: { none: { aktif: true } },
      },
      select: { id: true }, orderBy: [{ vadeTarihi: 'asc' }, { id: 'asc' }],
    })
    const taksitIdleri = taksitler.map((x) => x.id)
    if (taksitIdleri.length > 0) await tx.paketTaksit.createMany({ data: taksitIdleri.map((taksitId) => ({ paketId: p.id, taksitId })) })
    await denetimKaydi(tx, baglam, {
      varlik: 'odeme_paketi', varlikId: p.id, eylem: 'OLUSTUR',
      sonra: { birimId: g.birimId, vadeBaslangic: g.vadeBaslangic, vadeBitis: g.vadeBitis, kalanOdenek: g.kalanOdenek === null ? null : paraYaz(g.kalanOdenek), taksitIdleri },
    })
    return p.id
  }))
}

/**
 * Düzenlemelerin ortak gövdesi: paket düzenlenebilir durumda ve sürüm eşleşmeli; HESAPLANDI paket önce TASLAK'a döner. Sürüm,
 * işlemin sonunda koşullu güncellemeyle artar: araya giren düzenleme varsa CakismaHatasi ve tüm değişiklikler geri alınır.
 */
async function duzenle(
  paketId: number, version: number, baglam: IslemBaglami, eylem: string,
  is: (tx: Tx, p: OdemePaketi) => Promise<Record<string, unknown>>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const p = await tx.odemePaketi.findUnique({ where: { id: paketId } })
    if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
    if (!(DUZENLENEBILIR_DURUMLAR as readonly string[]).includes(p.durum)) {
      throw new IsKuraliHatasi('DURUM', 'Paket kesinleşti ya da iptal edildi; düzenlenemez.')
    }
    if (p.version !== version) throw new CakismaHatasi()
    const sonra = await is(tx, p)
    if (p.durum === 'HESAPLANDI') await taslagaDondur(tx, paketId)
    const r = await tx.odemePaketi.updateMany({ where: { id: paketId, version }, data: { version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, { varlik: 'odeme_paketi', varlikId: paketId, eylem, sonra: { ...sonra, ...(p.durum === 'HESAPLANDI' ? { taslagaDondu: true } : {}) } })
  })
}

export async function paketeTaksitEkle(paketId: number, version: number, taksitIdleri: readonly number[], baglam: IslemBaglami): Promise<void> {
  if (taksitIdleri.length === 0) throw new IsKuraliHatasi('SECIM', 'Eklenecek taksit seçin.')
  await paketteHatasiCevir(() => duzenle(paketId, version, baglam, 'TAKSIT_EKLE', async (tx, p) => {
    await taksitleriDenetle(tx, p.birimId, taksitIdleri)
    await tx.paketTaksit.createMany({ data: taksitIdleri.map((taksitId) => ({ paketId, taksitId })) })
    return { taksitIdleri: [...taksitIdleri] }
  }))
}

export async function pakettenTaksitCikar(paketId: number, version: number, taksitId: number, baglam: IslemBaglami): Promise<void> {
  await duzenle(paketId, version, baglam, 'TAKSIT_CIKAR', async (tx) => {
    const r = await tx.paketTaksit.deleteMany({ where: { paketId, taksitId, aktif: true } })
    if (r.count === 0) throw new BulunamadiHatasi('Taksit bu pakette değil.')
    await tx.paketFatura.deleteMany({ where: { paketId, taksitId } })
    return { taksitId }
  })
}

export async function paketTaksitiBol(paketId: number, version: number, taksitId: number, bolunsun: boolean, baglam: IslemBaglami): Promise<void> {
  await duzenle(paketId, version, baglam, 'BOL', async (tx) => {
    const r = await tx.paketTaksit.updateMany({ where: { paketId, taksitId, aktif: true }, data: { bolunsun } })
    if (r.count === 0) throw new BulunamadiHatasi('Taksit bu pakette değil.')
    return { taksitId, bolunsun }
  })
}

/** Fatura numarası kişisel veri değildir; denetime yazılır. Kişi, taksitin sözleşmesinde (herhangi bir dönemde) malik olmalıdır. */
export async function paketFaturasiKaydet(paketId: number, version: number, g: FaturaGirdisi, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  const faturaNo = g.faturaNo.trim()
  if (faturaNo.length === 0 || faturaNo.length > 50) throw new IsKuraliHatasi('FATURA', 'Fatura numarası 1–50 karakter olmalı.', 'faturaNo')
  if (karsilastir(g.faturaTarihi, bugun) > 0) throw new IsKuraliHatasi('FATURA', 'Fatura tarihi bugünden sonra olamaz.', 'faturaTarihi')
  await duzenle(paketId, version, baglam, 'FATURA', async (tx) => {
    const pt = await tx.paketTaksit.findFirst({ where: { paketId, taksitId: g.taksitId, aktif: true }, include: { taksit: { select: { sozlesmeId: true } } } })
    if (!pt) throw new BulunamadiHatasi('Taksit bu pakette değil.')
    if ((await tx.sozlesmeMalik.count({ where: { sozlesmeId: pt.taksit.sozlesmeId, kisiId: g.kisiId } })) === 0) {
      throw new IsKuraliHatasi('FATURA', 'Fatura yalnızca taksitin sözleşmesindeki malik için girilir.', 'kisiId')
    }
    await tx.paketFatura.upsert({
      where: { paketId_taksitId_kisiId: { paketId, taksitId: g.taksitId, kisiId: g.kisiId } },
      create: { paketId, taksitId: g.taksitId, kisiId: g.kisiId, faturaNo, faturaTarihi: dbTarih(g.faturaTarihi) },
      update: { faturaNo, faturaTarihi: dbTarih(g.faturaTarihi) },
    })
    return { taksitId: g.taksitId, kisiId: g.kisiId, faturaNo, faturaTarihi: g.faturaTarihi }
  })
}
