import clsx from 'clsx'
import { cloneElement, isValidElement } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const KUTU = 'block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-marka focus:outline-none focus:ring-1 focus:ring-marka aria-[invalid=true]:border-red-500'

interface ErisilebilirOzellikler { 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }

/**
 * Etiketi, ipucunu ve hatayı alana bağlar: ipucu/hata öğelerine `ad`dan türeyen kimlik verilir ve
 * tek alt öğeye `aria-describedby` ile (hata varsa) `aria-invalid` geçirilir. Çağıranlar değişmez.
 */
export function Alan({ etiket, ad, hata, ipucu, children, className }: { etiket: string; ad: string; hata?: string; ipucu?: string; children: ReactNode; className?: string }) {
  const ipucuGorunur = Boolean(ipucu) && !hata
  const aciklamaKimligi = hata ? `${ad}-hata` : ipucuGorunur ? `${ad}-ipucu` : undefined
  const alan = isValidElement<ErisilebilirOzellikler>(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], aciklamaKimligi].filter(Boolean).join(' ') || undefined,
        'aria-invalid': hata ? true : children.props['aria-invalid'],
      })
    : children
  return (
    <div className={clsx('space-y-1', className)}>
      <label htmlFor={ad} className="block text-sm font-medium text-slate-700">{etiket}</label>
      {alan}
      {ipucuGorunur ? <p id={`${ad}-ipucu`} className="text-xs text-slate-500">{ipucu}</p> : null}
      {hata ? <p id={`${ad}-hata`} className="text-xs text-red-600" role="alert">{hata}</p> : null}
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
