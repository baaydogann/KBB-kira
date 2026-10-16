import type { Taksit } from '@/generated/prisma'
import { tarih as t, type Tarih } from '@/core/tarih'
import { prisma } from '@/server/db'
import { paketOlustur } from '@/server/paket/servis'
import type { PaketGirdisi } from '@/server/paket/sema'
import { sozlesmeAktiflestir, sozlesmeTaslakKaydet } from '@/server/sozlesme/servis'
import { TEST_BAGLAMI } from './yardimci'
import { girdi, type Hazirlik } from './sozlesme-yardimci'

/** `girdi(h, ek)` ile taslak kaydedip aktifleştirir (varsayılan bugün 2026-01-01). */
export async function aktifSozlesme(h: Hazirlik, ek: Record<string, unknown> = {}, bugun: Tarih = t('2026-01-01')): Promise<number> {
  const id = await sozlesmeTaslakKaydet(girdi(h, ek), TEST_BAGLAMI)
  await sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, bugun)
  return id
}

/** NORMAL/KIST taksitler, dönem sırasıyla (iptal edilenler hariç). */
export function sozlesmeTaksitleri(sozlesmeId: number): Promise<Taksit[]> {
  return prisma.taksit.findMany({ where: { sozlesmeId, tur: { not: 'FARK' }, durum: { not: 'IPTAL' } }, orderBy: { donemBaslangic: 'asc' } })
}

/** Varsayılan: hazırlığın birimi, Şubat 2026 vade aralığı. */
export function paketKur(h: Hazirlik, ek: Partial<PaketGirdisi> = {}): Promise<number> {
  return paketOlustur({ birimId: h.birimId, ad: 'Şubat 2026 kira ödemeleri', vadeBaslangic: t('2026-02-01'), vadeBitis: t('2026-02-28'), kalanOdenek: null, ...ek }, TEST_BAGLAMI)
}

export const paketSurumu = async (paketId: number): Promise<number> => (await prisma.odemePaketi.findUniqueOrThrow({ where: { id: paketId } })).version
