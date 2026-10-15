import clsx from 'clsx'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const KUTU = 'block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-marka focus:outline-none focus:ring-1 focus:ring-marka aria-[invalid=true]:border-red-500'

export function Alan({ etiket, ad, hata, ipucu, children, className }: { etiket: string; ad: string; hata?: string; ipucu?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('space-y-1', className)}>
      <label htmlFor={ad} className="block text-sm font-medium text-slate-700">{etiket}</label>
      {children}
      {ipucu && !hata ? <p className="text-xs text-slate-500">{ipucu}</p> : null}
      {hata ? <p className="text-xs text-red-600" role="alert">{hata}</p> : null}
    </div>
  )
}

export function Girdi({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input id={p.name} className={clsx(KUTU, className)} {...p} />
}

export function Secim({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select id={p.name} className={clsx(KUTU, className)} {...p}>{children}</select>
}

export function MetinAlani({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea id={p.name} rows={3} className={clsx(KUTU, className)} {...p} />
}
