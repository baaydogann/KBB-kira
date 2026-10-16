import type { VergiStatusu } from '@/generated/prisma'
import { DAGILIM_SURUMU, type DagilimGoruntusu } from '@/core/hesap/goruntu'
import type { GecerliSorgu } from '@/core/hesap/kesinti'
import type { StatuKurali } from '@/core/hesap/vergi'
import { paketHesabi, type MalikDonemi, type PaketHesapGirdisi, type PaketTaksitGirdisi, type PaketToplami } from '@/core/paket/hesap'
import type { OnKontrolSonucu } from '@/core/paket/on-kontrol'
import { SIFIR, enBuyuk, type Para } from '@/core/para'
import { enBuyukTarih, gunEkle, karsilastir, type Tarih } from '@/core/tarih'
import { uyumUyarilari } from '@/core/uyum'
import type { IslemBaglami } from '../baglam'
import { onaylanmamisArtisTarihi } from '../artis/servis'
import { damgaKalanlari } from '../damga/servis'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, jsonYaz, oranYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { gecerliSorgu, sorguKullanimi } from '../kesinti/servis'
import { kisiGorunenAd } from '../kisi/servis'
import { parametreGetir, parametreOran, statuKurallari, vergiOranlari } from '../parametre/servis'
import { ibanUygunMu } from '../sozlesme/servis'
import { DUZENLENEBILIR_DURUMLAR } from './servis'

/**
 * Hesabın dayandığı verinin parmak izi: kesinleştirme aynı yüklemeyi kilit altında yineleyip karşılaştırır. Sürümler sözleşme (malik
 * değişikliği, fesih), kişi (statü, teyit) ve taksit (yeniden fiyatlama) değişikliklerini; kaynak kümeleri yeni ya da kapanan haciz, damga
 * payı ve sorguyu yakalar.
 */
export interface HesapParmakIzi {
  sozlesmeler: Record<string, number>
  kisiler: Record<string, number>
  taksitler: Record<string, number>
  hacizler: string[]
  damgaPaylari: string[]
  sorgular: string[]
}

export interface PaketOnKontrolKaydi extends OnKontrolSonucu {
  alicilar22a: { kisiId: string; sorguGerekli: boolean; borcSorguId: string | null }[]
  toplam: Record<keyof PaketToplami, string>
}

type OranAnahtarlari = Map<string, { stopaj: string | null; kdv: string | null }>

const sayisalSirali = (xs: Iterable<number>): string[] => [...new Set(xs)].sort((a, b) => a - b).map(String)

/**
 * Paket hesabının girdisini yükler (spec §6.4–6.5, §10.1-2). Oranlar `bugun`de (tahakkuk) yürürlükteki statü kuralı ve parametreden;
 * malik kayıtları taksit dönemi ile vadeyi kapsayan aralıkla kesişenler; kesinti kaynakları yalnızca kesinleşmiş kullanımı düşülmüş haldedir.
 * Artış beklemesi canlı hesaplanır (F1'in I4 denetimiyle aynı yüklem): taksit dönemi bitene kadar başlayan, onaylanmamış artış var mı?
 */
