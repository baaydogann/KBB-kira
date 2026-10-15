import { Cron } from 'croner'

/** Saf zamanlama bilgisi (veritabanı/ortam yok): worker çizelgesi ve gözetim kararı aynı tanımları kullanır. */
export const ZAMAN_DILIMI = 'Europe/Istanbul'

/** Zamanlanmış işler ve cron ifadeleri (`Europe/Istanbul`). Anahtar sırası gözetim turunun sırasıdır: takvim, endeks, hatırlatma. */
export const IS_ZAMANLARI = {
  'takvim-guncelle': '30 5 * * *',
  'endeks-cek': '15 10-17 3-10 * *',
  'hatirlatma-uret': '0 6 * * *',
} as const

export type IsAdi = keyof typeof IS_ZAMANLARI

export const IS_SIRASI = Object.keys(IS_ZAMANLARI) as IsAdi[]

/** Kaçırılan çalışmaları yakalayan gözetim turu. */
export const GOZETIM_ZAMANI = '*/30 * * * *'

/** Zamanlayıcının kendi tetiklemesine tanınan süre: gözetim, işin zamanı gelir gelmez ikinci bir çalışma başlatmaz. */
export const GOZETIM_TOLERANSI_MS = 5 * 60_000

/** İfadenin `simdi`den önceki (tam `simdi` hariç) en son zamanlanmış çalışma anı, Europe/Istanbul takvimine göre; yoksa null. */
export function sonZamanlananZaman(ifade: string, simdi: Date): Date | null {
  return new Cron(ifade, { timezone: ZAMAN_DILIMI }).previousRuns(1, simdi)[0] ?? null
}

export type GozetimKarari = 'calistir' | 'guncel' | 'bekle' | 'zamanlama-yok'

/**
 * Gözetimin kararı: işin en son zamanlanmış anından beri BAŞARILI çalışma yoksa çalıştırılır.
 * - `zamanlama-yok`: ifade için geçmişte zamanlanmış an yok;
 * - `guncel`: zamanlanmış andan sonra (o an dahil) başarılı çalışma var;
 * - `bekle`: başarı yok ama zamanlanmış an `tolerans` içinde (zamanlayıcının kendi tetiklemesi sürüyor olabilir);
 * - `calistir`: aksi halde.
 */
export function gozetimKarari(
  g: { sonZamanlanan: Date | null; sonBasari: Date | null; simdi: Date; toleransMs?: number },
): GozetimKarari {
  if (g.sonZamanlanan === null) return 'zamanlama-yok'
  if (g.sonBasari !== null && g.sonBasari.getTime() >= g.sonZamanlanan.getTime()) return 'guncel'
  if (g.simdi.getTime() - g.sonZamanlanan.getTime() < (g.toleransMs ?? GOZETIM_TOLERANSI_MS)) return 'bekle'
  return 'calistir'
}
