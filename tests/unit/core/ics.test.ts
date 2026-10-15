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
  it('çıplak CR dahil her satır sonu biçimini \\n olarak kaçırır; CR satır yapısını bozmaz', () => {
    const ics = icsUret({ takvimAdi: 'K', olusturma, etkinlikler: [{ uid: 'x', tarih: t('2026-01-01'), baslik: 'a\rb', aciklama: 'x\ry\r\nz\nw' }] })
    expect(ics).toContain('SUMMARY:a\\nb\r\n')
    expect(ics).toContain('DESCRIPTION:x\\ny\\nz\\nw\r\n')
    expect(ics.replace(/\r\n/g, '').includes('\r')).toBe(false)
  })
  it('UID de metin değeridir: , ve ; kaçırılır, satır sonu içeremez; olağan UID değişmez', () => {
    const ozel = icsUret({ takvimAdi: 'K', olusturma, etkinlikler: [{ uid: 'a,b;c\r\nd@kbb-kira', tarih: t('2026-01-01'), baslik: 'b', aciklama: '' }] })
    expect(ozel).toContain('UID:a\\,b\\;c\\nd@kbb-kira\r\n')
    expect(ozel.replace(/\r\n/g, '').includes('\n')).toBe(false)
    const olagan = icsUret({ takvimAdi: 'K', olusturma, etkinlikler: [{ uid: 'H1:taksit:12:2026-10-20@kbb-kira', tarih: t('2026-01-01'), baslik: 'b', aciklama: '' }] })
    expect(olagan).toContain('UID:H1:taksit:12:2026-10-20@kbb-kira\r\n')
  })
  it('etkinlik listesi boşsa da geçerli bir VCALENDAR (yalnızca başlık özellikleri) üretir', () => {
    const ics = icsUret({ takvimAdi: 'KBB Kira', olusturma, etkinlikler: [] })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('PRODID:-//KBB//Kira Takip//TR\r\n')
    expect(ics).toContain('X-WR-CALNAME:KBB Kira\r\n')
    expect(ics).not.toContain('VEVENT')
    expect(ics).not.toContain('VALARM')
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
