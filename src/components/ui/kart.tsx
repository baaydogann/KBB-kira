import type { ReactNode } from 'react'

export function Kart({ baslik, eylemler, children }: { baslik?: string; eylemler?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {baslik || eylemler ? (
        <header className="mb-3 flex items-center justify-between gap-2">
          {baslik ? <h2 className="text-base font-semibold">{baslik}</h2> : <span />}
          {eylemler}
        </header>
      ) : null}
      {children}
    </section>
  )
}
