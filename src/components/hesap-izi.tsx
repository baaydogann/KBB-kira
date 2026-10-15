import type { HesapSatiri } from '@/core/hesap/goruntu'

export function HesapIzi({ satirlar, baslik = 'Hesap izi' }: { satirlar: HesapSatiri[]; baslik?: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-marka hover:underline">{baslik}</summary>
      <ol className="mt-2 space-y-1 rounded border border-slate-200 bg-slate-50 p-2 font-mono">
        {satirlar.map((s, i) => (
          <li key={i} className="grid grid-cols-[3rem_1fr] gap-2">
            <span className="text-slate-500">{s.kural}</span>
            <span>{s.aciklama}: <span className="text-slate-600">{s.formul}</span> = <strong>{s.sonuc}</strong></span>
          </li>
        ))}
      </ol>
    </details>
  )
}
