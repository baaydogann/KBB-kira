import { describe, expect, it } from 'vitest'
import { csvUret } from '@/server/cikti/csv'

describe('csvUret', () => {
  it('BOM, ; ayracı ve CRLF', () => {
    expect(csvUret(['Ad', 'Tutar'], [['Ali', '10,00'], ['Veli', '2']])).toBe('﻿Ad;Tutar\r\nAli;"10,00"\r\nVeli;2\r\n'.replace('"10,00"', '10,00'))
  })

  it('"=HYPERLINK(\\"x\\")" → "\'=HYPERLINK(""x"")" tırnaklı; ";" içeren alan tırnaklı', () => {
    const csv = csvUret(['A'], [['=HYPERLINK("x")'], ['a;b'], ['+1'], ['-2'], ['@x'], ['\tx'], ['satır\nsonu'], ['düz']])
    expect(csv.split('\r\n').slice(1, -1)).toEqual(['"\'=HYPERLINK(""x"")"', '"a;b"', "'+1", "'-2", "'@x", "'\tx", '"satır\nsonu"', 'düz'])
    expect(csvUret(['A'], [['\rx']])).toBe('﻿A\r\n"\'\rx"\r\n')
  })
})
