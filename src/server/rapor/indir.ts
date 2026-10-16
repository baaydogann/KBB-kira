import type { Para } from '@/core/para'
import { formatTarih, type Ay, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { csvUret } from '../cikti/csv'
import { excelUret, type ExcelDegeri, type ExcelSayfasi, type HucreTuru } from '../cikti/excel'
import { prisma } from '../db'
import { disaAktarimKaydi } from '../denetim'
import { IsKuraliHatasi } from '../hata'
import { damgaBeyanListesi, kesinti22aListesi, muhtasarListesi, type RaporTablosu } from './vergi'

export type RaporAdi = 'muhtasar' | 'damga' | 'kesinti-22a'

const AY_BICIMI = /^\d{4}-(0[1-9]|1[0-2])$/

const RAPORLAR: Record<RaporAdi, (ay: Ay) => Promise<RaporTablosu>> = {
  muhtasar: muhtasarListesi,
  damga: damgaBeyanListesi,
  'kesinti-22a': kesinti22aListesi,
}

const raporAdiMi = (x: string): x is RaporAdi => Object.hasOwn(RAPORLAR, x)

function csvDegeri(tur: HucreTuru, x: ExcelDegeri): string {
  if (x === null) return ''
  if (tur === 'para') return (x as Para).toFixed(2).replace('.', ',')
  if (tur === 'tarih') return formatTarih(x as Tarih)
  return String(x)
}

/** 22/A listesinin ikinci sayfası: vergi dairesi başına toplam. */
function ozetSayfasi(r: RaporTablosu): ExcelSayfasi {
  const toplam = new Map<string, Para>()
  for (const s of r.satirlar) {
    const vd = s[0] as string
    const t = s[5] as Para
    toplam.set(vd, toplam.has(vd) ? toplam.get(vd)!.plus(t) : t)
  }
  return { ad: 'Özet', sutunlar: [{ baslik: 'Vergi dairesi', tur: 'metin', genislik: 24 }, { baslik: 'Toplam kesinti', tur: 'para' }], satirlar: [...toplam].map(([vd, t]) => [vd, t]) }
}

/** Bilinmeyen rapor adı → null (404). Hatalı sorgu parametresi → IsKuraliHatasi (400). */
export async function raporIndir(rapor: string, q: URLSearchParams, baglam: IslemBaglami, bugun: Tarih):
  Promise<{ dosyaAdi: string; icerik: Buffer | string; tur: 'xlsx' | 'csv' } | null> {
  void bugun
  if (!raporAdiMi(rapor)) return null
  const ayMetni = q.get('ay') ?? ''
  if (!AY_BICIMI.test(ayMetni)) throw new IsKuraliHatasi('AY', 'Ay YYYY-AA biçiminde olmalı (ör. 2026-09).', 'ay')
  const bicim = q.get('bicim') ?? 'xlsx'
  if (bicim !== 'xlsx' && bicim !== 'csv') throw new IsKuraliHatasi('BICIM', 'Biçim xlsx ya da csv olmalı.', 'bicim')
  const [yil, ay] = ayMetni.split('-').map(Number) as [number, number]
  const r = await RAPORLAR[rapor]({ yil, ay })
  const icerik = bicim === 'csv'
    ? csvUret(r.sutunlar.map((s) => s.baslik), r.satirlar.map((satir) => r.sutunlar.map((s, i) => csvDegeri(s.tur, satir[i] ?? null))))
    : await excelUret([
      { ad: r.baslik, sutunlar: r.sutunlar, satirlar: r.satirlar, ...(r.uyarilar.length > 0 ? { dipnot: r.uyarilar.join(' ') } : {}) },
      ...(rapor === 'kesinti-22a' ? [ozetSayfasi(r)] : []),
    ])
  await disaAktarimKaydi(prisma, baglam, { varlik: 'rapor', varlikId: rapor, belge: `${rapor}:${ayMetni}`, kayitSayisi: r.satirlar.length })
  return { dosyaAdi: `${rapor}-${ayMetni}.${bicim}`, icerik, tur: bicim }
}
