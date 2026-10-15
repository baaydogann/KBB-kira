import Link from 'next/link'
import { maskele } from '@/core/dogrulama'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kisiKimlikListesi } from '@/server/kisi/arama'
import { kisiGorunenAd, kisiListesi, kisiListesiKimliklerle } from '@/server/kisi/servis'
import { kimlikBenzeriMi } from '@/server/sozlesme/arama'
import { sozlesmeListesi } from '@/server/sozlesme/sorgu'
import { tasinmazListesi } from '@/server/tasinmaz/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Uyari } from '@/components/ui/uyari'

type Param = string | string[]

export default async function AraSayfasi({ searchParams }: { searchParams: Promise<{ q?: Param; bulunamadi?: Param; kisiler?: Param }> }) {
  await kullaniciGerekli()
  const { q: ham, bulunamadi, kisiler: kisiKimlikleri } = await searchParams
  // TCKN/VKN/IBAN adres satırında aranmaz (KVKK): kimlik benzeri bir `q` yok sayılır, arama kutusu POST eder.
  const q = typeof ham === 'string' && !kimlikBenzeriMi(ham) ? ham.trim() : ''
  // Ortak IBAN sonucu: adreste yalnızca kişi kimlikleri bulunur (katı doğrulanır, sayısı sınırlıdır); IBAN'ın kendisi yoktur.
  const ortak = await kisiListesiKimliklerle(kisiKimlikListesi(kisiKimlikleri))
  const [sozlesmeler, kisiler, tasinmazlar] = q.length < 2 ? [[], [], []] : await Promise.all([sozlesmeListesi({ q }), kisiListesi(q), tasinmazListesi(q)])
  const ipucu = q.length < 2 && bulunamadi !== '1' && ortak.length === 0
  return (
    <>
      <SayfaBasligi baslik={q ? `Arama: ${q}` : 'Arama'} aciklama={ipucu ? 'En az 2 karakter girin.' : undefined} />
      {bulunamadi === '1' ? <div className="mb-3"><Uyari ton="uyari">Bu kimlik numarası veya IBAN ile kayıtlı kişi bulunamadı. Kimlik numarası yalnızca rakamlarla, başka metin olmadan girilmelidir.</Uyari></div> : null}
      {ortak.length > 0 ? (
        <div className="mb-4">
          <Kart baslik={`Bu IBAN birden çok kişide kayıtlı (${ortak.length})`}>
            <ul className="space-y-1 text-sm">{ortak.map((k) => <li key={k.id}><Link href={`/kisiler/${k.id}`} className="text-marka hover:underline">{kisiGorunenAd(k)}</Link> — {maskele(k.tckn ?? k.vkn ?? '')}</li>)}</ul>
          </Kart>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Kart baslik={`Sözleşmeler (${sozlesmeler.length})`}><ul className="space-y-1 text-sm">{sozlesmeler.map((s) => <li key={s.id}><Link href={`/sozlesmeler/${s.id}`} className="text-marka hover:underline">{s.sozlesmeNo}</Link> — {s.tasinmaz}</li>)}</ul></Kart>
        <Kart baslik={`Malikler (${kisiler.length})`}><ul className="space-y-1 text-sm">{kisiler.map((k) => <li key={k.id}><Link href={`/kisiler/${k.id}`} className="text-marka hover:underline">{kisiGorunenAd(k)}</Link> — {maskele(k.tckn ?? k.vkn ?? '')}</li>)}</ul></Kart>
        <Kart baslik={`Taşınmazlar (${tasinmazlar.length})`}><ul className="space-y-1 text-sm">{tasinmazlar.map((t) => <li key={t.id}><Link href={`/tasinmazlar/${t.id}`} className="text-marka hover:underline">{t.kisaAd}</Link>{t.ada ? ` — ${t.ada}/${t.parsel}` : ''}</li>)}</ul></Kart>
      </div>
    </>
  )
}
