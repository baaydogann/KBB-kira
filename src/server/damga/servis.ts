import type { DamgaOlayi, DamgaTahsil, Prisma } from '@/generated/prisma'
import type { HesapSatiri } from '@/core/hesap/goruntu'
import { damgaPaylari, damgaTutari, ilkDamgaMatrahi } from '@/core/hesap/damga'
import type { DamgaKalani } from '@/core/hesap/kesinti'
import { SIFIR, topla, type Para } from '@/core/para'
import { icindeMi, type Tarih } from '@/core/tarih'
import type { OdemePeriyodu } from '@/core/tipler'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, jsonYaz, oranYaz, paraDb, paraYaz, tarihDb, tarihDbOpt } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { kisiGorunenAd } from '../kisi/servis'
import { ParametreYokHatasi, parametreOran, parametreTamsayi, vergiOranlari } from '../parametre/servis'

export interface DamgaKaydiGirdisi {
  sozlesmeId: number
  olay: DamgaOlayi
  olayTarihi: Tarih
  /** ILK olayında yok sayılır (otomatik hesaplanır); yazılı artış ve uzatmada zorunludur. */
  matrah: Para | null
  tahsil: DamgaTahsil
}

type SozlesmeMalikli = Prisma.SozlesmeGetPayload<{ include: { malikler: { include: { kisi: true } } } }>

const ILK_VAR = 'Bu sözleşmenin geçerli bir ILK damga kaydı var; önce onu iptal edin.'

function gecerliMalikler(s: SozlesmeMalikli, gun: Tarih) {
  return s.malikler.filter((m) => icindeMi(gun, { baslangic: tarihDb(m.gecerlilikBaslangic), bitis: tarihDbOpt(m.gecerlilikBitis) }))
}

interface DamgaHesabi { matrah: Para; oranBinde: Para; azami: Para; tutar: Para; satirlar: HesapSatiri[]; parametreler: Record<string, string> }

/** K5 hesabı: parametreler olay tarihinde yürürlükte olanlardır. ILK matrahı sözleşmenin ilk bedeli ve ödeme düzeninden (spec §6.7). */
async function damgaHesapla(tx: Tx, s: SozlesmeMalikli, olay: DamgaOlayi, olayTarihi: Tarih, girilenMatrah: Para | null): Promise<DamgaHesabi> {
  const oranBinde = await parametreOran('DAMGA_KIRA_BINDE', olayTarihi, tx)
  const azami = await parametreOran('DAMGA_AZAMI', olayTarihi, tx)
  const parametreler: Record<string, string> = { DAMGA_KIRA_BINDE: oranBinde.toString(), DAMGA_AZAMI: azami.toFixed(2) }
  let matrah: Para
  let satirlar: HesapSatiri[]
  if (olay === 'ILK') {
    const suresizAy = await parametreTamsayi('DAMGA_SURESIZ_AY', olayTarihi, tx)
    if (s.bitis === null) parametreler.DAMGA_SURESIZ_AY = String(suresizAy)
    const baslangic = tarihDb(s.baslangic)
    const malikler = await Promise.all(gecerliMalikler(s, baslangic).map(async (m) => ({
      kisiId: String(m.kisiId), pay: m.pay, payda: m.payda,
      stopajOrani: s.bedelTuru === 'NET' ? (await vergiOranlari(m.kisi.vergiStatusu, olayTarihi, tx)).stopaj : SIFIR,
    })))
    const m = ilkDamgaMatrahi({
      baslangic, bitis: tarihDbOpt(s.bitis), suresizAy, periyotAy: s.odemePeriyoduAy as OdemePeriyodu, kist: s.kistYontemi,
      bedel: paraDb(s.bedelTutari), taban: s.bedelTabani, bedelTuru: s.bedelTuru, malikler,
    })
    if (!m.ok) throw new IsKuraliHatasi(m.hata.kod, `Damga matrahı hesaplanamadı: ${m.hata.mesaj}`)
    matrah = m.deger.matrah
    satirlar = m.deger.satirlar
  } else {
    if (girilenMatrah === null || !girilenMatrah.greaterThan(0)) throw new IsKuraliHatasi('MATRAH', 'Matrahı girin (ek protokoldeki tutar).', 'matrah')
    matrah = girilenMatrah
    satirlar = [{
      kural: 'K5',
      aciklama: olay === 'YAZILI_ARTIS' ? 'Matrah: yazılı artış (artan tutar × kalan süre)' : 'Matrah: yazılı uzatma (uzatılan sürenin kirası)',
      formul: 'ek protokoldeki tutar', sonuc: matrah.toFixed(2),
    }]
  }
  const d = damgaTutari({ matrah, oranBinde, azami })
  return { matrah, oranBinde, azami, tutar: d.tutar, satirlar: [...satirlar, ...d.satirlar], parametreler }
}

