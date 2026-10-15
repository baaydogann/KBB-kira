export interface FormDurumu {
  hata: string | null
  alanHatalari: Record<string, string>
  tamam: boolean
  mesaj?: string
}

export const BOS_FORM: FormDurumu = { hata: null, alanHatalari: {}, tamam: false }

export function basariDurumu(mesaj: string): FormDurumu {
  return { hata: null, alanHatalari: {}, tamam: true, mesaj }
}
