import { describe, expect, it } from 'vitest'
import { tarih as t } from '@/core/tarih'
import { icsUret } from '@/core/ics'

const olusturma = new Date('2026-10-15T06:00:00Z')

describe('icsUret', () => {
  it('tüm gün etkinliği, alarm ve CRLF satır sonu üretir', () => {
    const ics = icsUret({ takvimAdi: 'KBB Kira', olusturma, etkinlikler: [{ uid: 'H6:sozlesme:1:2026-12-31@kbb-kira', tarih: t('2026-12-31'), baslik: 'Sözleşme bitişi — S-1', aciklama: 'Karar verin' }] })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n')
    expect(ics).toContain('DTSTAMP:20261015T060000Z\r\n')
    expect(ics).toContain('TRIGGER:-PT15H\r\n')
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })
  it('özel karakterleri kaçırır', () => {
    const ics = icsUret({ takvimAdi: 'K', olusturma, etkinlikler: [{ uid: 'x', tarih: t('2026-01-01'), baslik: 'a,b;c\\d', aciklama: 'satır1\nsatır2' }] })
    expect(ics).toContain('SUMMARY:a\\,b\\;c\\\\d')
    expect(ics).toContain('DESCRIPTION:satır1\\nsatır2')
  })
  it('75 bayttan uzun satırları UTF-8 karakter bölmeden katlar', () => {
    const uzun = 'Ödeme emri hazırlığı — Şükrü Öztürk ğüşiöç '.repeat(5)
    const ics = icsUret({ takvimAdi: 'K', olusturma, etkinlikler: [{ uid: 'x', tarih: t('2026-01-01'), baslik: uzun, aciklama: '' }] })
    const enc = new TextEncoder()
    for (const satir of ics.split('\r\n')) expect(enc.encode(satir).length).toBeLessThanOrEqual(75)
    const birlesik = ics.replace(/\r\n /g, '')
    expect(birlesik).toContain(`SUMMARY:${uzun}`)
  })
})
