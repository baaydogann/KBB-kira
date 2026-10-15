import { para, type Para } from '@/core/para'
import { ayAnahtari, type Ay } from '@/core/tarih'

export const EVDS_TABAN_URL = 'https://evds3.tcmb.gov.tr/igmevdsms-dis'

const VARSAYILAN_ZAMAN_ASIMI_MS = 30_000
const EN_COK_YONLENDIRME = 3
const YONLENDIRME_KODLARI: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
/** HTTP başlık değerinde güvenle taşınabilen görünür ASCII karakterler. */
const BASLIK_GUVENLI = /^[\x21-\x7E]+$/
const SAYI = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/

export class EvdsHatasi extends Error {
  constructor(mesaj: string) {
    super(mesaj)
    this.name = 'EvdsHatasi'
  }
}

export interface EvdsSecenekleri {
  apiAnahtari: string
  fetchFn?: typeof fetch
  tabanUrl?: string
  zamanAsimiMs?: number
}

const iki = (n: number) => String(n).padStart(2, '0')

export function evdsUrl(seri: string, bas: Ay, bit: Ay, taban: string = EVDS_TABAN_URL): string {
  return `${taban}/series=${encodeURIComponent(seri)}&startDate=01-${iki(bas.ay)}-${bas.yil}&endDate=01-${iki(bit.ay)}-${bit.yil}&type=json`
}

function tarihtenAy(ham: unknown): Ay | null {
  const s = typeof ham === 'string' ? ham : ''
  const a = /^(\d{4})-(\d{1,2})$/.exec(s)
  const b = /^\d{1,2}-(\d{1,2})-(\d{4})$/.exec(s)
  const ay = a ? { yil: Number(a[1]), ay: Number(a[2]) } : b ? { yil: Number(b[2]), ay: Number(b[1]) } : null
  return ay !== null && ay.ay >= 1 && ay.ay <= 12 ? ay : null
}

/** Pozitif, sonlu endeks düzeyi; aksi halde null (boş, "ND", sıfır ve negatif değerler eksik veri sayılır). */
function endeksDuzeyi(ham: unknown): Para | null {
  const s = typeof ham === 'number' && Number.isFinite(ham) ? String(ham) : typeof ham === 'string' ? ham.trim() : ''
  if (!SAYI.test(s)) return null
  const p = para(s)
  return p.greaterThan(0) ? p : null
}

/** Yönlendirmede anahtar yalnızca aynı kaynağa ya da https TCMB alan adlarına (evds2 → evds3) gönderilir. */
function yonlendirmeIzinli(hedef: URL, kaynak: URL): boolean {
  if (hedef.origin === kaynak.origin) return true
  return hedef.protocol === 'https:' && (hedef.hostname === 'tcmb.gov.tr' || hedef.hostname.endsWith('.tcmb.gov.tr'))
}

async function govdeyiBirak(y: Response): Promise<void> {
  try {
    await y.body?.cancel()
  } catch {
    // Gövde zaten kapalı; bağlantının havuza dönmesi için yapılan en iyi çaba.
  }
}

/**
 * EVDS3: anahtar yalnızca `key` HTTP başlığında gider; hiçbir hata iletisine, günlüğe ya da özete yazılmaz.
 * Alan adı, seri kodunda noktalar alt çizgiye çevrilmiş halidir. Yönlendirmeler elle izlenir (en çok 3, yalnızca TCMB).
 * Eksik/boş/bozuk satırlar atlanır; hesap katmanı eksik ayı `ENDEKS_YOK` olarak bildirir.
 */
export async function evdsSerisiGetir(seri: string, bas: Ay, bit: Ay, s: EvdsSecenekleri): Promise<Map<string, Para>> {
  const anahtar = s.apiAnahtari.trim()
  if (anahtar === '') throw new EvdsHatasi('EVDS_API_KEY tanımlı değil.')
  if (!BASLIK_GUVENLI.test(anahtar)) throw new EvdsHatasi('EVDS_API_KEY geçersiz karakter içeriyor.')
  const hata = (mesaj: string) => new EvdsHatasi(mesaj.replaceAll(anahtar, '***'))

  const fetchFn = s.fetchFn ?? fetch
  const sinyal = AbortSignal.timeout(s.zamanAsimiMs ?? VARSAYILAN_ZAMAN_ASIMI_MS)
  let adres = evdsUrl(seri, bas, bit, s.tabanUrl)
  let yanit: Response
  for (let yonlendirme = 0; ; yonlendirme++) {
    try {
      yanit = await fetchFn(adres, { headers: { key: anahtar, Accept: 'application/json' }, redirect: 'manual', signal: sinyal })
    } catch (e) {
      throw hata(`EVDS'e ulaşılamadı: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!YONLENDIRME_KODLARI.has(yanit.status)) break
    const konum = yanit.headers.get('location')
    await govdeyiBirak(yanit)
    if (konum === null || konum === '') throw hata(`EVDS ${yanit.status} yönlendirmesi adres vermedi (${seri}).`)
    if (yonlendirme >= EN_COK_YONLENDIRME) throw hata(`EVDS çok fazla yönlendirdi (${seri}).`)
    let hedef: URL
    try {
      hedef = new URL(konum, adres)
    } catch {
      throw hata(`EVDS geçersiz bir yönlendirme adresi verdi (${seri}).`)
    }
    if (!yonlendirmeIzinli(hedef, new URL(adres))) {
      throw hata(`EVDS beklenmeyen bir sunucuya (${hedef.hostname}) yönlendirdi; anahtar gönderilmedi (${seri}).`)
    }
    adres = hedef.toString()
  }

  if (!yanit.ok) {
    await govdeyiBirak(yanit)
    const ipucu = yanit.status === 401 || yanit.status === 403 ? ' API anahtarını kontrol edin.' : ''
    throw hata(`EVDS ${yanit.status} döndü (${seri}).${ipucu}`)
  }
  let govde: unknown
  try {
    govde = await yanit.json()
  } catch {
    throw hata(`EVDS yanıtı geçerli JSON değil (${seri}).`)
  }
  const items = typeof govde === 'object' && govde !== null && !Array.isArray(govde) ? (govde as { items?: unknown }).items : undefined
  if (!Array.isArray(items)) throw hata(`EVDS yanıtında items listesi yok (${seri}).`)

  const alan = seri.replaceAll('.', '_')
  const sonuc = new Map<string, Para>()
  for (const oge of items as unknown[]) {
    if (typeof oge !== 'object' || oge === null) continue
    const kayit = oge as Record<string, unknown>
    const ay = tarihtenAy(kayit.Tarih)
    const deger = endeksDuzeyi(kayit[alan])
    if (ay !== null && deger !== null) sonuc.set(ayAnahtari(ay), deger)
  }
  return sonuc
}
