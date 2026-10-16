const TIRNAK_GEREKLI = /[;"\r\n]/
const FORMUL_BASI = /^[=+\-@\t\r]/

function alan(x: string): string {
  // Formül enjeksiyonu: elektronik tablo programı bu karakterlerle başlayan alanı formül sayar.
  const guvenli = FORMUL_BASI.test(x) ? `'${x}` : x
  return TIRNAK_GEREKLI.test(guvenli) ? `"${guvenli.replaceAll('"', '""')}"` : guvenli
}

/** Excel'in Türkçe ayarına uygun CSV: UTF-8 BOM, `;` ayracı, CRLF; tırnaklama ve formül enjeksiyonu koruması. */
export function csvUret(basliklar: readonly string[], satirlar: readonly (readonly string[])[]): string {
  return '﻿' + [basliklar, ...satirlar].map((s) => s.map(alan).join(';') + '\r\n').join('')
}
