import { Cron } from 'croner'

/** Saf zamanlama bilgisi (veritabanı/ortam yok): worker çizelgesi ve gözetim kararı aynı tanımları kullanır. */
export const ZAMAN_DILIMI = 'Europe/Istanbul'

/** EVDS endeks çekiminin yapıldığı ayın günleri (hem çizelgenin hem pano bandının tek kaynağı). */
export const EVDS_PENCERESI = { ilkGun: 3, sonGun: 10 } as const

/** Zamanlanmış işler ve cron ifadeleri (`Europe/Istanbul`). Anahtar sırası gözetim turunun sırasıdır: takvim, endeks, hatırlatma. */
export const IS_ZAMANLARI = {
  'takvim-guncelle': '30 5 * * *',
  'endeks-cek': `15 10-17 ${EVDS_PENCERESI.ilkGun}-${EVDS_PENCERESI.sonGun} * *`,
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

/** Son çalışması HATALI biten işe bu süre dolmadan gözetim yeniden denemez (EVDS'i yarım saatte bir yormamak için). */
export const GOZETIM_GERI_CEKILME_MS = 2 * 3_600_000

export type GozetimKarari = 'calistir' | 'guncel' | 'bekle' | 'geri-cekil' | 'zamanlama-yok'

/**
 * Gözetimin kararı: işin en son zamanlanmış anından beri BAŞARILI çalışma yoksa çalıştırılır.
 * - `zamanlama-yok`: ifade için geçmişte zamanlanmış an yok;
 * - `guncel`: zamanlanmış andan sonra (o an dahil) başarılı çalışma var;
 * - `bekle`: başarı yok ama zamanlanmış an `toleransMs` içinde (zamanlayıcının kendi tetiklemesi sürüyor olabilir; açılış turu 0 verir);
 * - `geri-cekil`: işin son çalışması HATALI bitmiş ve `geriCekilmeMs`'den (2 saat) kısa süre önce başlamış: yeniden denenmez;
 * - `calistir`: aksi halde.
 * `sonHatali`: son çalışması HATALI ise o çalışmanın başlangıcı, değilse null.
 */
export function gozetimKarari(
  g: { sonZamanlanan: Date | null; sonBasari: Date | null; sonHatali?: Date | null; simdi: Date; toleransMs?: number; geriCekilmeMs?: number },
): GozetimKarari {
  if (g.sonZamanlanan === null) return 'zamanlama-yok'
  if (g.sonBasari !== null && g.sonBasari.getTime() >= g.sonZamanlanan.getTime()) return 'guncel'
  if (g.simdi.getTime() - g.sonZamanlanan.getTime() < (g.toleransMs ?? GOZETIM_TOLERANSI_MS)) return 'bekle'
  if (g.sonHatali != null && g.simdi.getTime() - g.sonHatali.getTime() < (g.geriCekilmeMs ?? GOZETIM_GERI_CEKILME_MS)) return 'geri-cekil'
  return 'calistir'
}
