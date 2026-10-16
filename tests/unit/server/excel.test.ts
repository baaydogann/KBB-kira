import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { para } from '@/core/para'
import { tarih as t } from '@/core/tarih'
import { excelUret } from '@/server/cikti/excel'

async function oku(b: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(b as unknown as ArrayBuffer)
  return wb.worksheets[0]!
}

describe('excelUret', () => {
  it('VKN "0123456789" ve IBAN metin olarak aynen geri okunur; hücre türü string', async () => {
    const ws = await oku(await excelUret([{ ad: 'Sayfa', sutunlar: [{ baslik: 'VKN', tur: 'metin' }, { baslik: 'IBAN', tur: 'metin' }], satirlar: [['0123456789', 'TR120006200000000000000001']] }]))
    expect(ws.name).toBe('Sayfa')
    expect([ws.getCell('A1').value, ws.getCell('A1').font?.bold]).toEqual(['VKN', true])
    expect(ws.getCell('A2').value).toBe('0123456789')
    expect(typeof ws.getCell('B2').value).toBe('string')
    expect(ws.getCell('B2').value).toBe('TR120006200000000000000001')
    expect(ws.getCell('A2').numFmt).toBe('@')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('para 1234,56 sayı olarak, numFmt #,##0.00; tarih "05.02.2026" metin', async () => {
    const ws = await oku(await excelUret([{
      ad: 'S', sutunlar: [{ baslik: 'Tutar', tur: 'para' }, { baslik: 'Tarih', tur: 'tarih' }, { baslik: 'Adet', tur: 'tamsayi' }, { baslik: 'Not', tur: 'metin' }],
      satirlar: [[para('1234.56'), t('2026-02-05'), 3, null]], dipnot: 'Dipnot metni',
    }]))
    expect([ws.getCell('A2').value, ws.getCell('A2').numFmt]).toEqual([1234.56, '#,##0.00'])
    expect(ws.getCell('B2').value).toBe('05.02.2026')
    expect(ws.getCell('C2').value).toBe(3)
    expect(ws.getCell('D2').value).toBe(null)
    expect(ws.getCell('A4').value).toBe('Dipnot metni')
  })
})
