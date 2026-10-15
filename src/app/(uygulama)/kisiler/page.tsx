import Link from 'next/link'
import { maskele } from '@/core/dogrulama'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kisiGorunenAd, kisiListesi } from '@/server/kisi/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { DugmeLink } from '@/components/ui/dugme'
import { Girdi } from '@/components/ui/alan'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'

export default async function KisilerSayfasi({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await kullaniciGerekli()
  const { q: ham } = await searchParams
  const q = typeof ham === 'string' ? ham : undefined
  const liste = await kisiListesi(q)
  return (
    <>
      <SayfaBasligi baslik="Malikler ve hak sahipleri" eylemler={<DugmeLink href="/kisiler/yeni" tur="birincil">Yeni kişi</DugmeLink>} />
      <form className="mb-3"><Girdi name="q" type="search" defaultValue={q} aria-label="Kişi ara" placeholder="Ad, soyad, unvan, TCKN veya VKN" autoComplete="off" className="max-w-md" /></form>
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
