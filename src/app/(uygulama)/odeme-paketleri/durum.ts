import type { RozetTonu } from '@/components/ui/rozet'

export const PAKET_DURUMLARI = ['TASLAK', 'HESAPLANDI', 'KESINLESTI', 'ODEME_EMRINDE', 'ODENDI', 'IPTAL'] as const
export type PaketDurumuAdi = (typeof PAKET_DURUMLARI)[number]

export const PAKET_DURUM_ETIKETI: Record<PaketDurumuAdi, string> = {
  TASLAK: 'Taslak', HESAPLANDI: 'Hesaplandı', KESINLESTI: 'Kesinleşti', ODEME_EMRINDE: 'Ödeme emrinde', ODENDI: 'Ödendi', IPTAL: 'İptal',
}

export const PAKET_DURUM_TONU: Record<PaketDurumuAdi, RozetTonu> = {
  TASLAK: 'gri', HESAPLANDI: 'mavi', KESINLESTI: 'sari', ODEME_EMRINDE: 'sari', ODENDI: 'yesil', IPTAL: 'gri',
}
