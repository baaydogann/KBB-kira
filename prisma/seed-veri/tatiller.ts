export interface TatilTohumu { tarih: string; ad: string; yarimGun?: boolean }

const sabit = (yil: number): TatilTohumu[] => [
  { tarih: `${yil}-01-01`, ad: 'Yılbaşı' },
  { tarih: `${yil}-04-23`, ad: 'Ulusal Egemenlik ve Çocuk Bayramı' },
  { tarih: `${yil}-05-01`, ad: 'Emek ve Dayanışma Günü' },
  { tarih: `${yil}-05-19`, ad: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { tarih: `${yil}-07-15`, ad: 'Demokrasi ve Millî Birlik Günü' },
  { tarih: `${yil}-08-30`, ad: 'Zafer Bayramı' },
  { tarih: `${yil}-10-28`, ad: 'Cumhuriyet Bayramı arifesi', yarimGun: true },
  { tarih: `${yil}-10-29`, ad: 'Cumhuriyet Bayramı' },
]

// 2026–2027 dini bayramlar: Diyanet takvimi (haber kaynaklarıyla doğrulandı, Ekim 2026).
// 2028 dini bayramları henüz ilan edilmedi; TATIL_TAKVIMI_GECERLILIK parametresi H13 ile hatırlatır.
export const TATILLER: TatilTohumu[] = [
  ...sabit(2026),
  { tarih: '2026-03-19', ad: 'Ramazan Bayramı arifesi', yarimGun: true },
  { tarih: '2026-03-20', ad: 'Ramazan Bayramı 1. gün' },
  { tarih: '2026-03-21', ad: 'Ramazan Bayramı 2. gün' },
  { tarih: '2026-03-22', ad: 'Ramazan Bayramı 3. gün' },
  { tarih: '2026-05-26', ad: 'Kurban Bayramı arifesi', yarimGun: true },
  { tarih: '2026-05-27', ad: 'Kurban Bayramı 1. gün' },
  { tarih: '2026-05-28', ad: 'Kurban Bayramı 2. gün' },
  { tarih: '2026-05-29', ad: 'Kurban Bayramı 3. gün' },
  { tarih: '2026-05-30', ad: 'Kurban Bayramı 4. gün' },
  ...sabit(2027).filter((t) => t.tarih !== '2027-05-19'),
  { tarih: '2027-03-08', ad: 'Ramazan Bayramı arifesi', yarimGun: true },
  { tarih: '2027-03-09', ad: 'Ramazan Bayramı 1. gün' },
  { tarih: '2027-03-10', ad: 'Ramazan Bayramı 2. gün' },
  { tarih: '2027-03-11', ad: 'Ramazan Bayramı 3. gün' },
  { tarih: '2027-05-15', ad: 'Kurban Bayramı arifesi', yarimGun: true },
  { tarih: '2027-05-16', ad: 'Kurban Bayramı 1. gün' },
  { tarih: '2027-05-17', ad: 'Kurban Bayramı 2. gün' },
  { tarih: '2027-05-18', ad: 'Kurban Bayramı 3. gün' },
  { tarih: '2027-05-19', ad: "Kurban Bayramı 4. gün; Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  ...sabit(2028),
]
