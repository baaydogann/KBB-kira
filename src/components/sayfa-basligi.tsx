import type { ReactNode } from 'react'

export function SayfaBasligi({ baslik, aciklama, eylemler }: { baslik: string; aciklama?: string; eylemler?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{baslik}</h1>
        {aciklama ? <p className="mt-0.5 text-sm text-slate-600">{aciklama}</p> : null}
      </div>
      {eylemler ? <div className="flex gap-2">{eylemler}</div> : null}
    </div>
  )
}
