import { hisseToplamiBirMi } from '@/core/hisse'
import {
  hatirlatmalariUret, OTOMATIK_KURALLAR, type EksikVeri, type HatirlatmaAdayi, type HatirlatmaVerisi, type Oncelik,
} from '@/core/hatirlatma'
import { bugunIstanbul, gunEkle, icindeMi, karsilastir, type Ay, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, tarihDb, tarihDbOpt } from '../donustur'
import { artisIcinYururluk, artisYururlukSorgusu, ilkDonemArtisBekliyorMu } from '../artis/servis'
import { onayliOranlariYukle } from '../endeks/oranlar'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi } from '../hata'
import { hatirlatmaAyarlari, parametreBitisleri, statuKurallari } from '../parametre/servis'
import { tatilKumesi } from '../tatil/servis'

/**
 * Planlı taksitler en az bu kadar gün ileriye yüklenir. Vade görünürlük günü ya da ödeme emri iş günü sayısı daha uzun bir
 * pencere gerektiriyorsa (parametreler yönetimden değişebilir) pencere onlara göre genişler; aksi halde yüklenmeyen
 * taksitin açık hatırlatması aday listesinden düşer ve kendiliğinden kapanırdı.
 */
const TAKSIT_UFKU_TABANI_GUN = 45

export async function hatirlatmaVerisiYukle(tx: Tx, bugun: Tarih): Promise<HatirlatmaVerisi> {
  const [ayarlar, tatiller, statuler, oranlar, bitisler] = await Promise.all([
    hatirlatmaAyarlari(bugun, tx), tatilKumesi(gunEkle(bugun, -400), gunEkle(bugun, 400), tx), statuKurallari(bugun, tx),
    onayliOranlariYukle(tx), parametreBitisleri(bugun, tx),
  ])
  // Yürürlükteki sözleşmeler: ileri tarihli fesih/sona erme etkin bitişe kadar dahildir (yalnızca H5 ve H12 alır).
  const sozlesmeler = await tx.sozlesme.findMany({
    where: artisYururlukSorgusu(bugun),
    include: {
      tasinmaz: true,
      kiraDonemleri: { orderBy: { baslangic: 'desc' }, take: 1 },
      // Bitişi bugünden sonra olan (ileri tarihli malik değişikliğinde hâlâ geçerli olan) maliklerle bitişi olmayanlar.
      malikler: { where: { OR: [{ gecerlilikBitis: null }, { gecerlilikBitis: { gte: dbTarih(bugun) } }] }, include: { kisi: true, iban: true } },
    },
  })
  const ids = sozlesmeler.map((s) => s.id)
  // İş günü sayısı takvim gününden fazla yer tutar (hafta sonu, tatil); 2 katı ödeme emri hazırlığının görünür olduğu en uzak vadeyi kapsar.
  const taksitUfku = gunEkle(bugun, Math.max(TAKSIT_UFKU_TABANI_GUN, ayarlar.vadeGorunurGun, ayarlar.odemeEmriIsGunu * 2))
  const [pdfler, taksitler, artislar, bekleyen] = await Promise.all([
    tx.belge.groupBy({ by: ['sahipId'], where: { sahipTur: 'sozlesme', belgeTuru: 'SOZLESME', sahipId: { in: ids } } }),
    // Taksit hatırlatmaları sözleşme durumundan bağımsızdır: sona ermiş/feshedilmiş sözleşmenin ödenmemiş taksiti de hatırlatılır.
    tx.taksit.findMany({
      where: { durum: 'PLANLANDI', vadeTarihi: { lte: dbTarih(taksitUfku) }, sozlesme: { durum: { not: 'TASLAK' } } },
      include: { sozlesme: { select: { sozlesmeNo: true, tasinmaz: { select: { kisaAd: true } } } } },
    }),
    tx.artisHesabi.findMany({ where: { sozlesmeId: { in: ids }, durum: { not: 'IPTAL' } } }),
    tx.endeksDegeri.findMany({ where: { onayDurumu: 'BEKLIYOR' } }),
  ])
  const pdfVar = new Set(pdfler.map((p) => p.sahipId))
  return {
    bugun, tatiller, ayarlar,
    sozlesmeler: sozlesmeler.flatMap((s) => {
      const yururluk = artisIcinYururluk(s, bugun)
      if (yururluk === null) return []
      const eksikler: EksikVeri[] = []
      // Eksik veri, bugünün maliklerine göre değerlendirilir: ileri tarihli değişiklikte gelecek malik henüz sayılmaz, bugünkü malik sayılır.
      // Henüz başlamamış (ör. yenileme) sözleşmede "bugün" sözleşmenin ilk günüdür.
      const baslangic = tarihDb(s.baslangic)
      const gun = karsilastir(bugun, baslangic) < 0 ? baslangic : bugun
      const bugunku = s.malikler.filter((m) => icindeMi(gun, { baslangic: tarihDb(m.gecerlilikBaslangic), bitis: tarihDbOpt(m.gecerlilikBitis) }))
      if (bugunku.some((m) => !m.iban || !m.iban.aktif)) eksikler.push('IBAN_YOK')
      if (!hisseToplamiBirMi(bugunku)) eksikler.push('HISSE_TOPLAMI')
      if (!pdfVar.has(s.id)) eksikler.push('SOZLESME_PDF_YOK')
      if (bugunku.some((m) => statuler[m.kisi.vergiStatusu].teyitGerekli && !m.kisi.statuTeyitli)) eksikler.push('STATU_TEYIT')
      if (!s.onayBelgesiNo) eksikler.push('ONAY_BELGESI_YOK')
      return [{
        id: String(s.id), no: s.sozlesmeNo, kisaAd: s.tasinmaz.kisaAd, tasinmazTuru: s.tasinmaz.tur,
        baslangic, bitis: tarihDbOpt(s.bitis), ilkKiraBaslangici: tarihDb(s.ilkKiraBaslangici),
        sonKiraDonemiBaslangici: s.kiraDonemleri[0] ? tarihDb(s.kiraDonemleri[0].baslangic) : baslangic,
        uzamaSayisi: s.uzamaSayisi, artisKurali: s.artisKurali, artisPeriyoduAy: s.artisPeriyoduAy, eksikler,
        sonaErmekte: yururluk.sonaErmekte, bitisEtkin: yururluk.bitisEtkin, ilkDonemArtisBekliyor: ilkDonemArtisBekliyorMu(s, s.kiraDonemleri[0]),
      }]
    }),
    planliTaksitler: taksitler.map((x) => ({
      id: String(x.id), sozlesmeId: String(x.sozlesmeId), sozlesmeNo: x.sozlesme.sozlesmeNo, kisaAd: x.sozlesme.tasinmaz.kisaAd,
      vade: tarihDb(x.vadeTarihi), tutar: x.tutar.toFixed(2),
    })),
    artislar: artislar.flatMap((a) => (a.durum === 'IPTAL' ? [] : [{ sozlesmeId: String(a.sozlesmeId), donemBaslangic: tarihDb(a.donemBaslangic), durum: a.durum }])),
    bekleyenEndeksler: bekleyen.map((e) => ({ id: String(e.id), seri: e.seri, ay: { yil: e.yil, ay: e.ay } })),
    sonOnayliTufe12Ayi: oranlar.sonOnayliTufe12,
    parametreBitisleri: bitisler,
  }
}

