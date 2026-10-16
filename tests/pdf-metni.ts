import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Her sayfanın metni (pdfjs-dist legacy build; satır sonları boşluk). */
export async function pdfSayfalari(pdf: Uint8Array): Promise<string[]> {
  const gorev = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false })
  const belge = await gorev.promise
  const sayfalar: string[] = []
  for (let i = 1; i <= belge.numPages; i++) {
    const icerik = await (await belge.getPage(i)).getTextContent()
    sayfalar.push(icerik.items.map((x) => ('str' in x ? x.str + (x.hasEOL ? ' ' : '') : '')).join('').replace(/\s+/g, ' ').trim())
  }
  await gorev.destroy()
  return sayfalar
}

/** Sayfa metinleri boşlukla birleşik. */
export async function pdfMetni(pdf: Uint8Array): Promise<string> {
  return (await pdfSayfalari(pdf)).join(' ')
}
