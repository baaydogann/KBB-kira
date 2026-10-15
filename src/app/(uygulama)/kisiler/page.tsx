import Link from 'next/link'
import { maskele } from '@/core/dogrulama'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kisiGorunenAd, kisiListesi } from '@/server/kisi/servis'
import { kimlikBenzeriMi } from '@/server/sozlesme/arama'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { DugmeLink } from '@/components/ui/dugme'
import { Girdi } from '@/components/ui/alan'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { Uyari } from '@/components/ui/uyari'
import { kisiAraAction } from './actions'

export default async function KisilerSayfasi({ searchParams }: { searchParams: Promise<{ q?: string | string[]; bulunamadi?: string | string[] }> }) {
  await kullaniciGerekli()
  const { q: ham, bulunamadi } = await searchParams
  // TCKN/VKN/IBAN adres satırında aranmaz (KVKK): kimlik benzeri bir `q` yok sayılır, arama kutusu POST eder.
  const q = typeof ham === 'string' && !kimlikBenzeriMi(ham) ? ham : undefined
  const liste = await kisiListesi(q)
  return (
    <>
      <SayfaBasligi baslik="Malikler ve hak sahipleri" eylemler={<DugmeLink href="/kisiler/yeni" tur="birincil">Yeni kişi</DugmeLink>} />
      <form action={kisiAraAction} className="mb-3"><Girdi name="q" type="search" defaultValue={q} aria-label="Kişi ara" placeholder="Ad, soyad, unvan, TCKN veya VKN" autoComplete="off" className="max-w-md" /></form>
      {bulunamadi === '1' ? <div className="mb-3"><Uyari ton="uyari">Bu kimlik numarasıyla kayıtlı kişi bulunamadı. Kimlik numarası yalnızca rakamlarla, başka metin olmadan girilmelidir.</Uyari></div> : null}
      <Tablo>
        <thead><tr><Th>Ad / unvan</Th><Th>Kimlik</Th><Th>Vergi statüsü</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {liste.map((k) => (
            <tr key={k.id}>
              <Td><Link href={`/kisiler/${k.id}`} className="text-marka hover:underline">{kisiGorunenAd(k)}</Link></Td>
              <Td className="font-mono text-xs">{maskele(k.tckn ?? k.vkn ?? '')}</Td>
              <Td>{k.vergiStatusu} {k.statuTeyitli ? <Rozet ton="yesil">Teyitli</Rozet> : null}</Td>
            </tr>
          ))}
        </tbody>
      </Tablo>
    </>
  )
}
