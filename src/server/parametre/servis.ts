import { z } from 'zod'
import { VARSAYILAN_STATU_KURALLARI, type StatuKurali } from '@/core/hesap/vergi'
import type { HatirlatmaAyarlari, ParametreBitisi } from '@/core/hatirlatma'
import { SIFIR, para, type Para } from '@/core/para'
import { gunEkle, karsilastir, type Tarih } from '@/core/tarih'
import type { KullanimAmaci, TasinmazTuru, VergiStatusu } from '@/core/tipler'
import type { IslemBaglami } from '../baglam'
import { prisma, type Tx } from '../db'
import { denetimKaydi } from '../denetim'
import { dbTarih, dbTarihOpt, tarihDb, tarihDbOpt } from '../donustur'
import { IsKuraliHatasi, benzersizIhlaliMi, kisitIhlaliMi } from '../hata'

export class ParametreYokHatasi extends Error {
  constructor(anahtar: string, tarih: Tarih) {
    super(`${anahtar} parametresi ${tarih} için tanımlı değil. Yönetim > Parametreler ekranından ekleyin.`)
    this.name = 'ParametreYokHatasi'
  }
}

export async function parametreOpsiyonel(anahtar: string, tarih: Tarih, db: Tx = prisma): Promise<string | null> {
  const d = dbTarih(tarih)
  const p = await db.parametre.findFirst({
    where: { anahtar, yururlukBaslangic: { lte: d }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: d } }] },
    orderBy: { yururlukBaslangic: 'desc' },
  })
  return p?.deger ?? null
}

export async function parametreGetir(anahtar: string, tarih: Tarih, db: Tx = prisma): Promise<string> {
  const v = await parametreOpsiyonel(anahtar, tarih, db)
  if (v === null) throw new ParametreYokHatasi(anahtar, tarih)
  return v
}

export async function parametreOran(anahtar: string, tarih: Tarih, db: Tx = prisma): Promise<Para> {
  return para(await parametreGetir(anahtar, tarih, db))
}

export async function parametreTamsayi(anahtar: string, tarih: Tarih, db: Tx = prisma): Promise<number> {
  const s = await parametreGetir(anahtar, tarih, db)
  if (!/^-?\d+$/.test(s)) throw new Error(`${anahtar} parametresi tamsayı değil: ${s}`)
  return Number(s)
}

export async function hatirlatmaAyarlari(tarih: Tarih, db: Tx = prisma): Promise<HatirlatmaAyarlari> {
  const s = (a: string) => parametreTamsayi(a, tarih, db)
  return {
    vadeGorunurGun: await s('HATIRLATMA_VADE_GORUNUR_GUN'),
    vadeYuksekGun: await s('HATIRLATMA_VADE_YUKSEK_GUN'),
    odemeEmriIsGunu: await s('HATIRLATMA_ODEME_EMRI_IS_GUNU'),
    artisOnceGun: await s('HATIRLATMA_ARTIS_ONCE_GUN'),
    bitisGorunurGun: await s('HATIRLATMA_BITIS_GORUNUR_GUN'),
    bitisYuksekGun: await s('HATIRLATMA_BITIS_YUKSEK_GUN'),
    bitisKritikGun: await s('HATIRLATMA_BITIS_KRITIK_GUN'),
    fesihBildirimGun: await s('TBK347_FESIH_BILDIRIM_GUN'),
    fesihSonGunGorunurGun: await s('HATIRLATMA_FESIH_SON_GUN_GORUNUR_GUN'),
    tespitOnceAy: await s('HATIRLATMA_TESPIT_ONCE_AY'),
    uzama10OnceAy: await s('HATIRLATMA_UZAMA10_ONCE_AY'),
    mevzuatOnceGun: await s('HATIRLATMA_MEVZUAT_ONCE_GUN'),
  }
}

/** Çekirdekteki statü tablosundan türetilir; yeni bir VergiStatusu eklenirse seed ve okuma onu kendiliğinden kapsar. */
const STATULER = Object.keys(VARSAYILAN_STATU_KURALLARI) as VergiStatusu[]

