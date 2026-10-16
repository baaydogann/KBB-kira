import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Content, TableCell } from 'pdfmake/interfaces'

export interface PdfBelgesi { baslik: string; bolumler: readonly Content[][]; yatay?: boolean; filigran?: string | null }
export type Hucre = string | { metin: string; sag?: boolean; kalin?: boolean }

// pdfmake CommonJS tekil nesnedir (module.exports = new pdfmake()); ESM ad içe aktarımı yöntemleri görmez, bu yüzden require ile yüklenir.
// next.config serverExternalPackages ile paketlenmez. Yazı tipleri paketin kendi Roboto TTF dosyalarıdır; yolları paketin fonts/Roboto.js
// dosyası (__dirname ile) verir. require.resolve kullanılmaz: webpack onu derlemede modül kimliğine (sayı) çevirir.
const gerekli = createRequire(import.meta.url)
const pdfmake = gerekli('pdfmake') as typeof import('pdfmake')
const ROBOTO = (gerekli('pdfmake/fonts/Roboto') as { Roboto: Record<'normal' | 'bold' | 'italics' | 'bolditalics', string> }).Roboto
const FONT_DIZINI = path.dirname(path.resolve(ROBOTO.normal))

let hazir = false
function hazirla(): void {
  if (hazir) return
  if (!existsSync(path.join(FONT_DIZINI, 'Roboto-Regular.ttf'))) throw new Error('PDF yazı tipi bulunamadı (pdfmake/fonts/Roboto).')
  pdfmake.setFonts({ Roboto: { ...ROBOTO } })
  // Belge tanımı kullanıcı verisi taşır; dış kaynak indirilmez, yerel dosya erişimi yalnızca yazı tipi dizinine açıktır.
  pdfmake.setUrlAccessPolicy(() => false)
  pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(FONT_DIZINI + path.sep))
  hazir = true
}

const uretimAni = () => new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

/** Bölümler arasında sayfa sonu; altbilgi "Sayfa x / y — KBB Kira Takip, <üretim anı>". */
export async function pdfUret(b: PdfBelgesi): Promise<Buffer> {
  hazirla()
  const an = uretimAni()
  const content: Content[] = b.bolumler.flatMap((bolum, i) => (i === 0 ? bolum : [{ text: '', pageBreak: 'before' } as Content, ...bolum]))
  return pdfmake.createPdf({
    info: { title: b.baslik, creator: 'KBB Kira Takip', producer: 'KBB Kira Takip' },
    pageSize: 'A4',
    pageOrientation: b.yatay ? 'landscape' : 'portrait',
    pageMargins: [36, 36, 36, 48],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    ...(b.filigran ? { watermark: { text: b.filigran, opacity: 0.12, bold: true, fontSize: 48 } } : {}),
    footer: (sayfa: number, toplam: number) => ({ text: `Sayfa ${sayfa} / ${toplam} — KBB Kira Takip, ${an}`, alignment: 'center', fontSize: 7, margin: [0, 16, 0, 0] }),
    content,
  }).getBuffer()
}

const hucre = (h: Hucre): TableCell => (typeof h === 'string' ? { text: h } : { text: h.metin, alignment: h.sag ? 'right' : 'left', bold: h.kalin ?? false })

/** Başlık satırı tekrarlanan, ince çizgili tablo. */
export function tablo(basliklar: readonly string[], satirlar: readonly (readonly Hucre[])[], genislikler?: readonly (number | '*' | 'auto')[]): Content {
  return {
    table: {
      headerRows: 1,
      widths: genislikler ? [...genislikler] : basliklar.map(() => '*' as const),
      body: [basliklar.map((x) => ({ text: x, bold: true, fillColor: '#eeeeee' })), ...satirlar.map((s) => s.map(hucre))],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#999999', vLineColor: () => '#999999' },
    margin: [0, 2, 0, 8],
  }
}

export function bolumBasligi(metin: string): Content {
  return { text: metin, bold: true, fontSize: 11, margin: [0, 8, 0, 4] }
}