export async function paketHesapGirdisiYukle(tx: Tx, paketId: number, bugun: Tarih): Promise<{ girdi: PaketHesapGirdisi; parmakIzi: HesapParmakIzi; oranAnahtarlari: OranAnahtarlari }> {
  const p = await tx.odemePaketi.findUnique({
    where: { id: paketId },
    include: {
      faturalar: { select: { taksitId: true, kisiId: true } },
      taksitler: {
        where: { aktif: true },
        include: {
          taksit: {
            include: {
              sozlesme: {
                include: {
                  tasinmaz: { select: { kullanimAmaci: true } },
                  kiraDonemleri: { orderBy: { baslangic: 'desc' }, take: 1 },
                  malikler: { include: { kisi: true, iban: true, vekil: { select: { id: true, version: true } } } },
                },
              },
            },
          },
        },
        orderBy: { taksitId: 'asc' },
      },
    },
  })
  if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
  const kurallar = await statuKurallari(bugun, tx)
  const oranlar = new Map<VergiStatusu, { stopaj: Para; kdv: Para; kural: StatuKurali }>()
  const statuOranlari = async (st: VergiStatusu) => {
    if (!oranlar.has(st)) oranlar.set(st, await vergiOranlari(st, bugun, tx))
    return oranlar.get(st)!
  }
  const oranAnahtarlari: OranAnahtarlari = new Map()
  const sozlesmeSurumleri = new Map<number, number>()
  const kisiSurumleri = new Map<number, number>()
  const taksitSurumleri = new Map<number, number>()
  const ciftler: { sozlesmeId: number; kisiId: number }[] = []

  const taksitler: PaketTaksitGirdisi[] = []
  for (const pt of p.taksitler) {
    const t = pt.taksit
    const s = t.sozlesme
    sozlesmeSurumleri.set(s.id, s.version)
    taksitSurumleri.set(t.id, t.version)
    const donemBaslangic = tarihDb(t.donemBaslangic)
    const donemBitis = tarihDb(t.donemBitis)
    const vade = tarihDb(t.vadeTarihi)
    const son = enBuyukTarih(donemBitis, vade)
    const sonDonem = s.kiraDonemleri[0]
    const artisBekliyor = s.artisKurali !== 'YOK' && sonDonem !== undefined
      && (await onaylanmamisArtisTarihi(tx, s, sonDonem, gunEkle(donemBitis, 1))) !== undefined
    const malikDonemleri: MalikDonemi[] = []
    for (const m of s.malikler) {
      const bas = tarihDb(m.gecerlilikBaslangic)
      const bit = tarihDbOpt(m.gecerlilikBitis)
      if (karsilastir(bas, son) > 0 || (bit !== null && karsilastir(bit, donemBaslangic) < 0)) continue
      const o = await statuOranlari(m.kisi.vergiStatusu)
      const kural = kurallar[m.kisi.vergiStatusu]
      kisiSurumleri.set(m.kisiId, m.kisi.version)
      if (m.vekil) kisiSurumleri.set(m.vekil.id, m.vekil.version)
      oranAnahtarlari.set(String(m.kisiId), { stopaj: kural.stopaj, kdv: kural.kdvli ? 'KDV_GENEL' : null })
      ciftler.push({ sozlesmeId: s.id, kisiId: m.kisiId })
      malikDonemleri.push({
        sozlesmeMalikId: String(m.id), kisiId: String(m.kisiId), kisiAdi: kisiGorunenAd(m.kisi), pay: m.pay, payda: m.payda,
        odemeKisiId: String(m.vekilKisiId ?? m.kisiId), ibanId: m.ibanId === null ? null : String(m.ibanId), ibanUygun: ibanUygunMu(m, m.iban),
        gecerlilikBaslangic: bas, gecerlilikBitis: bit, stopajOrani: o.stopaj, kdvOrani: o.kdv, kdvli: kural.kdvli, stopajli: kural.stopaj !== null,
        muhsgkKodu: kural.muhsgkKodu, teyitGerekli: kural.teyitGerekli, statuTeyitli: m.kisi.statuTeyitli,
      })
    }
    taksitler.push({
      taksitId: String(t.id), sozlesmeId: String(s.id), sozlesmeNo: s.sozlesmeNo, durum: t.durum, donemBaslangic, donemBitis, vade,
      tutar: paraDb(t.tutar), bedelTuru: s.bedelTuru, artisBekliyor, bolunsun: pt.bolunsun, malikDonemleri,
      uyumUyarilari: uyumUyarilari({
        odemePeriyoduAy: s.odemePeriyoduAy, odemeZamani: s.odemeZamani, artisPeriyoduAy: s.artisPeriyoduAy, artisKurali: s.artisKurali,
        kullanimAmaci: s.tasinmaz.kullanimAmaci, taslak: false, tasarrufGenelgesiYururlukte: false,
      }),
    })
  }

  const kisiIdleri = [...new Set(ciftler.map((c) => c.kisiId))]
  const [damgalar, hacizSatirlari] = await Promise.all([
    damgaKalanlari(tx, ciftler),
    tx.haciz.findMany({ where: { kisiId: { in: kisiIdleri }, durum: 'AKTIF', kalanTutar: { gt: 0 } }, orderBy: { id: 'asc' } }),
  ])
  const bulunanSorgular = (await Promise.all(kisiIdleri.map((k) => gecerliSorgu(tx, k, bugun)))).flatMap((s) => (s === null ? [] : [s]))
  const kullanim = await sorguKullanimi(tx, bulunanSorgular.map((s) => s.id), paketId)
  const sorgular: GecerliSorgu[] = bulunanSorgular.map((s) => ({
    borcSorguId: String(s.id), kisiId: String(s.kisiId), borcVar: s.borcVar, borcTutari: paraDb(s.borcTutari),
    kalanBorc: enBuyuk(SIFIR, paraDb(s.borcTutari).minus(kullanim.get(s.id) ?? SIFIR)),
  }))

  const girdi: PaketHesapGirdisi = {
    taksitler, damgalar,
    hacizler: hacizSatirlari.map((x) => ({ hacizId: String(x.id), kisiId: String(x.kisiId), tebligTarihi: tarihDb(x.tebligTarihi), kalan: paraDb(x.kalanTutar) })),
    sorgular,
    esik22aOdeme: await parametreOran('ESIK_22A_ODEME', bugun, tx),
    esik22aBorc: await parametreOran('ESIK_22A_BORC', bugun, tx),
    faturalar: new Set(p.faturalar.map((f) => `${f.taksitId}:${f.kisiId}`)),
    kalanOdenek: p.kalanOdenek === null ? null : paraDb(p.kalanOdenek),
    idareVknVar: (await parametreGetir('IDARE_VKN', bugun, tx)) !== 'GIRILMEDI',
  }
  const parmakIzi: HesapParmakIzi = {
    sozlesmeler: Object.fromEntries([...sozlesmeSurumleri].map(([k, v]) => [String(k), v])),
    kisiler: Object.fromEntries([...kisiSurumleri].map(([k, v]) => [String(k), v])),
    taksitler: Object.fromEntries([...taksitSurumleri].map(([k, v]) => [String(k), v])),
    hacizler: sayisalSirali(hacizSatirlari.map((x) => x.id)),
    damgaPaylari: sayisalSirali(damgalar.map((d) => Number(d.damgaPayiId))),
    sorgular: sayisalSirali(bulunanSorgular.map((s) => s.id)),
  }
  return { girdi, parmakIzi, oranAnahtarlari }
}

