import clsx from 'clsx'
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'

export function Tablo({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  )
}

export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={clsx('bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600', className)} {...p} />
}

export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={clsx('px-3 py-2 align-top', className)} {...p} />
}
