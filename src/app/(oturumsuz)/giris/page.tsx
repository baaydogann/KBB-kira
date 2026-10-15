import { redirect } from 'next/navigation'
import { kullaniciGetir } from '@/server/auth/gerekli'
import { Uyari } from '@/components/ui/uyari'
import { GirisFormu } from './giris-formu'

export default async function GirisSayfasi({ searchParams }: { searchParams: Promise<{ oturum?: string }> }) {
  if (await kullaniciGetir({ sifreDegisimiSerbest: true })) redirect('/')
  const { oturum } = await searchParams
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow">
      <div>
        <h1 className="text-lg font-semibold">KBB Kira Takip</h1>
        <p className="text-sm text-slate-600">Konya Büyükşehir Belediyesi</p>
      </div>
      {oturum === 'kapandi' ? <Uyari ton="uyari">Oturumunuz kapandı. Tekrar giriş yapın.</Uyari> : null}
      <GirisFormu />
    </main>
  )
}
