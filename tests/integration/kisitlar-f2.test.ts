import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { PaketDurumu, Prisma } from '@/generated/prisma'
import { prisma } from '@/server/db'
import { benzersizIhlaliMi } from '@/server/hata'
import { temizle } from './yardimci'
import { ornekKisi, ornekSozlesme } from './ornekler'

beforeEach(temizle)
afterAll(() => prisma.$disconnect())

const g = (s: string) => new Date(`${s}T00:00:00.000Z`)

interface Kurulum { birimId: number; sozlesmeId: number; taksitId: number; kisiId: number; malikId: number }

async function kurulum(): Promise<Kurulum> {
  const s = await ornekSozlesme()
  const k = await ornekKisi()
  const m = await prisma.sozlesmeMalik.create({ data: { sozlesmeId: s.id, kisiId: k.id, pay: 1, payda: 1, gecerlilikBaslangic: g('2026-01-01') } })
  const t = await prisma.taksit.create({
    data: { sozlesmeId: s.id, tur: 'NORMAL', donemBaslangic: g('2026-02-01'), donemBitis: g('2026-02-28'), vadeTarihi: g('2026-02-01'), tutar: '100.00', hesapGoruntusu: {} },
  })
  return { birimId: s.birimId, sozlesmeId: s.id, taksitId: t.id, kisiId: k.id, malikId: m.id }
}

async function paketAc(k: Kurulum) {
  return prisma.odemePaketi.create({ data: { birimId: k.birimId, ad: 'Şubat 2026', vadeBaslangic: g('2026-02-01'), vadeBitis: g('2026-02-28') } })
}

/** Paket her zaman TASLAK açılır; istenen duruma kısıtların istediği alanlarla geçirilir. */
async function durumaGetir(paketId: number, durum: PaketDurumu) {
  const kesin = durum === 'KESINLESTI' || durum === 'ODEME_EMRINDE' || durum === 'ODENDI'
  return prisma.odemePaketi.update({
    where: { id: paketId },
    data: {
      durum,
      ...(durum === 'HESAPLANDI' || kesin ? { hesapTarihi: g('2026-01-25') } : {}),
      ...(kesin ? { kesinlesmeZamani: new Date() } : {}),
    },
  })
}

function dagilimVerisi(k: Kurulum, paketId: number, ek: Partial<Prisma.TaksitDagilimUncheckedCreateInput> = {}): Prisma.TaksitDagilimUncheckedCreateInput {
  return {
    paketId, taksitId: k.taksitId, sozlesmeMalikId: k.malikId, kisiId: k.kisiId, odemeKisiId: k.kisiId, sira: 0,
    parcaBaslangic: g('2026-02-01'), parcaBitis: g('2026-02-28'), pay: 1, payda: 1,
    brut: '100.00', kdv: '0.00', stopaj: '20.00', kdvOrani: '0', stopajOrani: '20', net: '80.00', hesapGoruntusu: {}, ...ek,
  }
}

async function hesaplanmisDagilim(k: Kurulum) {
  const p = await paketAc(k)
  await durumaGetir(p.id, 'HESAPLANDI')
  const d = await prisma.taksitDagilim.create({ data: dagilimVerisi(k, p.id) })
  return { paketId: p.id, dagilimId: d.id }
}

async function damgaKaydi(sozlesmeId: number, ek: Partial<Prisma.DamgaKaydiUncheckedCreateInput> = {}) {
  return prisma.damgaKaydi.create({
    data: {
      sozlesmeId, olay: 'ILK', olayTarihi: g('2025-12-20'), matrah: '120000.00', oranBinde: '1.89', azami: '24477478.90', tutar: '226.80',
      tahsil: 'ISTIHKAKTAN', gerekce: {}, ...ek,
    },
  })
}

