import { basarili, hatali, type Sonuc } from './sonuc'

/** Saat dilimsiz takvim günü: 'YYYY-MM-DD'. */
export type Tarih = string & { readonly __marka: 'Tarih' }
export interface Ay { yil: number; ay: number }
/** Kapalı aralık; bitis null ise açık uçlu. */
export interface Aralik { baslangic: Tarih; bitis: Tarih | null }

const DESEN = /^(\d{4})-(\d{2})-(\d{2})$/
const GUN_MS = 86_400_000
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export function ayinGunSayisi(yil: number, ay: number): number {
  return new Date(Date.UTC(yil, ay, 0)).getUTCDate()
}

export function tarihMi(s: string): s is Tarih {
  const m = DESEN.exec(s)
  if (!m) return false
  const yil = Number(m[1])
  const ay = Number(m[2])
  const gun = Number(m[3])
  return yil >= 1900 && yil <= 2999 && ay >= 1 && ay <= 12 && gun >= 1 && gun <= ayinGunSayisi(yil, ay)
}

export function tarih(s: string): Tarih {
  if (!tarihMi(s)) throw new Error(`Geçersiz tarih: ${s}`)
  return s
}

export function parcala(t: Tarih): { yil: number; ay: number; gun: number } {
  const [yil, ay, gun] = t.split('-').map(Number) as [number, number, number]
  return { yil, ay, gun }
}

export function birlestir(yil: number, ay: number, gun: number): Tarih {
  return tarih(`${String(yil).padStart(4, '0')}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`)
}

function utcMs(t: Tarih): number {
  const { yil, ay, gun } = parcala(t)
  return Date.UTC(yil, ay - 1, gun)
}

function mstenTarih(ms: number): Tarih {
  const d = new Date(ms)
  return birlestir(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function gunEkle(t: Tarih, n: number): Tarih {
  return mstenTarih(utcMs(t) + n * GUN_MS)
}

export function gunFarki(a: Tarih, b: Tarih): number {
  return Math.round((utcMs(b) - utcMs(a)) / GUN_MS)
}

export function ayEkle(t: Tarih, n: number): Tarih {
  const { yil, ay, gun } = parcala(t)
  const toplam = yil * 12 + (ay - 1) + n
  const yeniYil = Math.floor(toplam / 12)
  const yeniAy = toplam - yeniYil * 12 + 1
  return birlestir(yeniYil, yeniAy, Math.min(gun, ayinGunSayisi(yeniYil, yeniAy)))
}

export function karsilastir(a: Tarih, b: Tarih): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export function ayFarki(a: Tarih, b: Tarih): number {
  const pa = parcala(a)
  const pb = parcala(b)
  let k = (pb.yil - pa.yil) * 12 + (pb.ay - pa.ay)
  if (karsilastir(ayEkle(a, k), b) > 0) k -= 1
  return k
}

export function enKucukTarih(a: Tarih, b: Tarih): Tarih {
  return karsilastir(a, b) <= 0 ? a : b
}

export function enBuyukTarih(a: Tarih, b: Tarih): Tarih {
  return karsilastir(a, b) >= 0 ? a : b
}

export function kesisim(a: Aralik, b: Aralik): Aralik | null {
  const baslangic = enBuyukTarih(a.baslangic, b.baslangic)
  const bitis = a.bitis === null ? b.bitis : b.bitis === null ? a.bitis : enKucukTarih(a.bitis, b.bitis)
  if (bitis !== null && karsilastir(baslangic, bitis) > 0) return null
  return { baslangic, bitis }
}

export function icindeMi(t: Tarih, a: Aralik): boolean {
  return karsilastir(t, a.baslangic) >= 0 && (a.bitis === null || karsilastir(t, a.bitis) <= 0)
}

export function tarihinAyi(t: Tarih): Ay {
  const { yil, ay } = parcala(t)
  return { yil, ay }
}

export function ayKaydir(a: Ay, n: number): Ay {
  const toplam = a.yil * 12 + (a.ay - 1) + n
  const yil = Math.floor(toplam / 12)
  return { yil, ay: toplam - yil * 12 + 1 }
}

export function ayAnahtari(a: Ay): string {
  return `${a.yil}-${String(a.ay).padStart(2, '0')}`
}

export function ayinIlkGunu(a: Ay): Tarih {
  return birlestir(a.yil, a.ay, 1)
}

export function ayAdi(a: Ay): string {
  return `${AY_ADLARI[a.ay - 1]} ${a.yil}`
}

export function formatTarih(t: Tarih): string {
  const { yil, ay, gun } = parcala(t)
  return `${String(gun).padStart(2, '0')}.${String(ay).padStart(2, '0')}.${yil}`
}

export function tarihAyristir(girdi: string): Sonuc<Tarih> {
  const temiz = girdi.trim()
  const tr = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(temiz)
  const aday = tr
    ? `${tr[3]}-${tr[2]!.padStart(2, '0')}-${tr[1]!.padStart(2, '0')}`
    : temiz
  if (!tarihMi(aday)) return hatali({ kod: 'TARIH_GECERSIZ', mesaj: 'Tarihi gg.aa.yyyy biçiminde girin.' })
  return basarili(aday)
}

export function dateToTarih(d: Date): Tarih {
  return birlestir(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function tarihToDate(t: Tarih): Date {
  return new Date(utcMs(t))
}

const ISTANBUL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function bugunIstanbul(simdi: Date = new Date()): Tarih {
  return tarih(ISTANBUL.format(simdi))
}

export function haftaSonuMu(t: Tarih): boolean {
  const g = new Date(utcMs(t)).getUTCDay()
  return g === 0 || g === 6
}

export function isGunuMu(t: Tarih, tatiller: ReadonlySet<string>): boolean {
  return !haftaSonuMu(t) && !tatiller.has(t)
}

export function sonrakiIsGunu(t: Tarih, tatiller: ReadonlySet<string>): Tarih {
  let x = t
  while (!isGunuMu(x, tatiller)) x = gunEkle(x, 1)
  return x
}

export function isGunuEkle(t: Tarih, n: number, tatiller: ReadonlySet<string>): Tarih {
  let x = t
  let kalan = Math.abs(n)
  const yon = n >= 0 ? 1 : -1
  while (kalan > 0) {
    x = gunEkle(x, yon)
    if (isGunuMu(x, tatiller)) kalan -= 1
  }
  return x
}
