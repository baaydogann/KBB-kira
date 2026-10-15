import { gunEkle, type Tarih } from './tarih'

export interface IcsEtkinlik {
  uid: string
  tarih: Tarih
  baslik: string
  aciklama: string
}

const KODLAYICI = new TextEncoder()

/** RFC 5545 §3.3.11 (TEXT): `\`, `;` ve `,` kaçırılır; her satır sonu (CRLF, çıplak CR, LF) `\n` olur (ham CR/LF içerik satırını bozar). */
function kacis(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
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
      `UID:${kacis(e.uid)}`, // UID de TEXT değeridir (§3.8.4.7)
      `DTSTAMP:${damga(p.olusturma)}`,
      `DTSTART;VALUE=DATE:${e.tarih.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${gunEkle(e.tarih, 1).replace(/-/g, '')}`,
      `SUMMARY:${kacis(e.baslik)}`,
      `DESCRIPTION:${kacis(e.aciklama)}`,
      'TRANSP:TRANSPARENT',
      // Tüm gün etkinliğinin DTSTART'ı yerel 00:00 sayılır; TRIGGER:-PT15H alarmı bir önceki günün 09:00'una kurar (RFC 5545 §3.8.6.3).
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${kacis(e.baslik)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT',
    )
  }
  satirlar.push('END:VCALENDAR')
  return `${satirlar.flatMap(katla).join('\r\n')}\r\n`
}
