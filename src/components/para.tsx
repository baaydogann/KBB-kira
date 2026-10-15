import { formatOran, formatTL, para } from '@/core/para'

export function ParaMetni({ deger }: { deger: string }) {
  return <span className="sayi">{formatTL(deger)}</span>
}

export function OranMetni({ deger }: { deger: string | null }) {
  return <span className="sayi">{deger === null ? '—' : formatOran(para(deger))}</span>
}
