import clsx from 'clsx'
import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

type Tur = 'birincil' | 'ikincil' | 'tehlike' | 'hayalet'

const SINIF: Record<Tur, string> = {
  birincil: 'bg-marka text-white hover:bg-marka-koyu',
  ikincil: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  tehlike: 'bg-red-600 text-white hover:bg-red-700',
  hayalet: 'text-slate-700 hover:bg-slate-100',
}
const TEMEL = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50'

export function Dugme({ tur = 'ikincil', className, type = 'button', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tur?: Tur }) {
  return <button type={type} className={clsx(TEMEL, SINIF[tur], className)} {...p} />
}

export function DugmeLink({ tur = 'ikincil', className, href, ...p }: AnchorHTMLAttributes<HTMLAnchorElement> & { tur?: Tur; href: string }) {
  return <Link href={href} className={clsx(TEMEL, SINIF[tur], className)} {...p} />
}
