import clsx from 'clsx'
import Link from 'next/link'

export interface Sekme { anahtar: string; etiket: string; sayi?: number }

export function Sekmeler({ sekmeler, aktif, temelUrl, parametre = 'sekme' }: { sekmeler: Sekme[]; aktif: string; temelUrl: string; parametre?: string }) {
  return (
    <nav className="flex gap-1 border-b border-slate-200" aria-label="Sekmeler">
      {sekmeler.map((s) => (
        <Link
          key={s.anahtar}
          href={`${temelUrl}?${parametre}=${s.anahtar}`}
          aria-current={s.anahtar === aktif ? 'page' : undefined}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm', s.anahtar === aktif ? 'border-marka font-semibold text-marka' : 'border-transparent text-slate-600 hover:text-slate-900')}
        >
          {s.etiket}
          {s.sayi !== undefined ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-xs text-slate-700">{s.sayi}</span> : null}
        </Link>
      ))}
    </nav>
  )
}
