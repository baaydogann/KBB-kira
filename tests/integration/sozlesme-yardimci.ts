import { prisma } from '@/server/db'
import { sozlesmeGirdisiSemasi, type SozlesmeGirdisi } from '@/server/sozlesme/sema'
import { seedVerisiniYukle } from '../../prisma/seed-veri'
import { ornekBirim, ornekIban, ornekKisi, ornekTasinmaz } from './ornekler'

export interface Hazirlik {
  birimId: number
  tasinmazId: number
  arsaId: number
  kisiA: number
  kisiB: number
  ibanA: number
  ibanB: number
}

export async function hazirlik(): Promise<Hazirlik> {
  await seedVerisiniYukle(prisma, { tufeOnayli: true })
  const birim = await ornekBirim()
  const tasinmaz = await ornekTasinmaz({ kullananBirimId: birim.id })
  const arsa = await ornekTasinmaz({ tur: 'ARSA', kullanimAmaci: 'DIGER' })
  const a = await ornekKisi()
  const b = await ornekKisi()
  const ia = await ornekIban(a.id)
  const ib = await ornekIban(b.id)
  return { birimId: birim.id, tasinmazId: tasinmaz.id, arsaId: arsa.id, kisiA: a.id, kisiB: b.id, ibanA: ia.id, ibanB: ib.id }
}

let no = 0

/** Varsayılan: 2026 yılı, aylık 10.000 TL brüt, peşin, dönem başı, TÜFE12, tek malik (A). */
export function girdi(h: Hazirlik, ek: Record<string, unknown> = {}): SozlesmeGirdisi {
  return sozlesmeGirdisiSemasi.parse({
    sozlesmeNo: `T-${++no}`, tasinmazId: h.tasinmazId, birimId: h.birimId, ekonomikKod: null,
    imzaTarihi: '2025-12-20', baslangic: '2026-01-01', bitis: '2026-12-31', ilkKiraBaslangici: null,
    bedelTutari: '10.000,00', bedelTabani: 'AYLIK', bedelTuru: 'BRUT', odemePeriyoduAy: 1, odemeZamani: 'PESIN',
    vadeKurali: 'DONEM_BASI_ARTI_GUN', vadeParametresi: 0, artisKurali: 'TUFE12', artisDegisimTuru: 'ON_IKI_AY_ORT',
    sabitArtisOrani: null, artisPeriyoduAy: 12, kistYontemi: 'GERCEK_GUN', damgaTahsil: 'ISTIHKAKTAN', ihaleDayanagi: 'DT_4734_22E',
    onayBelgesiNo: 'OB-1', onayBelgesiTarihi: '2025-12-15', piyasaArastirmaTarihi: null, encumenKararNo: null,
    gecisTarihi: null, gecisBedeli: null, odenmisSayilanSonTarih: null, notlar: null,
    malikler: [{ kisiId: h.kisiA, pay: 1, payda: 1, ibanId: h.ibanA, vekilKisiId: null }],
    ...ek,
  })
}
