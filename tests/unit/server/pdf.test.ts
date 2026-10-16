import { describe, expect, it } from 'vitest'
import { bolumBasligi, pdfUret, tablo } from '@/server/cikti/pdf'
import { pdfMetni, pdfSayfalari } from '../../pdf-metni'

describe('pdfUret', () => {
  it('pdfUret %PDF- ile başlar; metin "ğüşıöç ĞÜŞİÖÇ 1.234,56 ₺" aynen çıkar (pdfMetni)', async () => {
    const pdf = await pdfUret({ baslik: 'Deneme', bolumler: [[bolumBasligi('Başlık'), { text: 'ğüşıöç ĞÜŞİÖÇ 1.234,56 ₺' }]] })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(await pdfMetni(pdf)).toContain('ğüşıöç ĞÜŞİÖÇ 1.234,56 ₺')
  }, 30_000)

  it('iki bölüm iki sayfa; altbilgide "Sayfa 2 / 2"', async () => {
    const pdf = await pdfUret({ baslik: 'Deneme', bolumler: [[{ text: 'Birinci' }], [tablo(['Ad', 'Tutar'], [['Ali', { metin: '10,00', sag: true }]])]] })
    const sayfalar = await pdfSayfalari(pdf)
    expect(sayfalar).toHaveLength(2)
    expect(sayfalar[0]).toContain('Sayfa 1 / 2 — KBB Kira Takip')
    expect(sayfalar[1]).toContain('Sayfa 2 / 2')
    expect(sayfalar[1]).toContain('Ali')
  }, 30_000)

  it('filigran metni her sayfada', async () => {
    const pdf = await pdfUret({ baslik: 'Deneme', bolumler: [[{ text: 'A' }], [{ text: 'B' }]], filigran: 'TASLAK — KESİNLEŞMEMİŞ' })
    const sayfalar = await pdfSayfalari(pdf)
    expect(sayfalar.every((s) => s.includes('TASLAK — KESİNLEŞMEMİŞ'))).toBe(true)
  }, 30_000)
})
