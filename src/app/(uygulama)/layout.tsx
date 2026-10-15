import Link from 'next/link'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { AnaMenu } from '@/components/ana-menu'
import { Dugme } from '@/components/ui/dugme'
import { cikisAction } from '@/app/_lib/cikis-actions'

export const dynamic = 'force-dynamic'

export default async function UygulamaYerlesimi({ children }: { children: React.ReactNode }) {
  const k = await kullaniciGerekli()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <Link href="/" className="font-semibold text-marka">KBB Kira Takip</Link>
        <form action="/ara" className="ml-4 flex-1">
          <input name="q" type="search" placeholder="Sözleşme no, malik, ada/parsel ara" aria-label="Ara"
            className="w-full max-w-md rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </form>
        <span className="text-sm text-slate-600">{k.adSoyad}</span>
        <form action={cikisAction}><Dugme type="submit" tur="hayalet">Çıkış</Dugme></form>
      </header>
      <div className="flex flex-1">
        <aside className="w-52 shrink-0 border-r border-slate-200 bg-slate-100 p-3"><AnaMenu /></aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
