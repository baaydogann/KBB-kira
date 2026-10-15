import clsx from 'clsx'
import type { ReactNode } from 'react'

export type RozetTonu = 'gri' | 'mavi' | 'yesil' | 'sari' | 'kirmizi'

const TON: Record<RozetTonu, string> = {
  gri: 'bg-slate-100 text-slate-700',
  mavi: 'bg-blue-100 text-blue-800',
  yesil: 'bg-green-100 text-green-800',
  sari: 'bg-amber-100 text-amber-800',
  kirmizi: 'bg-red-100 text-red-800',
}

export function Rozet({ ton = 'gri', children }: { ton?: RozetTonu; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium', TON[ton])}>{children}</span>
}
