import { kullaniciGerekli } from '@/server/auth/gerekli'
import { cikisAction } from '@/app/_lib/cikis-actions'
import { Dugme } from '@/components/ui/dugme'
import { Uyari } from '@/components/ui/uyari'
import { SifreFormu } from './sifre-formu'

export default async function SifreDegistirSayfasi() {
  const k = await kullaniciGerekli({ sifreDegisimiSerbest: true })
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow">
      <h1 className="text-lg font-semibold">Şifre değiştir</h1>
      {k.sifreDegismeli ? <Uyari ton="uyari">Devam etmeden önce geçici şifrenizi değiştirin.</Uyari> : null}
      <SifreFormu />
      <form action={cikisAction}><Dugme type="submit" tur="hayalet" className="w-full">Çıkış</Dugme></form>
    </main>
  )
}
