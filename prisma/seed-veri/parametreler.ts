import { VARSAYILAN_STATU_KURALLARI } from '@/core/hesap/vergi'

export interface ParametreTohumu {
  anahtar: string
  deger: string
  yururlukBaslangic: string
  yururlukBitis?: string
  mevzuatDayanagi?: string
  aciklama?: string
}

const H = '2020-01-01'

const statuKurallari: ParametreTohumu[] = Object.entries(VARSAYILAN_STATU_KURALLARI).map(([statu, k]) => ({
  anahtar: `STATU_KURALI_${statu}`,
  deger: JSON.stringify({ stopaj: k.stopaj, kdvli: k.kdvli, teyitGerekli: k.teyitGerekli, muhsgkKodu: k.muhsgkKodu }),
  yururlukBaslangic: '2009-02-03',
  mevzuatDayanagi: 'GVK 94/5, KVK 15/1-b, KDVK 17/4-d — spec §6.6',
  aciklama: k.etiket,
}))

export const PARAMETRELER: ParametreTohumu[] = [
  { anahtar: 'STOPAJ_94_5A', deger: '20', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'GVK 94/5-a, BKK 2009/14592' },
  { anahtar: 'STOPAJ_94_5B', deger: '20', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'GVK 94/5-b, BKK 2009/14592' },
  { anahtar: 'STOPAJ_KVK_15_1B', deger: '20', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'KVK 15/1-b' },
  { anahtar: 'KDV_GENEL', deger: '18', yururlukBaslangic: '2002-01-01', yururlukBitis: '2023-07-09', mevzuatDayanagi: 'KDVK 28' },
  { anahtar: 'KDV_GENEL', deger: '20', yururlukBaslangic: '2023-07-10', mevzuatDayanagi: 'KDVK 28, CBK 7346' },
  { anahtar: 'KDV_TEVKIFAT_KIRA', deger: '0', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'KDV GUT I/C-2.1.3 (belediye belirlenmiş alıcı değil)' },
  { anahtar: 'DAMGA_KIRA_BINDE', deger: '1.89', yururlukBaslangic: H, mevzuatDayanagi: 'DVK (1) s. tablo I/A-2' },
  { anahtar: 'DAMGA_KEFALET_BINDE', deger: '9.48', yururlukBaslangic: H, mevzuatDayanagi: 'DVK (1) s. tablo I/A-3' },
  { anahtar: 'DAMGA_AZAMI', deger: '24477478.90', yururlukBaslangic: '2025-01-01', yururlukBitis: '2025-12-31', mevzuatDayanagi: 'DVK 14' },
  { anahtar: 'DAMGA_AZAMI', deger: '29115961.10', yururlukBaslangic: '2026-01-01', yururlukBitis: '2026-12-31', mevzuatDayanagi: 'DVK GT Seri 71' },
  { anahtar: 'DAMGA_SURESIZ_AY', deger: '12', yururlukBaslangic: H, aciklama: 'Uygulama; müşavir teyidi bekliyor (spec §21-3)' },
  { anahtar: 'ESIK_22A_ODEME', deger: '5000', yururlukBaslangic: '2020-03-03', mevzuatDayanagi: 'Tahsilat GT Seri A No 12' },
  { anahtar: 'ESIK_22A_BORC', deger: '5000', yururlukBaslangic: '2020-03-03', mevzuatDayanagi: 'Tahsilat GT Seri A No 12' },
  { anahtar: 'SURE_22A_GECERLILIK_GUN', deger: '15', yururlukBaslangic: '2020-03-03', mevzuatDayanagi: 'Tahsilat GT Seri A No 1' },
  { anahtar: 'MUHSGK_KOD_KIRA', deger: '041', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'GİB ödeme türü kodu' },
  { anahtar: 'MUHSGK_KOD_KOOPERATIF', deger: '042', yururlukBaslangic: '2009-02-03', mevzuatDayanagi: 'GİB ödeme türü kodu' },
  { anahtar: 'TBK344_KONUT_SINIR', deger: '25', yururlukBaslangic: '2022-06-11', yururlukBitis: '2024-07-01', mevzuatDayanagi: '7409/4, 7456/23 (tarihsel)' },
  { anahtar: 'FARK_VADE_GUN', deger: '10', yururlukBaslangic: H },
  { anahtar: 'TASARRUF_GENELGESI_2024_7', deger: 'YURURLUKTE', yururlukBaslangic: '2024-05-17', yururlukBitis: '2027-05-17', mevzuatDayanagi: 'Cumhurbaşkanlığı Genelgesi 2024/7', aciklama: 'Yeni hizmet binası/lojman kiralamada izin şartı' },
  { anahtar: 'TATIL_TAKVIMI_GECERLILIK', deger: 'TAM', yururlukBaslangic: '2026-01-01', yururlukBitis: '2027-12-31', aciklama: '2028 dini bayramları Diyanet ilanından sonra girilmeli' },
  { anahtar: 'EVDS_SERI_TUFE', deger: 'TP.GENENDEKS.T1', yururlukBaslangic: H, yururlukBitis: '2026-12-31', aciklama: 'TÜFE 2003=100 (hedef aya göre yürürlük)' },
  { anahtar: 'EVDS_SERI_TUFE', deger: 'TP.TUKFIY2025.GENEL', yururlukBaslangic: '2027-01-01', aciklama: 'TÜFE 2025=100; 24 ay birikince geçilir' },
  { anahtar: 'EVDS_SERI_YIUFE', deger: 'TP.TUFE1YI.T1', yururlukBaslangic: H, aciklama: 'Kurulumda EVDS seri listesinden doğrulanmalı (spec §21-10)' },
  { anahtar: 'TAKVIM_UFUK_AY', deger: '24', yururlukBaslangic: H },
  { anahtar: 'ARTIS_HESAP_UFUK_GUN', deger: '45', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_VADE_GORUNUR_GUN', deger: '7', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_VADE_YUKSEK_GUN', deger: '3', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_ODEME_EMRI_IS_GUNU', deger: '10', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_ARTIS_ONCE_GUN', deger: '30', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_BITIS_GORUNUR_GUN', deger: '90', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_BITIS_YUKSEK_GUN', deger: '60', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_BITIS_KRITIK_GUN', deger: '30', yururlukBaslangic: H },
  { anahtar: 'TBK347_FESIH_BILDIRIM_GUN', deger: '15', yururlukBaslangic: H, mevzuatDayanagi: 'TBK 347/1' },
  { anahtar: 'HATIRLATMA_FESIH_SON_GUN_GORUNUR_GUN', deger: '15', yururlukBaslangic: H },
  { anahtar: 'HATIRLATMA_TESPIT_ONCE_AY', deger: '6', yururlukBaslangic: H, mevzuatDayanagi: 'TBK 344/3' },
  { anahtar: 'HATIRLATMA_UZAMA10_ONCE_AY', deger: '3', yururlukBaslangic: H, mevzuatDayanagi: 'TBK 347/1' },
  { anahtar: 'HATIRLATMA_MEVZUAT_ONCE_GUN', deger: '30', yururlukBaslangic: H },
  { anahtar: 'EKONOMIK_KOD_HIZMET_BINASI', deger: '03.5.5.05', yururlukBaslangic: '2021-01-01', mevzuatDayanagi: 'Analitik Bütçe Sınıflandırma Rehberi' },
  { anahtar: 'EKONOMIK_KOD_LOJMAN', deger: '03.5.5.06', yururlukBaslangic: '2021-01-01' },
  { anahtar: 'EKONOMIK_KOD_ARSA', deger: '03.5.5.07', yururlukBaslangic: '2021-01-01' },
  { anahtar: 'EKONOMIK_KOD_DEPO', deger: '03.5.5.90', yururlukBaslangic: '2021-01-01', aciklama: 'Teyit bekliyor (spec §21-5)' },
  { anahtar: 'EKONOMIK_KOD_OTOPARK', deger: '03.5.5.90', yururlukBaslangic: '2021-01-01' },
  { anahtar: 'EKONOMIK_KOD_SOSYAL_TESIS', deger: '03.5.5.90', yururlukBaslangic: '2021-01-01' },
  { anahtar: 'EKONOMIK_KOD_DIGER', deger: '03.5.5.90', yururlukBaslangic: '2021-01-01' },
  ...statuKurallari,
]
