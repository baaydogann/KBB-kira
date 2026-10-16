import Link from 'next/link'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kimlikBenzeriMi } from '@/server/sozlesme/arama'
import { tasinmazListesi } from '@/server/tasinmaz/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { DugmeLink } from '@/components/ui/dugme'
import { Girdi } from '@/components/ui/alan'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { Uyari } from '@/components/ui/uyari'
import { tasinmazAraAction } from './actions'

export default async function TasinmazlarSayfasi({ searchParams }: { searchParams: Promise<{ q?: string | string[]; kimlik?: string | string[] }> }) {
  await kullaniciGerekli()
  const { q: ham, kimlik } = await searchParams
  // KVKK: kimlik numarası/IBAN benzeri bir `q` süzmeye katılmaz ve forma geri yazılmaz; arama kutusu POST eder.
  const kimlikGirdisi = typeof ham === 'string' && kimlikBenzeriMi(ham)
  const q = typeof ham === 'string' && !kimlikGirdisi ? ham : undefined
  const liste = await tasinmazListesi(q)
  return (
    <>
      <SayfaBasligi baslik="Taşınmazlar" eylemler={<DugmeLink href="/tasinmazlar/yeni" tur="birincil">Yeni taşınmaz</DugmeLink>} />
      {kimlik === '1' || kimlikGirdisi ? <div className="mb-3"><Uyari ton="uyari">Kimlik numarası ile arama Kişiler ekranından yapılır. Burada ad, adres, ilçe veya ada/parsel aranır.</Uyari></div> : null}
      <form action={tasinmazAraAction} className="mb-3"><Girdi name="q" type="search" defaultValue={q} aria-label="Taşınmaz ara" placeholder="Ad, adres, ilçe veya 123/45 (ada/parsel)" autoComplete="off" className="max-w-md" /></form>
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