function satirVerisi(a: HatirlatmaAdayi) {
  return {
    kural: a.kural, iliskiliTur: a.iliskiliTur, iliskiliId: a.iliskiliId, sozlesmeId: a.sozlesmeId === null ? null : Number(a.sozlesmeId),
    baslik: a.baslik, aciklama: a.aciklama, hedefTarih: dbTarih(a.hedefTarih), gorunurTarih: dbTarih(a.gorunurTarih),
    oncelik: a.oncelik, kararGerekli: a.kararGerekli,
  }
}

/**
 * İdempotent üretim. Ezilmeyenler:
 * - TAMAMLANDI kayıt (içerik, not, durum);
 * - kullanıcının ertelemesi: güncelleme yalnızca içerik alanlarını yazar, `durum`/`ertelenenTarih`e dokunmaz;
 * - OTOMATIK_KURALLAR dışındaki kuralların kayıtları (UZAMA_*, ARTIS_HESAP_HATA, H5_FAZLA_ODEME, H13...): bunları başka
 *   servisler ya da mevzuat izleme yazar; kullanıcı tamamlayana kadar açık kalırlar, üretici asla kapatmaz.
 * Koşulu kalkan otomatik kayıtlar OTOMATIK_KAPANDI olur (ertelenen tarih silinmez); koşul dönerse yeniden açılır,
 * ertelemesi hâlâ ileri tarihliyse ERTELENDI olarak.
 */
