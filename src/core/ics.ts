import { gunEkle, type Tarih } from './tarih'

export interface IcsEtkinlik {
  uid: string
  tarih: Tarih
  baslik: string
  aciklama: string
}

const KODLAYICI = new TextEncoder()

function kacis(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: satırlar 75 oktetten uzun olamaz; devam satırı tek boşlukla başlar. */
function katla(satir: string): string[] {
  const parcalar: string[] = []
  let mevcut = ''
  let bayt = 0
  for (const ch of satir) {
    const b = KODLAYICI.encode(ch).length
    if (bayt + b > 75) {
      parcalar.push(mevcut)
      mevcut = ` ${ch}`
      bayt = 1 + b
    } else {
      mevcut += ch
      bayt += b
    }
  }
  parcalar.push(mevcut)
  return parcalar
}

function damga(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function icsUret(p: { takvimAdi: string; etkinlikler: readonly IcsEtkinlik[]; olusturma: Date }): string {
  const satirlar: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KBB//Kira Takip//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${kacis(p.takvimAdi)}`, 'X-WR-TIMEZONE:Europe/Istanbul',
  ]
  for (const e of p.etkinlikler) {
    satirlar.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${damga(p.olusturma)}`,
      `DTSTART;VALUE=DATE:${e.tarih.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${gunEkle(e.tarih, 1).replace(/-/g, '')}`,
      `SUMMARY:${kacis(e.baslik)}`,
      `DESCRIPTION:${kacis(e.aciklama)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${kacis(e.baslik)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT',
    )
  }
  satirlar.push('END:VCALENDAR')
  return `${satirlar.flatMap(katla).join('\r\n')}\r\n`
}