const toplamMetni = (t: PaketToplami): Record<keyof PaketToplami, string> => ({
  brut: paraYaz(t.brut), kdv: paraYaz(t.kdv), stopaj: paraYaz(t.stopaj), damga: paraYaz(t.damga), haciz: paraYaz(t.haciz),
  kesinti22a: paraYaz(t.kesinti22a), net: paraYaz(t.net), gider: paraYaz(t.gider),
})

/**
 * Paketi hesaplar: dağılım ve kesinti satırlarını yeniden yazar, ön kontrolü ve parmak izini saklar, paketi HESAPLANDI yapar. Hesap tarihi
 * `bugun`dür (tahakkuk). Taksit satırlarını değiştirmez, sözleşme kilidi almaz; tutarların bayatlamadığını kesinleştirme denetler.
 */
export async function paketHesapla(paketId: number, version: number, baglam: IslemBaglami, bugun: Tarih): Promise<PaketOnKontrolKaydi> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.odemePaketi.findUnique({ where: { id: paketId }, select: { durum: true, version: true } })
    if (!p) throw new BulunamadiHatasi('Ödeme paketi bulunamadı.')
    if (!(DUZENLENEBILIR_DURUMLAR as readonly string[]).includes(p.durum)) throw new IsKuraliHatasi('DURUM', 'Kesinleşmiş ya da iptal edilmiş paket yeniden hesaplanamaz.')
    if (p.version !== version) throw new CakismaHatasi()
    const { girdi, parmakIzi, oranAnahtarlari } = await paketHesapGirdisiYukle(tx, paketId, bugun)
    const h = paketHesabi(girdi)
    const taksitBilgisi = new Map(girdi.taksitler.map((t) => [t.taksitId, t]))

    await tx.dagilimKesinti.deleteMany({ where: { paketId } })
    await tx.taksitDagilim.deleteMany({ where: { paketId } })
    const dagilimKimligi = new Map<string, number>()
    for (const [sira, s] of h.satirlar.entries()) {
      const t = taksitBilgisi.get(s.taksitId)!
      const anahtarlar = oranAnahtarlari.get(s.kisiId)
      const goruntu: DagilimGoruntusu = {
        surum: DAGILIM_SURUMU, hesapTarihi: bugun,
        taksit: { id: s.taksitId, donem: { baslangic: t.donemBaslangic, bitis: t.donemBitis }, vade: t.vade, tutar: paraYaz(t.tutar), bedelTuru: t.bedelTuru },
        parca: { sira: s.parca, baslangic: s.parcaBaslangic, bitis: s.parcaBitis },
        hisse: { pay: s.pay, payda: s.payda },
        oranlar: {
          stopaj: { anahtar: anahtarlar?.stopaj ?? null, deger: s.stopajOrani.toString() },
          kdv: { anahtar: anahtarlar?.kdv ?? null, deger: s.kdvOrani.toString() },
        },
        muhsgkKodu: s.muhsgkKodu,
        kesintiler: h.kesintiler.filter((k) => k.satirAnahtari === s.anahtar).map((k) => ({ tur: k.tur, tutar: paraYaz(k.tutar), kaynakId: k.kaynakId })),
        satirlar: s.satirlar,
      }
      const d = await tx.taksitDagilim.create({
        data: {
          paketId, taksitId: Number(s.taksitId), sozlesmeMalikId: Number(s.sozlesmeMalikId), kisiId: Number(s.kisiId), odemeKisiId: Number(s.odemeKisiId),
          ibanId: s.ibanId === null ? null : Number(s.ibanId), sira, parca: s.parca, parcaBaslangic: dbTarih(s.parcaBaslangic), parcaBitis: dbTarih(s.parcaBitis),
          pay: s.pay, payda: s.payda, brut: paraYaz(s.brut), kdv: paraYaz(s.kdv), stopaj: paraYaz(s.stopaj),
          kdvOrani: oranYaz(s.kdvOrani), stopajOrani: oranYaz(s.stopajOrani),
          damgaKesintisi: paraYaz(s.damga), hacizKesintisi: paraYaz(s.haciz), kesinti22a: paraYaz(s.kesinti22a), net: paraYaz(s.net),
          hesapGoruntusu: jsonYaz(goruntu),
        },
        select: { id: true },
      })
      dagilimKimligi.set(s.anahtar, d.id)
    }
    if (h.kesintiler.length > 0) {
      await tx.dagilimKesinti.createMany({
        data: h.kesintiler.map((k) => ({
          paketId, dagilimId: dagilimKimligi.get(k.satirAnahtari)!, tur: k.tur, tutar: paraYaz(k.tutar),
          hacizId: k.tur === 'HACIZ' ? Number(k.kaynakId) : null,
          borcSorguId: k.tur === 'KESINTI_22A' ? Number(k.kaynakId) : null,
          damgaPayiId: k.tur === 'DAMGA' ? Number(k.kaynakId) : null,
        })),
      })
    }
    for (const [taksitId, surum] of Object.entries(parmakIzi.taksitler)) {
      await tx.paketTaksit.updateMany({ where: { paketId, taksitId: Number(taksitId), aktif: true }, data: { hesaplananTaksitSurumu: surum } })
    }
    const kayit: PaketOnKontrolKaydi = {
      ...h.onKontrol,
      alicilar22a: h.alicilar.map((a) => ({ kisiId: a.kisiId, sorguGerekli: a.sorguGerekli, borcSorguId: a.borcSorguId })),
      toplam: toplamMetni(h.toplam),
    }
    const r = await tx.odemePaketi.updateMany({
      where: { id: paketId, version },
      data: { durum: 'HESAPLANDI', hesapTarihi: dbTarih(bugun), onKontrol: jsonYaz(kayit), hesapParmakIzi: jsonYaz(parmakIzi), version: { increment: 1 } },
    })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, {
      varlik: 'odeme_paketi', varlikId: paketId, eylem: 'HESAPLA',
      sonra: { hesapTarihi: bugun, hataSayisi: kayit.hatalar.length, uyariSayisi: kayit.uyarilar.length, toplam: kayit.toplam },
    })
    return kayit
  }, { timeout: 60_000 })
}