export async function hatirlatmalariUretVeKaydet(tx: Tx, bugun: Tarih): Promise<{ yeni: number; guncellenen: number; kapanan: number }> {
  const adaylar = hatirlatmalariUret(await hatirlatmaVerisiYukle(tx, bugun))
  const anahtarlar = adaylar.map((a) => a.anahtar)
  const mevcut = new Map((await tx.hatirlatma.findMany({ where: { anahtar: { in: anahtarlar } } })).map((h) => [h.anahtar, h]))
  const yeniler: (ReturnType<typeof satirVerisi> & { anahtar: string })[] = []
  let guncellenen = 0
  for (const a of adaylar) {
    const v = satirVerisi(a)
    const m = mevcut.get(a.anahtar)
    if (!m) {
      yeniler.push({ anahtar: a.anahtar, ...v })
      continue
    }
    if (m.durum === 'TAMAMLANDI') continue
    const yenidenAc = m.durum === 'OTOMATIK_KAPANDI'
    const degisti = yenidenAc || m.oncelik !== v.oncelik || m.baslik !== v.baslik || m.aciklama !== v.aciklama || m.kararGerekli !== v.kararGerekli
      || tarihDb(m.hedefTarih) !== a.hedefTarih || tarihDb(m.gorunurTarih) !== a.gorunurTarih
    if (!degisti) continue
    const ertelemeSuruyor = m.ertelenenTarih !== null && karsilastir(tarihDb(m.ertelenenTarih), bugun) > 0
    // Okuduktan sonra kullanıcı kaydı tamamladı ya da erteledi ise (durum değişti) bu turda dokunulmaz; sonraki tur yakalar.
    const r = await tx.hatirlatma.updateMany({
      where: { id: m.id, durum: m.durum },
      data: { ...v, ...(yenidenAc ? { durum: ertelemeSuruyor ? 'ERTELENDI' : 'ACIK' } : {}) },
    })
    guncellenen += r.count
  }
  // Eşzamanlı iki üretim aynı anahtarı eklemeye kalkarsa ikincisi hata vermez, satırı atlar.
  const yeni = yeniler.length === 0 ? 0 : (await tx.hatirlatma.createMany({ data: yeniler, skipDuplicates: true })).count
  const kapat = await tx.hatirlatma.updateMany({
    where: { durum: { in: ['ACIK', 'ERTELENDI'] }, kural: { in: [...OTOMATIK_KURALLAR] }, anahtar: { notIn: anahtarlar } },
    data: { durum: 'OTOMATIK_KAPANDI' },
  })
  return { yeni, guncellenen, kapanan: kapat.count }
}

const KULLANICI_ISLEMINE_ACIK = ['ACIK', 'ERTELENDI'] as const

const KAPALI_MESAJI = 'Hatırlatma artık açık değil (tamamlanmış ya da koşulu kalktığı için kapanmış). Sayfayı yenileyip tekrar deneyin.'

