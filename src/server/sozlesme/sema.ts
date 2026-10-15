import { z } from 'zod'
import { hisseToplamiBirMi } from '@/core/hisse'
import { oranAyristir, paraAyristir } from '@/core/para'
import { karsilastir, tarihAyristir, type Tarih } from '@/core/tarih'

const tarihAlani = z.string().trim().transform((v, ctx): Tarih => {
  const r = tarihAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const opsTarih = z.string().trim().nullish().transform((v, ctx): Tarih | null => {
  if (!v) return null
  const r = tarihAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const pozitifPara = (zorunlu: boolean) => z.string().trim().nullish().transform((v, ctx) => {
  if (!v) {
    if (zorunlu) ctx.addIssue({ code: 'custom', message: 'Tutar girin.' })
    return null
  }
  const r = paraAyristir(v)
  if (!r.ok || !r.deger.isPositive()) {
    ctx.addIssue({ code: 'custom', message: r.ok ? 'Tutar sıfırdan büyük olmalı.' : r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const opsOran = z.string().trim().nullish().transform((v, ctx) => {
  if (!v) return null
  const r = oranAyristir(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.hata.mesaj })
    return z.NEVER
  }
  return r.deger
})

const opsMetin = z.string().trim().max(500).nullish().transform((v) => (v ? v : null))
const kimlik = z.number().int().positive()

export const malikGirdisiSemasi = z.object({
  kisiId: kimlik,
  pay: z.number().int().positive(),
  payda: z.number().int().positive(),
  ibanId: kimlik.nullable(),
  vekilKisiId: kimlik.nullable(),
})
export type MalikGirdisi = z.infer<typeof malikGirdisiSemasi>

export const sozlesmeGirdisiSemasi = z.object({
  sozlesmeNo: z.string().trim().min(1, 'Sözleşme numarası girin.').max(50),
  tasinmazId: kimlik,
  birimId: kimlik,
  ekonomikKod: z.string().trim().nullish().transform((v) => (v ? v : null))
    .refine((v) => v === null || /^03\.5\.5\.\d{2}$/.test(v), 'Ekonomik kod 03.5.5.xx biçiminde olmalı.'),
  imzaTarihi: opsTarih,
  baslangic: tarihAlani,
  bitis: opsTarih,
  ilkKiraBaslangici: opsTarih,
  bedelTutari: pozitifPara(true),
  bedelTabani: z.enum(['AYLIK', 'YILLIK']),
  bedelTuru: z.enum(['BRUT', 'NET']),
  odemePeriyoduAy: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  odemeZamani: z.enum(['PESIN', 'DONEM_SONU']),
  vadeKurali: z.enum(['DONEM_BASI_ARTI_GUN', 'AYIN_GUNU', 'DONEM_SONU_ARTI_GUN']),
  vadeParametresi: z.number().int().min(0).max(60),
  artisKurali: z.enum(['TUFE12', 'YIUFE', 'TUFE_YIUFE_ORT', 'SABIT', 'YOK', 'ELLE']),
  artisDegisimTuru: z.enum(['ON_IKI_AY_ORT', 'YILLIK']),
  sabitArtisOrani: opsOran,
  artisPeriyoduAy: z.number().int().min(1).max(120),
  kistYontemi: z.enum(['GERCEK_GUN', 'OTUZ_GUN']),
  damgaTahsil: z.enum(['ISTIHKAKTAN', 'MALIK_BEYAN']),
  ihaleDayanagi: z.enum(['DT_4734_22E', 'PZ_2886_51L', 'DIGER']),
  onayBelgesiNo: opsMetin,
  onayBelgesiTarihi: opsTarih,
  piyasaArastirmaTarihi: opsTarih,
  encumenKararNo: opsMetin,
  gecisTarihi: opsTarih,
  gecisBedeli: pozitifPara(false),
  odenmisSayilanSonTarih: opsTarih,
  notlar: opsMetin,
  malikler: z.array(malikGirdisiSemasi).min(1, 'En az bir malik ekleyin.'),
}).superRefine((s, ctx) => {
  const hata = (yol: string, message: string) => ctx.addIssue({ code: 'custom', path: [yol], message })
  if (s.bitis && karsilastir(s.bitis, s.baslangic) < 0) hata('bitis', 'Bitiş başlangıçtan önce olamaz.')
  if (s.ilkKiraBaslangici && karsilastir(s.ilkKiraBaslangici, s.baslangic) > 0) hata('ilkKiraBaslangici', 'İlk kira başlangıcı sözleşme başlangıcından sonra olamaz.')
  if (s.vadeKurali === 'AYIN_GUNU' && (s.vadeParametresi < 1 || s.vadeParametresi > 31)) hata('vadeParametresi', 'Ayın günü 1–31 arasında olmalı.')
  if (s.artisKurali === 'SABIT' && s.sabitArtisOrani === null) hata('sabitArtisOrani', 'Sabit artış oranını girin.')
  if ((s.gecisTarihi === null) !== (s.gecisBedeli === null)) hata('gecisBedeli', 'Geçiş tarihi ve güncel kira bedeli birlikte girilmeli.')
  if (s.gecisTarihi && karsilastir(s.gecisTarihi, s.baslangic) <= 0) hata('gecisTarihi', 'Geçiş tarihi sözleşme başlangıcından sonra olmalı.')
  if (s.gecisTarihi && s.bitis && karsilastir(s.gecisTarihi, s.bitis) > 0) hata('gecisTarihi', 'Geçiş tarihi sözleşme bitişinden sonra olamaz.')
  if (!hisseToplamiBirMi(s.malikler)) hata('malikler', 'Malik hisselerinin toplamı tam olarak 1 olmalı (ör. 1/2 + 1/3 + 1/6).')
  if (new Set(s.malikler.map((m) => m.kisiId)).size !== s.malikler.length) hata('malikler', 'Aynı kişi birden fazla kez malik olarak eklenemez.')
})

export type SozlesmeGirdisi = z.infer<typeof sozlesmeGirdisiSemasi>