const statuSemasi = z.object({
  stopaj: z.enum(['STOPAJ_94_5A', 'STOPAJ_94_5B', 'STOPAJ_KVK_15_1B']).nullable(),
  kdvli: z.boolean(),
  teyitGerekli: z.boolean(),
  muhsgkKodu: z.enum(['041', '042']).nullable(),
})

export async function statuKurallari(tarih: Tarih, db: Tx = prisma): Promise<Record<VergiStatusu, StatuKurali>> {
  const sonuc = {} as Record<VergiStatusu, StatuKurali>
  for (const st of STATULER) {
    const k = statuSemasi.parse(JSON.parse(await parametreGetir(`STATU_KURALI_${st}`, tarih, db)))
    sonuc[st] = { etiket: VARSAYILAN_STATU_KURALLARI[st].etiket, ...k }
  }
  return sonuc
}

export async function vergiOranlari(statu: VergiStatusu, tarih: Tarih, db: Tx = prisma): Promise<{ stopaj: Para; kdv: Para; kural: StatuKurali }> {
  const kural = (await statuKurallari(tarih, db))[statu]
  const stopaj = kural.stopaj === null ? SIFIR : await parametreOran(kural.stopaj, tarih, db)
  const kdv = kural.kdvli ? await parametreOran('KDV_GENEL', tarih, db) : SIFIR
  return { stopaj, kdv, kural }
}

export async function varsayilanEkonomikKod(tur: TasinmazTuru, amac: KullanimAmaci, tarih: Tarih, db: Tx = prisma): Promise<string> {
  return parametreGetir(tur === 'ARSA' ? 'EKONOMIK_KOD_ARSA' : `EKONOMIK_KOD_${amac}`, tarih, db)
}

/** Her anahtarın en son yürürlük kaydı kapalıysa ve bitişi bugünden en fazla 30 gün önceyse listelenir (H13). */
export async function parametreBitisleri(bugun: Tarih, db: Tx = prisma): Promise<ParametreBitisi[]> {
  const tumu = await db.parametre.findMany({ orderBy: [{ anahtar: 'asc' }, { yururlukBaslangic: 'desc' }] })
  const sonKayit = new Map<string, (typeof tumu)[number]>()
  for (const p of tumu) if (!sonKayit.has(p.anahtar)) sonKayit.set(p.anahtar, p)
  const sinir = gunEkle(bugun, -30)
  const sonuc: ParametreBitisi[] = []
  for (const p of sonKayit.values()) {
    if (p.yururlukBitis === null) continue
    const bitis = tarihDb(p.yururlukBitis)
    if (karsilastir(bitis, sinir) >= 0) sonuc.push({ anahtar: p.anahtar, yururlukBitis: bitis })
  }
  return sonuc
}

export interface ParametreGirdisi {
  anahtar: string
  deger: string
  yururlukBaslangic: Tarih
  yururlukBitis: Tarih | null
  mevzuatDayanagi: string | null
  aciklama: string | null
}

const SAYISAL_DEGER = /^-?\d+(\.\d+)?$/

/**
 * Tablo yalnızca eklemeli olduğundan hatalı bir değer sonraki her okumayı bozar; bu yüzden eklemeden önce doğrulanır.
 * `sonKayit`: anahtarın en son yürürlük kaydı; sayısal bir parametrenin sayısal kalmasını sağlamak için kullanılır.
 */
function degerDogrula(anahtar: string, deger: string, sonKayit: { deger: string }): void {
  if (anahtar.startsWith('STATU_KURALI_')) {
    let ayristirilan: unknown
    try {
      ayristirilan = JSON.parse(deger)
    } catch {
      throw new IsKuraliHatasi('DEGER', 'Statü kuralı geçerli bir JSON olmalıdır.', 'deger')
    }
    if (!statuSemasi.safeParse(ayristirilan).success) {
      throw new IsKuraliHatasi('DEGER', 'Statü kuralı şemaya uymuyor: stopaj, kdvli, teyitGerekli ve muhsgkKodu alanları geçerli olmalıdır.', 'deger')
    }
    return
  }
  if (SAYISAL_DEGER.test(sonKayit.deger) && !SAYISAL_DEGER.test(deger)) {
    throw new IsKuraliHatasi('DEGER', 'Değer sayısal olmalıdır; ondalık ayracı olarak nokta kullanın, virgül ve binlik ayracı girmeyin (ör. 20 veya 1.89).', 'deger')
  }
}

