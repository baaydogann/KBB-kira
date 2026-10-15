import type { SozlesmeDurumu } from '@/generated/prisma'
import type { RozetTonu } from '@/components/ui/rozet'

export const DURUM_TONU: Record<SozlesmeDurumu, RozetTonu> = {
  TASLAK: 'gri', AKTIF: 'yesil', UZADI: 'mavi', FESHEDILDI: 'kirmizi', SONA_ERDI: 'gri',
}

export const DURUM_ETIKETI: Record<SozlesmeDurumu, string> = {
  TASLAK: 'Taslak', AKTIF: 'Aktif', UZADI: 'Uzadı', FESHEDILDI: 'Feshedildi', SONA_ERDI: 'Sona erdi',
}