/**
 * Denetim satırına not metni yazılmaz: serbest metin kişi adı, telefon gibi kişisel veri içerebilir (KVKK, spec §16).
 * Yalnızca not girildiği ve değişen alanların adları kaydedilir.
 */
export async function hatirlatmaTamamla(id: number, not: string, baglam: IslemBaglami): Promise<void> {
  const metin = not.trim()
  await prisma.$transaction(async (tx) => {
    const h = await tx.hatirlatma.findUnique({ where: { id } })
    if (!h) throw new BulunamadiHatasi('Hatırlatma bulunamadı.')
    // Tamamlanmış kaydın notu/tamamlayanı ikinci bir tamamlamayla ezilmez.
    const r = await tx.hatirlatma.updateMany({
      where: { id, durum: { in: [...KULLANICI_ISLEMINE_ACIK] } },
      data: { durum: 'TAMAMLANDI', tamamlayanId: baglam.kullaniciId, tamamlanmaZamani: new Date(), not: metin || null },
    })
    if (r.count === 0) throw new CakismaHatasi(KAPALI_MESAJI)
    await denetimKaydi(tx, baglam, {
      varlik: 'hatirlatma', varlikId: id, eylem: 'TAMAMLA',
      once: { durum: h.durum },
      sonra: { anahtar: h.anahtar, durum: 'TAMAMLANDI', notGirildi: metin !== '', degisenAlanlar: ['durum', ...(metin ? ['not'] : [])] },
    })
  })
}

export async function hatirlatmaErtele(id: number, tarih: Tarih, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  if (karsilastir(tarih, bugun) <= 0) throw new IsKuraliHatasi('TARIH', 'Erteleme tarihi bugünden sonra olmalı.', 'tarih')
  await prisma.$transaction(async (tx) => {
    const h = await tx.hatirlatma.findUnique({ where: { id } })
    if (!h) throw new BulunamadiHatasi('Hatırlatma bulunamadı.')
    // Tamamlanmış ya da kapanmış kayıt erteleme ile yeniden canlanmaz.
    const r = await tx.hatirlatma.updateMany({
      where: { id, durum: { in: [...KULLANICI_ISLEMINE_ACIK] } },
      data: { durum: 'ERTELENDI', ertelenenTarih: dbTarih(tarih) },
    })
    if (r.count === 0) throw new CakismaHatasi(KAPALI_MESAJI)
    await denetimKaydi(tx, baglam, {
      varlik: 'hatirlatma', varlikId: id, eylem: 'ERTELE',
      once: { durum: h.durum, ertelenenTarih: tarihDbOpt(h.ertelenenTarih) },
      sonra: { anahtar: h.anahtar, durum: 'ERTELENDI', ertelenenTarih: tarih },
    })
  })
}

export type PanoSekmesi = 'gecikmis' | 'bugun' | 'hafta' | 'karar' | 'tumu'

/** Düz değerli pano satırı (Date/Decimal yok). `kural` motorun üretmediği değerler de olabilir: serbest metin olarak ele alın. */
export interface PanoSatiri {
  id: number
  kural: string
  iliskiliTur: string
  sozlesmeId: number | null
  baslik: string
  aciklama: string
  hedef: Tarih
  /** Ertelenmiş kaydın erteleme bitiş günü (bugüne kadar ertelenmişse bugün); ertelenmemişse null. */
  ertelenenTarih: Tarih | null
  oncelik: Oncelik
  kararGerekli: boolean
}

export interface PanoVerisi {
  kartlar: { gecikmis: number; buHaftaVade: number; kararBekleyen: number; sonTufe12: { ay: Ay; oran: string } | null }
  listeler: Record<PanoSekmesi, PanoSatiri[]>
}

const SIRA: Record<Oncelik, number> = { KRITIK: 0, YUKSEK: 1, NORMAL: 2 }