export async function parametreEkle(g: ParametreGirdisi, baglam: IslemBaglami): Promise<number> {
  if (!/^[A-Z0-9_]+$/.test(g.anahtar)) {
    throw new IsKuraliHatasi('ANAHTAR', 'Anahtar yalnızca büyük harf, rakam ve alt çizgi içerebilir.', 'anahtar')
  }
  const deger = g.deger.trim()
  if (deger === '') throw new IsKuraliHatasi('DEGER', 'Değer boş olamaz.', 'deger')
  if (g.yururlukBitis !== null && karsilastir(g.yururlukBitis, g.yururlukBaslangic) < 0) {
    throw new IsKuraliHatasi('TARIH', 'Yürürlük bitişi başlangıçtan önce olamaz.', 'yururlukBitis')
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const sonKayit = await tx.parametre.findFirst({ where: { anahtar: g.anahtar }, orderBy: { yururlukBaslangic: 'desc' } })
      if (!sonKayit) {
        throw new IsKuraliHatasi('ANAHTAR', `Bilinmeyen parametre anahtarı: ${g.anahtar}. Yeni anahtarlar yalnızca kurulum verisiyle eklenir.`, 'anahtar')
      }
      degerDogrula(g.anahtar, deger, sonKayit)
      const acik = await tx.parametre.findFirst({
        where: { anahtar: g.anahtar, yururlukBitis: null, yururlukBaslangic: { lt: dbTarih(g.yururlukBaslangic) } },
      })
      if (acik) {
        const yeniBitis = dbTarih(gunEkle(g.yururlukBaslangic, -1))
        await tx.parametre.update({ where: { id: acik.id }, data: { yururlukBitis: yeniBitis, version: { increment: 1 } } })
        await denetimKaydi(tx, baglam, { varlik: 'parametre', varlikId: acik.id, eylem: 'YURURLUK_KAPAT', once: acik, sonra: { yururlukBitis: yeniBitis } })
      }
      const yeni = await tx.parametre.create({
        data: {
          anahtar: g.anahtar, deger, yururlukBaslangic: dbTarih(g.yururlukBaslangic),
          yururlukBitis: dbTarihOpt(g.yururlukBitis), mevzuatDayanagi: g.mevzuatDayanagi, aciklama: g.aciklama,
        },
      })
      await denetimKaydi(tx, baglam, { varlik: 'parametre', varlikId: yeni.id, eylem: 'EKLE', sonra: yeni })
      return yeni.id
    })
  } catch (e) {
    if (kisitIhlaliMi(e, 'parametre_cakismaz') || benzersizIhlaliMi(e)) {
      throw new IsKuraliHatasi('CAKISMA', 'Bu anahtar için tarih aralığı mevcut bir kayıtla çakışıyor.', 'yururlukBaslangic')
    }
    throw e
  }
}

export async function parametreListesi() {
  const tumu = await prisma.parametre.findMany({ orderBy: [{ anahtar: 'asc' }, { yururlukBaslangic: 'desc' }] })
  const gruplar = new Map<string, { id: number; deger: string; yururlukBaslangic: Tarih; yururlukBitis: Tarih | null; mevzuatDayanagi: string | null; aciklama: string | null }[]>()
  for (const p of tumu) {
    const liste = gruplar.get(p.anahtar) ?? []
    liste.push({ id: p.id, deger: p.deger, yururlukBaslangic: tarihDb(p.yururlukBaslangic), yururlukBitis: tarihDbOpt(p.yururlukBitis), mevzuatDayanagi: p.mevzuatDayanagi, aciklama: p.aciklama })
    gruplar.set(p.anahtar, liste)
  }
  return [...gruplar.entries()].map(([anahtar, kayitlar]) => ({ anahtar, kayitlar }))
}
