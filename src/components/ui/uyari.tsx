import clsx from 'clsx'
import type { ReactNode } from 'react'

const TON = {
  bilgi: 'border-blue-200 bg-blue-50 text-blue-900',
  uyari: 'border-amber-200 bg-amber-50 text-amber-900',
  hata: 'border-red-200 bg-red-50 text-red-900',
  basari: 'border-green-200 bg-green-50 text-green-900',
} as const

export function Uyari({ ton = 'bilgi', children }: { ton?: keyof typeof TON; children: ReactNode }) {
  return <div role={ton === 'hata' ? 'alert' : 'status'} className={clsx('rounded-md border px-3 py-2 text-sm', TON[ton])}>{children}</div>
}