export async function panoVerisi(bugun: Tarih = bugunIstanbul()): Promise<PanoVerisi> {
  const gun = dbTarih(bugun)
  const kayitlar = await prisma.hatirlatma.findMany({
    where: { gorunurTarih: { lte: gun }, OR: [{ durum: 'ACIK' }, { durum: 'ERTELENDI', ertelenenTarih: { lte: gun } }] },
  })
  const satirlar: PanoSatiri[] = kayitlar
    .map((k) => ({
      id: k.id, kural: k.kural, iliskiliTur: k.iliskiliTur, sozlesmeId: k.sozlesmeId, baslik: k.baslik, aciklama: k.aciklama,
      hedef: tarihDb(k.hedefTarih), ertelenenTarih: tarihDbOpt(k.ertelenenTarih), oncelik: k.oncelik, kararGerekli: k.kararGerekli,
    }))
    .sort((a, b) => SIRA[a.oncelik] - SIRA[b.oncelik] || karsilastir(a.hedef, b.hedef) || a.id - b.id)
  const hafta = gunEkle(bugun, 7)
  const listeler: Record<PanoSekmesi, PanoSatiri[]> = {
    gecikmis: satirlar.filter((s) => karsilastir(s.hedef, bugun) < 0),
    // Erteleme bugün biten kayıt hedefi uzak olsa da Bugün'de yeniden görünür: hedefi yaklaşana kadar başka listede olmazdı.
    bugun: satirlar.filter((s) => s.hedef === bugun || s.ertelenenTarih === bugun),
    hafta: satirlar.filter((s) => karsilastir(s.hedef, bugun) > 0 && karsilastir(s.hedef, hafta) <= 0),
    karar: satirlar.filter((s) => s.kararGerekli),
    tumu: satirlar,
  }
  const oranlar = await onayliOranlariYukle()
  const son = oranlar.sonOnayliTufe12
  const sonOran = son === null ? null : oranlar.oran('TUFE_12AY_ORT', son)
  return {
    kartlar: {
      gecikmis: listeler.gecikmis.length,
      buHaftaVade: satirlar.filter((s) => s.kural === 'H1' && karsilastir(s.hedef, bugun) >= 0 && karsilastir(s.hedef, hafta) <= 0).length,
      kararBekleyen: listeler.karar.length,
      sonTufe12: son !== null && sonOran !== null ? { ay: son, oran: sonOran.toString() } : null,
    },
    listeler,
  }
}

/** Düz değerli sözleşme hatırlatması; `kural` serbest metindir (bkz. PanoSatiri). */
export interface SozlesmeHatirlatmasi {
  id: number
  kural: string
  baslik: string
  aciklama: string
  hedef: Tarih
  oncelik: Oncelik
  durum: 'ACIK' | 'ERTELENDI' | 'TAMAMLANDI' | 'OTOMATIK_KAPANDI'
  ertelenen: Tarih | null
  not: string | null
}

const DURUM_SIRASI: Record<SozlesmeHatirlatmasi['durum'], number> = { ACIK: 0, ERTELENDI: 1, TAMAMLANDI: 2, OTOMATIK_KAPANDI: 3 }

/** Açık kayıtlar önce (açık, ertelenmiş, tamamlanmış, kendiliğinden kapanmış), her grupta son tarihe göre. */
export async function sozlesmeHatirlatmalari(sozlesmeId: number): Promise<SozlesmeHatirlatmasi[]> {
  const kayitlar = await prisma.hatirlatma.findMany({ where: { sozlesmeId }, orderBy: [{ hedefTarih: 'asc' }, { id: 'asc' }] })
  return kayitlar
    .map((k) => ({
      id: k.id, kural: k.kural, baslik: k.baslik, aciklama: k.aciklama, hedef: tarihDb(k.hedefTarih), oncelik: k.oncelik,
      durum: k.durum, ertelenen: tarihDbOpt(k.ertelenenTarih), not: k.not,
    }))
    .sort((a, b) => DURUM_SIRASI[a.durum] - DURUM_SIRASI[b.durum])
}
