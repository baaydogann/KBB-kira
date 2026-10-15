import { onIkiAyOrtalamaDegisim, yillikDegisim } from '@/core/endeks/degisim'
import type { OranSerisi } from '@/core/hesap/artis'
import type { Para } from '@/core/para'
import { ayAnahtari, ayinIlkGunu, ayKaydir, bugunIstanbul, tarihinAyi, type Ay, type Tarih } from '@/core/tarih'
import { SISTEM_BAGLAMI, type IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { jsonYaz, paraDb } from '../donustur'
import { BulunamadiHatasi, CakismaHatasi, IsKuraliHatasi, benzersizIhlaliMi } from '../hata'
import { ParametreYokHatasi, parametreGetir } from '../parametre/servis'
import { EvdsHatasi, evdsSerisiGetir, type EvdsSecenekleri } from './evds'

export interface EndeksCekSonucu { olusturulan: number; guncellenen: number; atlanan: string[]; hatalar: string[] }

export const ORAN_SERILERI: readonly OranSerisi[] = ['TUFE_12AY_ORT', 'TUFE_YILLIK', 'YIUFE_12AY_ORT', 'YIUFE_YILLIK']
export const oranSerisiMi = (x: string): x is OranSerisi => (ORAN_SERILERI as readonly string[]).includes(x)

const SERILER: { parametre: string; ortalama: OranSerisi; yillik: OranSerisi }[] = [
  { parametre: 'EVDS_SERI_TUFE', ortalama: 'TUFE_12AY_ORT', yillik: 'TUFE_YILLIK' },
  { parametre: 'EVDS_SERI_YIUFE', ortalama: 'YIUFE_12AY_ORT', yillik: 'YIUFE_YILLIK' },
]

const yaz4 = (p: Para) => p.toFixed(4)

/**
 * Yüzde değişim -%100'ün altına inemez; %1000'in üstü veri ya da yazım hatasıdır (ör. "31,49" yerine "3149").
 * Onaylı endeks sonradan değiştirilemediğinden, yazılmadan önce denetlenir (aralık dışı değer NUMERIC(14,4) taşmasına da yol açabilir).
 */
const ORAN_ALT_SINIR = -100
const ORAN_UST_SINIR = 1000
const oranMakulMu = (p: Para) => p.greaterThan(ORAN_ALT_SINIR) && p.lessThanOrEqualTo(ORAN_UST_SINIR)

function oranDogrula(p: Para, alan: string): void {
  if (p.decimalPlaces() > 4) throw new IsKuraliHatasi('DEGER', 'Oran en çok 4 ondalık basamak içerebilir.', alan)
  if (!oranMakulMu(p)) {
    throw new IsKuraliHatasi('DEGER', `Oran %${ORAN_ALT_SINIR} (hariç) ile %${ORAN_UST_SINIR} arasında olmalıdır; virgülü kontrol edin (ör. 31,49).`, alan)
  }
}

/**
 * Hesaplanan bir oranı BEKLIYOR kaydı olarak yazar; onaylı, eşzamanlı onaylanan ya da değişmeyen kayda dokunmaz.
 * Yalnızca gerçekten yazılan satır için denetim kaydı düşer (yeniden çalıştırma sessizdir). Kayda API anahtarı girmez.
 */
async function oranKaydet(db: Tx, baglam: IslemBaglami, seri: OranSerisi, hedef: Ay, deger: Para, seriKodu: string, ham: unknown, sonuc: EndeksCekSonucu): Promise<void> {
  const etiket = `${seri} ${ayAnahtari(hedef)}`
  if (!oranMakulMu(deger)) {
    sonuc.atlanan.push(`${etiket}: hesaplanan ${deger.toString()} makul aralığın dışında (EVDS verisi hatalı olabilir).`)
    return
  }
  const anahtar = { seri_yil_ay: { seri, yil: hedef.yil, ay: hedef.ay } }
  const sonra = { seri, ay: ayAnahtari(hedef), deger: deger.toString(), seriKodu }
  const mevcut = await db.endeksDegeri.findUnique({ where: anahtar })
  if (mevcut?.onayDurumu === 'ONAYLANDI') return
  if (mevcut) {
    if (mevcut.evdsDegeri !== null && paraDb(mevcut.evdsDegeri).equals(deger)) return
    // Okuma ile yazma arasında onaylanan kaydın değeri ezilmesin: yazma yalnızca hâlâ BEKLIYOR olan satırı etkiler.
    const yazilan = await db.endeksDegeri.updateMany({
      where: { id: mevcut.id, onayDurumu: 'BEKLIYOR' },
      data: { deger: yaz4(deger), evdsDegeri: yaz4(deger), evdsSeriKodu: seriKodu, hamVeri: jsonYaz(ham) },
    })
    if (yazilan.count === 0) {
      sonuc.atlanan.push(`${etiket}: kayıt eşzamanlı olarak onaylandı; EVDS değeri yazılmadı.`)
      return
    }
    sonuc.guncellenen += 1
    await denetimKaydi(db, baglam, { varlik: 'endeks', varlikId: mevcut.id, eylem: 'EVDS_GUNCELLE', once: { deger: paraDb(mevcut.deger).toString() }, sonra })
    return
  }
  // ON CONFLICT DO NOTHING: eşzamanlı çalışma aynı kaydı oluşturduysa hata (ve iptal edilen transaction) olmaz.
  const olusan = await db.endeksDegeri.createMany({
    data: [{ seri, yil: hedef.yil, ay: hedef.ay, deger: yaz4(deger), evdsDegeri: yaz4(deger), evdsSeriKodu: seriKodu, hamVeri: jsonYaz(ham), kaynak: 'EVDS', onayDurumu: 'BEKLIYOR' }],
    skipDuplicates: true,
  })
  if (olusan.count === 0) {
    sonuc.atlanan.push(`${etiket}: kayıt eşzamanlı olarak oluşturuldu.`)
    return
  }
  sonuc.olusturulan += 1
  const yeni = await db.endeksDegeri.findUniqueOrThrow({ where: anahtar, select: { id: true } })
  await denetimKaydi(db, baglam, { varlik: 'endeks', varlikId: yeni.id, eylem: 'EVDS_CEK', sonra })
}

/** Çekme adımının ürünü: yazılacak oranlar ve (sırası korunarak) atlanan notlar. Düz veridir; veritabanı satırı ya da anahtar taşımaz. */
type EndeksKalemi =
  | { tur: 'atlanan'; mesaj: string }
  | { tur: 'oran'; seri: OranSerisi; hedef: Ay; deger: Para; seriKodu: string; ham: unknown }

export interface EndeksVerisi { kalemler: EndeksKalemi[]; hatalar: string[] }

/**
 * 1. adım: bir önceki ve iki önceki ayın oranlarını EVDS'ten çekip hesaplar. Hiçbir şey yazmaz; açık bir işlem gerektirmez
 * (seri kodu parametreleri `db` ile okunur, uzun HTTP çağrıları sırasında işlem tutulmaz).
 * Seri kodu hedef aya göre seçilir (baz yılları karıştırılmaz): 24 aylık pencerenin tamamı tek seriden gelir.
 * EVDS/parametre sorunları toplu işi durdurmaz; `hatalar`a (erişim, biçim, eksik parametre) ya da `atlanan` notuna (eksik veri) yazılır.
 */
export async function endeksVerisiniGetir(db: Tx, bugun: Tarih, s: EvdsSecenekleri): Promise<EndeksVerisi> {
  const veri: EndeksVerisi = { kalemler: [], hatalar: [] }
  const hedefler = [ayKaydir(tarihinAyi(bugun), -2), ayKaydir(tarihinAyi(bugun), -1)]
  for (const sr of SERILER) {
    for (const hedef of hedefler) {
      let seriKodu: string
      let tablo: Map<string, Para>
      try {
        seriKodu = await parametreGetir(sr.parametre, ayinIlkGunu(hedef), db)
        tablo = await evdsSerisiGetir(seriKodu, ayKaydir(hedef, -23), hedef, s)
      } catch (e) {
        if (e instanceof EvdsHatasi || e instanceof ParametreYokHatasi) {
          veri.hatalar.push(`${sr.parametre} ${ayAnahtari(hedef)}: ${e.message}`)
          continue
        }
        throw e
      }
      const ham = { seriKodu, degerler: Object.fromEntries([...tablo].map(([k, v]) => [k, v.toString()])) }
      for (const [seri, hesap] of [[sr.ortalama, onIkiAyOrtalamaDegisim], [sr.yillik, yillikDegisim]] as const) {
        const r = hesap(tablo, hedef)
        if (!r.ok) {
          veri.kalemler.push({ tur: 'atlanan', mesaj: `${seri} ${ayAnahtari(hedef)}: ${r.hata.mesaj}` })
          continue
        }
        veri.kalemler.push({ tur: 'oran', seri, hedef, deger: r.deger, seriKodu, ham })
      }
    }
  }
  return veri
}

/**
 * 2. adım: çekilen oranları yazar; onaylı kayıtlara dokunmaz. Çağıran bunu tek, kısa bir işlemde çalıştırmalıdır
 * (`prisma.$transaction((tx) => endeksYaz(tx, veri))`): yazılan kayıtlar ve `EVDS_CEK` / `EVDS_GUNCELLE` denetim satırları birlikte
 * kalıcı olur ya da hiç olmaz (varsayılan bağlam: sistem).
 */
export async function endeksYaz(db: Tx, veri: EndeksVerisi, baglam: IslemBaglami = SISTEM_BAGLAMI): Promise<EndeksCekSonucu> {
  const sonuc: EndeksCekSonucu = { olusturulan: 0, guncellenen: 0, atlanan: [], hatalar: [...veri.hatalar] }
  for (const k of veri.kalemler) {
    if (k.tur === 'atlanan') sonuc.atlanan.push(k.mesaj)
    else await oranKaydet(db, baglam, k.seri, k.hedef, k.deger, k.seriKodu, k.ham, sonuc)
  }
  return sonuc
}

/** Çekme + yazma, tek çağrıda (çağıranın verdiği `db` ile). Gece işi iki adımı ayrı çağırır: HTTP işlem dışında, yazma kısa işlemde. */
export async function endeksCek(db: Tx, bugun: Tarih, s: EvdsSecenekleri, baglam: IslemBaglami = SISTEM_BAGLAMI): Promise<EndeksCekSonucu> {
  return endeksYaz(db, await endeksVerisiniGetir(db, bugun, s), baglam)
}

/**
 * TÜİK bülteniyle karşılaştırılmış değer onaylanır. Resmi değer farklıysa o yazılır (kaynak ELLE), EVDS değeri saklanır.
 * Yazma, okunan satır durumuna (BEKLIYOR ve okunan değer) bağlıdır: iki kullanıcı aynı değeri onaylarsa yalnızca biri başarılır,
 * okuma ile onay arasında EVDS değeri değiştiyse kullanıcının görmediği değer onaylanmaz (CakismaHatasi).
 * `gorulenDeger`: kullanıcının sayfada gördüğü (bültenle karşılaştırdığı) EVDS değeri; kayıttaki güncel değerden farklıysa
 * (sayfa açıldıktan sonra `endeksCek` değeri değiştirdiyse) resmi değer girilmiş olsa da onay reddedilir.
 */
export async function endeksOnayla(id: number, resmiDeger: Para | null, baglam: IslemBaglami, gorulenDeger?: Para): Promise<void> {
  if (resmiDeger !== null) oranDogrula(resmiDeger, 'resmiDeger')
  await prisma.$transaction(async (tx) => {
    const e = await tx.endeksDegeri.findUnique({ where: { id } })
    if (!e) throw new BulunamadiHatasi('Endeks kaydı bulunamadı.')
    if (e.onayDurumu === 'ONAYLANDI') throw new IsKuraliHatasi('ONAYLI', 'Bu endeks zaten onaylı.')
    const mevcut = paraDb(e.deger)
    if (gorulenDeger !== undefined && !gorulenDeger.equals(mevcut)) {
      throw new CakismaHatasi('EVDS değeri siz sayfayı açtıktan sonra değişti; sayfayı yenileyip bültenle tekrar karşılaştırın.')
    }
    const farkli = resmiDeger !== null && !resmiDeger.equals(mevcut)
    const deger = farkli ? resmiDeger : mevcut
    const kaynak = farkli ? 'ELLE' : e.kaynak
    const yazilan = await tx.endeksDegeri.updateMany({
      where: { id, onayDurumu: 'BEKLIYOR', deger: e.deger },
      data: { deger: yaz4(deger), kaynak, onayDurumu: 'ONAYLANDI', onaylayanId: baglam.kullaniciId, onayZamani: new Date() },
    })
    if (yazilan.count === 0) {
      throw new CakismaHatasi('Endeks siz işlem yaparken başka biri tarafından onaylandı ya da değiştirildi. Sayfayı yenileyip değeri tekrar kontrol edin.')
    }
    await denetimKaydi(tx, baglam, {
      varlik: 'endeks', varlikId: id, eylem: 'ONAYLA',
      once: { deger: mevcut.toString(), evds: e.evdsDegeri?.toString() ?? null },
      sonra: { seri: e.seri, ay: ayAnahtari({ yil: e.yil, ay: e.ay }), deger: deger.toString(), kaynak },
    })
  })
}

function elleGirisiDogrula(g: { seri: string; ay: Ay; deger: Para }, bugun: Tarih): void {
  if (!oranSerisiMi(g.seri)) throw new IsKuraliHatasi('SERI', 'Geçersiz endeks serisi.', 'seri')
  if (!Number.isInteger(g.ay.yil) || !Number.isInteger(g.ay.ay) || g.ay.yil < 2000 || g.ay.ay < 1 || g.ay.ay > 12) {
    throw new IsKuraliHatasi('AY', 'Geçerli bir ay seçin.', 'ay')
  }
  const bugunAyi = tarihinAyi(bugun)
  if (g.ay.yil * 12 + g.ay.ay > bugunAyi.yil * 12 + bugunAyi.ay) {
    throw new IsKuraliHatasi('AY', 'Gelecekteki bir aya endeks girilemez; onaylı değer sonradan değiştirilemez.', 'ay')
  }
  oranDogrula(g.deger, 'deger')
}

/** Elle girilen değer onaylı açılır. Onaylı kayıt değiştirilemez; bekleyen EVDS kaydının üzerine yazılırsa EVDS değeri saklanır. */
export async function endeksElleGir(g: { seri: OranSerisi; ay: Ay; deger: Para }, baglam: IslemBaglami, bugun: Tarih = bugunIstanbul()): Promise<void> {
  elleGirisiDogrula(g, bugun)
  try {
    await prisma.$transaction(async (tx) => {
      const mevcut = await tx.endeksDegeri.findUnique({ where: { seri_yil_ay: { seri: g.seri, yil: g.ay.yil, ay: g.ay.ay } } })
      if (mevcut?.onayDurumu === 'ONAYLANDI') {
        throw new IsKuraliHatasi('ONAYLI', 'Onaylı endeks değiştirilemez; bu değerle hesaplanmış artışlar etkilenir. Sistem yöneticisine başvurun.')
      }
      const veri = { deger: yaz4(g.deger), kaynak: 'ELLE' as const, onayDurumu: 'ONAYLANDI' as const, onaylayanId: baglam.kullaniciId, onayZamani: new Date() }
      let kayitId: number
      if (mevcut) {
        const yazilan = await tx.endeksDegeri.updateMany({ where: { id: mevcut.id, onayDurumu: 'BEKLIYOR' }, data: veri })
        if (yazilan.count === 0) throw new CakismaHatasi('Endeks siz işlem yaparken başka biri tarafından onaylandı. Sayfayı yenileyip kontrol edin.')
        kayitId = mevcut.id
      } else {
        kayitId = (await tx.endeksDegeri.create({ data: { seri: g.seri, yil: g.ay.yil, ay: g.ay.ay, ...veri }, select: { id: true } })).id
      }
      await denetimKaydi(tx, baglam, {
        varlik: 'endeks', varlikId: kayitId, eylem: 'ELLE_GIR',
        once: mevcut ? { deger: paraDb(mevcut.deger).toString(), kaynak: mevcut.kaynak, onayDurumu: mevcut.onayDurumu } : undefined,
        sonra: { seri: g.seri, ay: ayAnahtari(g.ay), deger: g.deger.toString() },
      })
    })
  } catch (e) {
    // Aynı ayı eşzamanlı ilk kez giren başka bir kullanıcı: ham veritabanı hatası yerine anlaşılır çakışma.
    if (benzersizIhlaliMi(e)) throw new CakismaHatasi('Bu ay için değer siz işlem yaparken başka biri tarafından girildi. Sayfayı yenileyip kontrol edin.')
    throw e
  }
}

export async function bekleyenEndeksler() {
  return prisma.endeksDegeri.findMany({ where: { onayDurumu: 'BEKLIYOR' }, orderBy: [{ yil: 'desc' }, { ay: 'desc' }, { seri: 'asc' }] })
}

/** Son `aySayisi` ay (en yeni üstte). Yayımlanan son ay bir önceki aydır; bu aya elle değer girildiyse tablo bu aydan başlar. */
export async function endeksTablosu(aySayisi = 24, bugun: Tarih = bugunIstanbul()) {
  const bugunAyi = tarihinAyi(bugun)
  const varsayilanSon = ayKaydir(bugunAyi, -1)
  const ilk = ayKaydir(varsayilanSon, -(aySayisi - 1))
  const kayitlar = await prisma.endeksDegeri.findMany({ where: { OR: [{ yil: { gt: ilk.yil } }, { yil: ilk.yil, ay: { gte: ilk.ay } }] } })
  const buAyVar = kayitlar.some((k) => k.yil === bugunAyi.yil && k.ay === bugunAyi.ay)
  const son = buAyVar ? bugunAyi : varsayilanSon
  const aylar = Array.from({ length: aySayisi }, (_, i) => ayKaydir(son, -i))
  const harita = new Map(kayitlar.map((k) => [`${k.seri}:${ayAnahtari({ yil: k.yil, ay: k.ay })}`, k]))
  return aylar.map((ay) => ({
    ay,
    seriler: Object.fromEntries(ORAN_SERILERI.map((s) => [s, harita.get(`${s}:${ayAnahtari(ay)}`) ?? null])) as Record<OranSerisi, (typeof kayitlar)[number] | null>,
  }))
}
