import { describe, expect, it } from 'vitest'
import type { TaksitDurumu } from '@/generated/prisma'
import { tarih as t } from '@/core/tarih'
import { farkTahakkukEtmisMi, tahakkukEtmisMi } from '@/server/taksit/servis'

const BUGUN = t('2026-02-20')
const g = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('tahakkuk yüklemleri (C1 genellemesi)', () => {
  it.each([
    ['PLANLANDI', '2026-03-01', false, false], ['PLANLANDI', '2026-01-01', false, true], ['PLANLANDI', '2026-03-01', true, true],
    ['PAKETTE', '2026-03-01', false, true], ['ODEME_EMRINDE', '2026-03-01', false, true], ['ODENDI', '2026-03-01', false, true],
    ['IPTAL', '2026-03-01', false, false], ['IPTAL', '2026-01-01', true, false], ['PLANLANDI', '2026-02-20', false, false],
  ] as const)('tahakkukEtmisMi(%s, vade %s, tahakkukEtmisFark %s) = %s (bugün 2026-02-20)', (durum, vade, fark, beklenen) => {
    expect(tahakkukEtmisMi({ durum: durum as TaksitDurumu, vadeTarihi: g(vade), tahakkukEtmisFarkVar: fark }, BUGUN)).toBe(beklenen)
  })

  it.each([
    ['PLANLANDI', '2026-03-02', false], ['PLANLANDI', '2026-02-19', true], ['PAKETTE', '2026-03-02', true], ['ODEME_EMRINDE', '2026-03-02', true],
    ['ODENDI', '2026-03-02', true], ['IPTAL', '2026-02-19', false], ['PLANLANDI', '2026-02-20', false],
  ] as const)('farkTahakkukEtmisMi(%s, vade %s) = %s (bugün 2026-02-20)', (durum, vade, beklenen) => {
    expect(farkTahakkukEtmisMi({ durum: durum as TaksitDurumu, vadeTarihi: g(vade) }, BUGUN)).toBe(beklenen)
  })
})
