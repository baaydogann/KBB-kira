import { createRequire } from 'node:module'
import type { Para } from '@/core/para'
import { formatTarih, type Tarih } from '@/core/tarih'

// exceljs CommonJS'tir; next.config serverExternalPackages ile paketlenmez.
const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs')

export type HucreTuru = 'metin' | 'para' | 'tarih' | 'tamsayi'
export interface ExcelSutunu { baslik: string; tur: HucreTuru; genislik?: number }
export type ExcelDegeri = string | Para | Tarih | number | null
export interface ExcelSayfasi { ad: string; sutunlar: readonly ExcelSutunu[]; satirlar: readonly (readonly ExcelDegeri[])[]; dipnot?: string }

const VARSAYILAN_GENISLIK: Record<HucreTuru, number> = { metin: 24, para: 14, tarih: 12, tamsayi: 8 }
const BICIM: Record<HucreTuru, string | undefined> = { metin: '@', para: '#,##0.00', tarih: '@', tamsayi: '0' }

function deger(tur: HucreTuru, x: ExcelDegeri): string | number | null {
  if (x === null) return null
  if (tur === 'para') return Number((x as Para).toFixed(2))
  if (tur === 'tarih') return formatTarih(x as Tarih)
  if (tur === 'tamsayi') return x as number
  return String(x)
}

/**
 * Excel dosyası: kimlik numarası ve IBAN gibi alanlar metin (baştaki sıfırlar ve 26 hane korunur); para yalnızca bu sınırda sayıya çevrilir;
 * tarih saat dilimi kaymasın diye gg.aa.yyyy metnidir. Başlık satırı kalın ve dondurulmuş.
 */
export async function excelUret(sayfalar: readonly ExcelSayfasi[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KBB Kira Takip'
  for (const s of sayfalar) {
    // Excel sayfa adı en çok 31 karakterdir ve * ? : \ / [ ] içeremez.
    const ws = wb.addWorksheet(s.ad.replace(/[*?:\\/[\]]/g, '-').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = s.sutunlar.map((c) => ({ header: c.baslik, width: c.genislik ?? VARSAYILAN_GENISLIK[c.tur] }))
    ws.getRow(1).font = { bold: true }
    for (const satir of s.satirlar) {
      const r = ws.addRow(s.sutunlar.map((c, i) => deger(c.tur, satir[i] ?? null)))
      s.sutunlar.forEach((c, i) => { r.getCell(i + 1).numFmt = BICIM[c.tur]! })
    }
    if (s.dipnot) {
      ws.addRow([])
      ws.addRow([s.dipnot]).getCell(1).font = { italic: true }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
