import Link from 'next/link'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { tasinmazListesi } from '@/server/tasinmaz/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { DugmeLink } from '@/components/ui/dugme'
import { Girdi } from '@/components/ui/alan'
import { Tablo, Td, Th } from '@/components/ui/tablo'

export default async function TasinmazlarSayfasi({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  await kullaniciGerekli()
  const { q: ham } = await searchParams
  const q = typeof ham === 'string' ? ham : undefined
  const liste = await tasinmazListesi(q)
  return (
    <>
      <SayfaBasligi baslik="Taşınmazlar" eylemler={<DugmeLink href="/tasinmazlar/yeni" tur="birincil">Yeni taşınmaz</DugmeLink>} />
      <form className="mb-3"><Girdi name="q" type="search" defaultValue={q} aria-label="Taşınmaz ara" placeholder="Ad, adres, ilçe veya 123/45 (ada/parsel)" className="max-w-md" /></form>
      <Tablo>
        <thead><tr><Th>Kısa ad</Th><Th>Tür</Th><Th>İlçe</Th><Th>Ada/parsel</Th><Th>Kullanan birim</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {liste.map((t) => (
            <tr key={t.id}>
              <Td><Link href={`/tasinmazlar/${t.id}`} className="text-marka hover:underline">{t.kisaAd}</Link></Td>
              <Td>{t.tur}</Td><Td>{t.ilce}</Td><Td>{t.ada && t.parsel ? `${t.ada}/${t.parsel}` : '—'}</Td><Td>{t.kullananBirim?.ad ?? '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Tablo>
    </>
  )
}
