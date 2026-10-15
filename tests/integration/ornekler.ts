import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/server/db'

let sayac = 0
const sonraki = () => ++sayac

/** Geçerli sentetik T.C. kimlik no (gerçek kişiye ait değildir). */
export function tcknUret(n: number): string {
  const d = String(100_000_000 + n).split('').map(Number)
  const tek = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const cift = d[1]! + d[3]! + d[5]! + d[7]!
  d.push((((tek * 7 - cift) % 10) + 10) % 10)
  d.push(d.reduce((a, b) => a + b, 0) % 10)
  return d.join('')
}

/** Geçerli sentetik TR IBAN (banka 00061, hesap n). */
export function ibanUret(n: number): string {
  const bban = `000610${String(n).padStart(16, '0')}`
  let kalan = 0
  for (const c of `${bban}292700`) kalan = (kalan * 10 + Number(c)) % 97
  return `TR${String(98 - kalan).padStart(2, '0')}${bban}`
}

export async function ornekBirim(ek: Partial<Prisma.BirimUncheckedCreateInput> = {}) {
  return prisma.birim.create({ data: { ad: `Birim ${sonraki()}`, kurumsalKod: '46.01.33.01', fonksiyonelKod: '01.3.9.00', ...ek } })
}

export async function ornekTasinmaz(ek: Partial<Prisma.TasinmazUncheckedCreateInput> = {}) {
  return prisma.tasinmaz.create({
    data: { tur: 'ISYERI', kisaAd: `Taşınmaz ${sonraki()}`, adres: 'Örnek Mah. 1. Sok. No:1', ilce: 'Selçuklu', kullanimAmaci: 'HIZMET_BINASI', ...ek },
  })
}

export async function ornekKisi(ek: Partial<Prisma.KisiUncheckedCreateInput> = {}) {
  const n = sonraki()
  return prisma.kisi.create({ data: { tip: 'GERCEK', tckn: tcknUret(n), ad: 'Ad', soyad: `Soyad${n}`, vergiStatusu: 'GMSI_GERCEK', ...ek } })
}

export async function ornekIban(kisiId: number, n = sonraki()) {
  return prisma.iban.create({ data: { kisiId, iban: ibanUret(n) } })
}

export async function ornekSozlesme(ek: Partial<Prisma.SozlesmeUncheckedCreateInput> = {}) {
  const birimId = ek.birimId ?? (await ornekBirim()).id
  const tasinmazId = ek.tasinmazId ?? (await ornekTasinmaz()).id
  return prisma.sozlesme.create({
    data: {
      sozlesmeNo: `S-${sonraki()}`, tasinmazId, birimId, ekonomikKod: '03.5.5.05',
      baslangic: new Date('2026-01-01'), bitis: new Date('2026-12-31'), ilkKiraBaslangici: new Date('2026-01-01'),
      bedelTutari: '10000.00', bedelTabani: 'AYLIK', odemePeriyoduAy: 1, odemeZamani: 'PESIN',
      vadeKurali: 'DONEM_BASI_ARTI_GUN', artisKurali: 'TUFE12', ...ek,
    },
  })
}