describe('F2 veritabanı kısıtları', () => {
  it('dagilim_denklem: brüt + KDV − kesintiler ≠ net reddedilir', async () => {
    const k = await kurulum()
    const p = await paketAc(k)
    await expect(prisma.taksitDagilim.create({ data: dagilimVerisi(k, p.id, { net: '79.00' }) })).rejects.toThrow(/dagilim_denklem/)
  })

  it('dagilim_net: net < 0 reddedilir', async () => {
    const k = await kurulum()
    const p = await paketAc(k)
    await expect(prisma.taksitDagilim.create({
      data: dagilimVerisi(k, p.id, { brut: '10.00', stopaj: '2.00', hacizKesintisi: '9.00', net: '-1.00' }),
    })).rejects.toThrow(/dagilim_net/)
  })

  it('paket_taksit_aktif_tekil: aynı taksit iki aktif pakette olamaz; ilki aktif=false olunca eklenir', async () => {
    const k = await kurulum()
    const p1 = await paketAc(k)
    const p2 = await paketAc(k)
    const ilk = await prisma.paketTaksit.create({ data: { paketId: p1.id, taksitId: k.taksitId } })
    const hata = await prisma.paketTaksit.create({ data: { paketId: p2.id, taksitId: k.taksitId } }).catch((e: unknown) => e)
    expect(benzersizIhlaliMi(hata)).toBe(true)
    await prisma.paketTaksit.update({ where: { id: ilk.id }, data: { aktif: false } })
    await expect(prisma.paketTaksit.create({ data: { paketId: p2.id, taksitId: k.taksitId } })).resolves.toBeTruthy()
  })

  it('dagilim_degismez: KESINLESTI paketin dağılımı güncellenemez/silinemez; HESAPLANDI iken güncellenebilir', async () => {
    const k = await kurulum()
    const { paketId, dagilimId } = await hesaplanmisDagilim(k)
    await expect(prisma.taksitDagilim.update({ where: { id: dagilimId }, data: { sira: 1 } })).resolves.toBeTruthy()
    await durumaGetir(paketId, 'KESINLESTI')
    await expect(prisma.taksitDagilim.update({ where: { id: dagilimId }, data: { sira: 2 } })).rejects.toThrow(/dagilim_degismez/)
    await expect(prisma.taksitDagilim.delete({ where: { id: dagilimId } })).rejects.toThrow(/dagilim_degismez/)
  })

  it('dagilim_degismez: KESINLESTI pakete kesinti satırı eklenemez', async () => {
    const k = await kurulum()
    const { paketId, dagilimId } = await hesaplanmisDagilim(k)
    const h = await prisma.haciz.create({ data: { kisiId: k.kisiId, alacakli: 'Konya 1. İcra Dairesi', dosyaNo: '2026/1', tebligTarihi: g('2026-01-10'), toplamTutar: '50.00', kalanTutar: '50.00' } })
    await durumaGetir(paketId, 'KESINLESTI')
    await expect(prisma.dagilimKesinti.create({ data: { paketId, dagilimId, tur: 'HACIZ', tutar: '10.00', hacizId: h.id } }))
      .rejects.toThrow(/dagilim_degismez/)
  })

  it('kesinti_kaynak: HACIZ türü haciz_id olmadan reddedilir', async () => {
    const k = await kurulum()
    const { paketId, dagilimId } = await hesaplanmisDagilim(k)
    await expect(prisma.dagilimKesinti.create({ data: { paketId, dagilimId, tur: 'HACIZ', tutar: '10.00' } })).rejects.toThrow(/kesinti_kaynak/)
  })

  it('haciz_tutar: kalan > toplam reddedilir', async () => {
    const k = await kurulum()
    await expect(prisma.haciz.create({
      data: { kisiId: k.kisiId, alacakli: 'Konya 1. İcra Dairesi', dosyaNo: '2026/1', tebligTarihi: g('2026-01-10'), toplamTutar: '100.00', kalanTutar: '150.00' },
    })).rejects.toThrow(/haciz_tutar/)
  })

  it('damga_payi_kalan: kalan > tutar reddedilir', async () => {
    const k = await kurulum()
    const d = await damgaKaydi(k.sozlesmeId)
    await expect(prisma.damgaPayi.create({ data: { damgaKaydiId: d.id, kisiId: k.kisiId, pay: 1, payda: 1, tutar: '10.00', kalan: '11.00' } }))
      .rejects.toThrow(/damga_payi_kalan/)
  })

  it('damga_ilk_tekil: ikinci ILK reddedilir; ilki iptal=true ise eklenir', async () => {
    const k = await kurulum()
    const ilk = await damgaKaydi(k.sozlesmeId)
    const hata = await damgaKaydi(k.sozlesmeId).catch((e: unknown) => e)
    expect(benzersizIhlaliMi(hata)).toBe(true)
    await prisma.damgaKaydi.update({ where: { id: ilk.id }, data: { iptal: true, iptalNedeni: 'test' } })
    await expect(damgaKaydi(k.sozlesmeId)).resolves.toBeTruthy()
  })

  it('borc_sorgu_tutar: borç yokken tutar > 0 reddedilir', async () => {
    const k = await kurulum()
    await expect(prisma.borcSorgu.create({
      data: { kisiId: k.kisiId, sorguTarihi: g('2026-01-25'), gecerlilikBitis: g('2026-02-09'), borcVar: false, borcTutari: '10.00' },
    })).rejects.toThrow(/borc_sorgu_tutar/)
  })

  it('taksit_sistem_disi: sistem dışı ödeme yalnız ODENDI taksitte', async () => {
    const k = await kurulum()
    await expect(prisma.taksit.update({ where: { id: k.taksitId }, data: { sistemDisiOdeme: true } })).rejects.toThrow(/taksit_sistem_disi/)
    await expect(prisma.taksit.update({ where: { id: k.taksitId }, data: { sistemDisiOdeme: true, durum: 'ODENDI' } })).resolves.toBeTruthy()
  })

  it('paket_kesinlesme: KESINLESTI paket kesinleşme zamanı olmadan reddedilir', async () => {
    const k = await kurulum()
    const p = await paketAc(k)
    await expect(prisma.odemePaketi.update({ where: { id: p.id }, data: { durum: 'KESINLESTI', hesapTarihi: g('2026-01-25') } }))
      .rejects.toThrow(/paket_kesinlesme/)
  })

  it('paket_taksit_kilitli: KESINLESTI pakete taksit eklenemez, paketten taksit silinemez', async () => {
    const k = await kurulum()
    const p = await paketAc(k)
    const pt = await prisma.paketTaksit.create({ data: { paketId: p.id, taksitId: k.taksitId } })
    const ikinci = await prisma.taksit.create({
      data: { sozlesmeId: k.sozlesmeId, tur: 'NORMAL', donemBaslangic: g('2026-03-01'), donemBitis: g('2026-03-31'), vadeTarihi: g('2026-03-01'), tutar: '100.00', hesapGoruntusu: {} },
    })
    await durumaGetir(p.id, 'KESINLESTI')
    await expect(prisma.paketTaksit.create({ data: { paketId: p.id, taksitId: ikinci.id } })).rejects.toThrow(/paket_taksit_kilitli/)
    await expect(prisma.paketTaksit.delete({ where: { id: pt.id } })).rejects.toThrow(/paket_taksit_kilitli/)
  })
})