async function kayitOlustur(
  tx: Tx, s: SozlesmeMalikli, g: { olay: DamgaOlayi; olayTarihi: Tarih; matrah: Para | null; tahsil: DamgaTahsil }, baglam: IslemBaglami,
): Promise<number> {
  const hesap = await damgaHesapla(tx, s, g.olay, g.olayTarihi, g.matrah)
  // ILK olayında paylar sözleşme başlangıcındaki maliklere, diğerlerinde olay tarihindeki maliklere göre.
  const malikler = gecerliMalikler(s, g.olay === 'ILK' ? tarihDb(s.baslangic) : g.olayTarihi)
  const paylar = damgaPaylari(hesap.tutar, malikler.map((m) => ({ kisiId: String(m.kisiId), pay: m.pay, payda: m.payda })))
  if (!paylar.ok) throw new IsKuraliHatasi('HISSE', 'Olay tarihinde malik hisselerinin toplamı 1 değil; malik kayıtlarını düzeltin.')
  const d = await tx.damgaKaydi.create({
    data: {
      sozlesmeId: s.id, olay: g.olay, olayTarihi: dbTarih(g.olayTarihi), matrah: paraYaz(hesap.matrah), oranBinde: oranYaz(hesap.oranBinde),
      azami: paraYaz(hesap.azami), tutar: paraYaz(hesap.tutar), tahsil: g.tahsil, olusturanId: baglam.kullaniciId,
      gerekce: jsonYaz({ satirlar: hesap.satirlar, parametreler: hesap.parametreler }),
      paylar: {
        create: paylar.deger.map((p) => ({
          kisiId: Number(p.kisiId), pay: p.pay, payda: p.payda, tutar: paraYaz(p.tutar), kalan: paraYaz(g.tahsil === 'ISTIHKAKTAN' ? p.tutar : SIFIR),
        })),
      },
    },
  })
  await denetimKaydi(tx, baglam, {
    varlik: 'damga_kaydi', varlikId: d.id, eylem: 'OLUSTUR',
    sonra: { sozlesmeId: s.id, olay: g.olay, olayTarihi: g.olayTarihi, matrah: paraYaz(hesap.matrah), tutar: paraYaz(hesap.tutar), tahsil: g.tahsil },
  })
  return d.id
}

const sozlesmeYukle = (tx: Tx, id: number) => tx.sozlesme.findUnique({ where: { id }, include: { malikler: { include: { kisi: true } } } })

/**
 * Aktifleştirme işleminin içinden çağrılır. Göç işareti taşıyan sözleşmede (gecisTarihi ya da odenmisSayilanSonTarih dolu; damga büyük
 * olasılıkla imzada ödenmiştir) kayıt açmaz. Olay tarihindeki bir damga parametresi tanımsızsa aktifleştirmeyi durdurmaz: kalıcı, karar
 * gerektiren KRITIK `DAMGA_HATA` hatırlatması açar ve null döner (kayıt Damga sekmesinden sonradan eklenir).
 */
