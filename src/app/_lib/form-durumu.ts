export interface FormDurumu {
  hata: string | null
  alanHatalari: Record<string, string>
  tamam: boolean
  mesaj?: string
  /** İşlem başarılı olsa da kullanıcının bilmesi gereken yan sonuç (ör. onay kaydedildi ama bağlı hesap yapılamadı). */
  uyari?: string
  /** Gönderilen alan değerleri (şifre türü alanlar hariç); React 19 formu sıfırladığı için girdiler defaultValue ile geri yüklenir. */
  degerler?: Record<string, string>
}

export const BOS_FORM: FormDurumu = { hata: null, alanHatalari: {}, tamam: false }

export function basariDurumu(mesaj: string): FormDurumu {
  return { hata: null, alanHatalari: {}, tamam: true, mesaj }
}

/** Boş olmayan uyarıları (boşlukla birleştirerek) duruma ekler; hiçbiri yoksa durum aynen döner. */
export function uyariIle(durum: FormDurumu, ...uyarilar: (string | undefined)[]): FormDurumu {
  const uyari = uyarilar.filter((u): u is string => u !== undefined && u !== '').join(' ')
  return uyari === '' ? durum : { ...durum, uyari }
}
