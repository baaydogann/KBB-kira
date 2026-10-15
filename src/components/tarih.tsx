import { formatTarih, tarih } from '@/core/tarih'

export function TarihMetni({ deger }: { deger: string | null }) {
  return <span className="whitespace-nowrap">{deger === null ? '—' : formatTarih(tarih(deger))}</span>
}