export async function damgaIlkKaydiOlustur(tx: Tx, sozlesmeId: number, baglam: IslemBaglami, bugun: Tarih): Promise<number | null> {
  const s = await sozlesmeYukle(tx, sozlesmeId)
  if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
  if (s.gecisTarihi !== null || s.odenmisSayilanSonTarih !== null) return null
  const olayTarihi = tarihDb(s.imzaTarihi ?? s.baslangic)
  try {
    return await kayitOlustur(tx, s, { olay: 'ILK', olayTarihi, matrah: null, tahsil: s.damgaTahsil }, baglam)
  } catch (e) {
    if (!(e instanceof ParametreYokHatasi)) throw e
    const anahtar = `DAMGA_HATA:sozlesme:${sozlesmeId}`
    const veri = {
      kural: 'DAMGA_HATA', iliskiliTur: 'sozlesme', iliskiliId: String(sozlesmeId), sozlesmeId,
      baslik: `Damga vergisi hesaplanamadı — ${s.sozlesmeNo}`,
      aciklama: `Damga vergisi hesaplanamadı: ${e.message} Parametreyi girip Damga sekmesinden ILK kaydını ekleyin.`,
      hedefTarih: dbTarih(bugun), gorunurTarih: dbTarih(bugun), oncelik: 'KRITIK' as const, kararGerekli: true,
    }
    await tx.hatirlatma.upsert({ where: { anahtar }, create: { anahtar, ...veri }, update: { baslik: veri.baslik, aciklama: veri.aciklama } })
    return null
  }
}

export async function damgaKaydiEkle(g: DamgaKaydiGirdisi, baglam: IslemBaglami): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      const s = await sozlesmeYukle(tx, g.sozlesmeId)
      if (!s) throw new BulunamadiHatasi('Sözleşme bulunamadı.')
      if (s.durum === 'TASLAK') throw new IsKuraliHatasi('DURUM', 'Taslak sözleşmeye damga kaydı eklenemez; önce aktifleştirin.')
      if (g.olay === 'ILK' && (await tx.damgaKaydi.count({ where: { sozlesmeId: s.id, olay: 'ILK', iptal: false } })) > 0) {
        throw new IsKuraliHatasi('ILK', ILK_VAR, 'olay')
      }
      return kayitOlustur(tx, s, g, baglam)
    })
  } catch (e) {
    if (benzersizIhlaliMi(e)) throw new IsKuraliHatasi('ILK', ILK_VAR, 'olay')
    throw e
  }
}

/**
 * İptal yalnızca kesinleşmiş kullanımda engellenir: istihkaktan kayıtta bir payın kalanı tutarından azsa (kesinleşmiş bir pakette kesildi).
 * Taslak ya da hesaplanmış pakette görünen kesinti engellemez; o paket kesinleştirmede değişen kaynakları yakalar. Neden metni denetime yazılmaz.
 */
export async function damgaKaydiIptal(id: number, version: number, neden: string, baglam: IslemBaglami): Promise<void> {
  const metin = neden.trim()
  if (metin.length === 0) throw new IsKuraliHatasi('NEDEN', 'İptal nedenini yazın.', 'neden')
  if (metin.length > 500) throw new IsKuraliHatasi('NEDEN', 'İptal nedeni en çok 500 karakter olabilir.', 'neden')
  await prisma.$transaction(async (tx) => {
    const d = await tx.damgaKaydi.findUnique({ where: { id }, include: { paylar: true } })
    if (!d) throw new BulunamadiHatasi('Damga kaydı bulunamadı.')
    if (d.iptal) throw new IsKuraliHatasi('DURUM', 'Damga kaydı zaten iptal edilmiş.')
    if (d.tahsil === 'ISTIHKAKTAN' && d.paylar.some((p) => paraDb(p.kalan).lessThan(paraDb(p.tutar)))) {
      throw new IsKuraliHatasi('KULLANILDI', 'Bu damga kaydından kesinti yapıldı; önce ilgili paketi iptal edin.')
    }
    const r = await tx.damgaKaydi.updateMany({ where: { id, version, iptal: false }, data: { iptal: true, iptalNedeni: metin, version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, { varlik: 'damga_kaydi', varlikId: id, eylem: 'IPTAL', sonra: { sozlesmeId: d.sozlesmeId, iptal: true, nedenGirildi: true } })
  })
}

export async function damgaMakbuzBagla(id: number, version: number, belgeId: number, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const d = await tx.damgaKaydi.findUnique({ where: { id }, select: { sozlesmeId: true } })
    if (!d) throw new BulunamadiHatasi('Damga kaydı bulunamadı.')
    const b = await tx.belge.findUnique({ where: { id: belgeId }, select: { sahipTur: true, sahipId: true, belgeTuru: true } })
    if (!b || b.sahipTur !== 'sozlesme' || b.sahipId !== d.sozlesmeId || b.belgeTuru !== 'DAMGA_MAKBUZU') {
      throw new IsKuraliHatasi('BELGE', 'Belge bu sözleşmenin damga makbuzu olmalı.', 'belgeId')
    }
    const r = await tx.damgaKaydi.updateMany({ where: { id, version }, data: { makbuzBelgeId: belgeId, version: { increment: 1 } } })
    if (r.count === 0) throw new CakismaHatasi()
    await denetimKaydi(tx, baglam, { varlik: 'damga_kaydi', varlikId: id, eylem: 'MAKBUZ_BAGLA', sonra: { makbuzBelgeId: belgeId } })
  })
}

