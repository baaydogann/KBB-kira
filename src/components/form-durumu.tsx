import { Uyari } from './ui/uyari'
import type { FormDurumu } from '@/app/_lib/form-durumu'

export function FormMesaji({ durum }: { durum: FormDurumu }) {
  if (durum.hata) return <Uyari ton="hata">{durum.hata}</Uyari>
  if (durum.tamam && durum.mesaj) return <Uyari ton="basari">{durum.mesaj}</Uyari>
  return null
}
