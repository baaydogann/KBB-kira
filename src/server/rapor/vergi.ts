import type { DagilimGoruntusu } from '@/core/hesap/goruntu'
import { SIFIR } from '@/core/para'
import { muhtasarSatirlari } from '@/core/rapor/vergi'
import { ayKaydir, birlestir, type Ay } from '@/core/tarih'
import type { ExcelDegeri, ExcelSutunu } from '../cikti/excel'
import { prisma } from '../db'
import { dbTarih, paraDb, tarihDb } from '../donustur'
import { kisiGorunenAd } from '../kisi/servis'

export interface RaporTablosu { baslik: string; sutunlar: readonly ExcelSutunu[]; satirlar: readonly (readonly ExcelDegeri[])[]; uyarilar: string[] }

const KODSUZ_UYARISI = 'Muhtasar ödeme türü kodu belirlenmemiş statü var (ör. vakıf/dernek); müşavire danışın.'

/** Spec §11: vergi listeleri "ödendi tarihine göre"dir; yalnızca ödeme tarihi o ayda olan ODENDI paketler. */
function odenenPaket(ay: Ay) {
  const sonraki = ayKaydir(ay, 1)
  return { durum: 'ODENDI' as const, odemeTarihi: { gte: dbTarih(birlestir(ay.yil, ay.ay, 1)), lt: dbTarih(birlestir(sonraki.yil, sonraki.ay, 1)) } }
}

const kimlikNo = (k: { tip: 'GERCEK' | 'TUZEL'; tckn: string | null; vkn: string | null }) => (k.tip === 'GERCEK' ? k.tckn : k.vkn) ?? ''

/** Muhtasar ve prim hizmet beyannamesi için kira stopajı listesi (hak sahibi ve ödeme türü kodu başına). */
export async function muhtasarListesi(ay: Ay): Promise<RaporTablosu> {
  const dagilimlar = await prisma.taksitDagilim.findMany({ where: { paket: odenenPaket(ay) }, include: { kisi: true } })
  const satirlar = muhtasarSatirlari(dagilimlar.map((d) => ({
    kisiId: String(d.kisiId), turKodu: (d.hesapGoruntusu as unknown as Partial<DagilimGoruntusu>).muhsgkKodu ?? null, kimlikNo: kimlikNo(d.kisi),
    soyadUnvan: (d.kisi.tip === 'GERCEK' ? d.kisi.soyad : d.kisi.unvan) ?? '', ad: d.kisi.tip === 'GERCEK' ? (d.kisi.ad ?? '') : '',
    brut: paraDb(d.brut), stopaj: paraDb(d.stopaj),
  })))
  return {
    baslik: 'Muhtasar listesi',
    sutunlar: [
      { baslik: 'Tür kodu', tur: 'metin', genislik: 10 }, { baslik: 'TCKN/VKN', tur: 'metin', genislik: 14 }, { baslik: 'Soyadı/Unvanı', tur: 'metin', genislik: 30 },
      { baslik: 'Adı', tur: 'metin', genislik: 20 }, { baslik: 'Gayrisafi tutar', tur: 'para' }, { baslik: 'Kesilen vergi', tur: 'para' },
    ],
    satirlar: satirlar.map((s) => [s.turKodu ?? '—', s.kimlikNo, s.soyadUnvan, s.ad, s.brut, s.stopaj]),
    uyarilar: satirlar.some((s) => s.turKodu === null) ? [KODSUZ_UYARISI] : [],
  }
}

/** İstihkaktan kesilen damga vergisi listesi (damga kaydı ve malik başına). */
export async function damgaBeyanListesi(ay: Ay): Promise<RaporTablosu> {
  const kesintiler = await prisma.dagilimKesinti.findMany({
    where: { tur: 'DAMGA', paket: odenenPaket(ay) },
    include: { dagilim: { include: { kisi: true } }, damgaPayi: { include: { damgaKaydi: { include: { sozlesme: { select: { sozlesmeNo: true } } } } } } },
    orderBy: { id: 'asc' },
  })
  const gruplar = new Map<string, (typeof kesintiler)[number][]>()
  for (const k of kesintiler) {
    const anahtar = `${k.damgaPayi!.damgaKaydiId}:${k.dagilim.kisiId}`
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), k])
  }
  const satirlar = [...gruplar.values()].map((g) => {
    const { dagilim, damgaPayi } = g[0]!
    const dk = damgaPayi!.damgaKaydi
    return [dk.sozlesme.sozlesmeNo, kisiGorunenAd(dagilim.kisi), kimlikNo(dagilim.kisi), dk.olay, tarihDb(dk.olayTarihi), g.reduce((t, k) => t.plus(paraDb(k.tutar)), SIFIR)] as const
  }).sort((a, b) => a[0].localeCompare(b[0], 'tr') || a[1].localeCompare(b[1], 'tr'))
  return {
    baslik: 'Damga vergisi listesi',
    sutunlar: [
      { baslik: 'Sözleşme no', tur: 'metin', genislik: 16 }, { baslik: 'Malik', tur: 'metin', genislik: 30 }, { baslik: 'TCKN/VKN', tur: 'metin', genislik: 14 },
      { baslik: 'Damga olayı', tur: 'metin', genislik: 14 }, { baslik: 'Olay tarihi', tur: 'tarih' }, { baslik: 'Kesilen damga', tur: 'para' },
    ],
    satirlar, uyarilar: [],
  }
}

/** 6183 md. 22/A kesintileri (sorgu başına), vergi dairesi ve borçlu sırasıyla. */
export async function kesinti22aListesi(ay: Ay): Promise<RaporTablosu> {
  const kesintiler = await prisma.dagilimKesinti.findMany({
    where: { tur: 'KESINTI_22A', paket: odenenPaket(ay) },
    include: { borcSorgu: { include: { kisi: true } }, paket: { select: { id: true, ad: true, odemeTarihi: true } } },
    orderBy: { id: 'asc' },
  })
  const gruplar = new Map<string, (typeof kesintiler)[number][]>()
  for (const k of kesintiler) {
    const anahtar = `${k.borcSorguId}:${k.paketId}`
    gruplar.set(anahtar, [...(gruplar.get(anahtar) ?? []), k])
  }
  const satirlar = [...gruplar.values()].map((g) => {
    const { borcSorgu: s, paket: p } = g[0]!
    return [
      s!.vergiDairesi ?? '', s!.belgeNo ?? '', tarihDb(s!.sorguTarihi), kisiGorunenAd(s!.kisi), kimlikNo(s!.kisi),
      g.reduce((t, k) => t.plus(paraDb(k.tutar)), SIFIR), `${p.id} — ${p.ad}`, tarihDb(p.odemeTarihi!),
    ] as const
  }).sort((a, b) => a[0].localeCompare(b[0], 'tr') || a[3].localeCompare(b[3], 'tr'))
  return {
    baslik: '22/A kesinti listesi',
    sutunlar: [
      { baslik: 'Vergi dairesi', tur: 'metin', genislik: 20 }, { baslik: 'Belge no', tur: 'metin', genislik: 14 }, { baslik: 'Sorgu tarihi', tur: 'tarih' },
      { baslik: 'Borçlu', tur: 'metin', genislik: 30 }, { baslik: 'TCKN/VKN', tur: 'metin', genislik: 14 }, { baslik: 'Kesinti', tur: 'para' },
      { baslik: 'Paket', tur: 'metin', genislik: 24 }, { baslik: 'Ödeme tarihi', tur: 'tarih' },
    ],
    satirlar, uyarilar: [],
  }
}