export interface DamgaKaydiGorunumu {
  id: number
  version: number
  olay: string
  olayTarihi: Tarih
  matrah: string
  oranBinde: string
  tutar: string
  tahsil: string
  kalan: string
  makbuzBelgeId: number | null
  iptal: boolean
  satirlar: HesapSatiri[]
  paylar: { kisiId: number; ad: string; tutar: string; kalan: string }[]
}

export async function sozlesmeDamgaKayitlari(sozlesmeId: number): Promise<DamgaKaydiGorunumu[]> {
  const kayitlar = await prisma.damgaKaydi.findMany({
    where: { sozlesmeId }, include: { paylar: { include: { kisi: true }, orderBy: { kisiId: 'asc' } } }, orderBy: [{ olayTarihi: 'asc' }, { id: 'asc' }],
  })
  return kayitlar.map((d) => ({
    id: d.id, version: d.version, olay: d.olay, olayTarihi: tarihDb(d.olayTarihi), matrah: paraYaz(paraDb(d.matrah)),
    oranBinde: paraDb(d.oranBinde).toString(), tutar: paraYaz(paraDb(d.tutar)), tahsil: d.tahsil,
    kalan: paraYaz(topla(d.paylar.map((p) => paraDb(p.kalan)))), makbuzBelgeId: d.makbuzBelgeId, iptal: d.iptal,
    satirlar: ((d.gerekce ?? {}) as { satirlar?: HesapSatiri[] }).satirlar ?? [],
    paylar: d.paylar.map((p) => ({ kisiId: p.kisiId, ad: kisiGorunenAd(p.kisi), tutar: paraYaz(paraDb(p.tutar)), kalan: paraYaz(paraDb(p.kalan)) })),
  }))
}

/** Paket hesabı için: istihkaktan, iptal edilmemiş ve kalanı > 0 olan paylar; yalnız verilen (sözleşme, kişi) çiftleri. */
export async function damgaKalanlari(db: Tx, ciftler: readonly { sozlesmeId: number; kisiId: number }[]): Promise<DamgaKalani[]> {
  if (ciftler.length === 0) return []
  const istenen = new Set(ciftler.map((c) => `${c.sozlesmeId}:${c.kisiId}`))
  const paylar = await db.damgaPayi.findMany({
    where: {
      kalan: { gt: 0 }, kisiId: { in: [...new Set(ciftler.map((c) => c.kisiId))] },
      damgaKaydi: { iptal: false, tahsil: 'ISTIHKAKTAN', sozlesmeId: { in: [...new Set(ciftler.map((c) => c.sozlesmeId))] } },
    },
    include: { damgaKaydi: { select: { sozlesmeId: true, olayTarihi: true } } },
    orderBy: { id: 'asc' },
  })
  return paylar
    .filter((p) => istenen.has(`${p.damgaKaydi.sozlesmeId}:${p.kisiId}`))
    .map((p) => ({
      damgaPayiId: String(p.id), sozlesmeId: String(p.damgaKaydi.sozlesmeId), kisiId: String(p.kisiId),
      olayTarihi: tarihDb(p.damgaKaydi.olayTarihi), kalan: paraDb(p.kalan),
    }))
}
