import Link from 'next/link'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { SOZLESME_DURUMLARI, kimlikBenzeriMi } from '@/server/sozlesme/arama'
import { sozlesmeListesi } from '@/server/sozlesme/sorgu'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { DugmeLink } from '@/components/ui/dugme'
import { Rozet } from '@/components/ui/rozet'
import { Uyari } from '@/components/ui/uyari'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { DURUM_ETIKETI, DURUM_TONU } from './_bilesenler/durum'
import { sozlesmeAraAction } from './actions'

export default async function SozlesmelerSayfasi({ searchParams }: { searchParams: Promise<{ durum?: string | string[]; q?: string | string[]; kimlik?: string | string[] }> }) {
  await kullaniciGerekli()
  const { durum: hamDurum, q: hamQ, kimlik } = await searchParams
  const durum = SOZLESME_DURUMLARI.find((d) => d === hamDurum)
  // Arama sözleşme no ve taşınmaz adı içindir (KVKK): kimlik numarası/IBAN benzeri bir `q` süzmeye katılmaz ve forma geri yazılmaz.
  const kimlikGirdisi = typeof hamQ === 'string' && kimlikBenzeriMi(hamQ)
  const q = typeof hamQ === 'string' && !kimlikGirdisi ? hamQ : undefined
  const liste = await sozlesmeListesi({ durum, q })
  return (
    <>
      <SayfaBasligi baslik="Sözleşmeler" eylemler={<DugmeLink href="/sozlesmeler/yeni" tur="birincil">Yeni sözleşme</DugmeLink>} />
      {kimlik === '1' || kimlikGirdisi ? <div className="mb-3"><Uyari ton="uyari">Kimlik numarası ile arama Kişiler ekranından yapılır. Burada yalnızca sözleşme no veya taşınmaz adı aranır.</Uyari></div> : null}
      <form action={sozlesmeAraAction} className="mb-3 flex gap-2">
        <input name="q" defaultValue={q} aria-label="Sözleşme ara" placeholder="Sözleşme no veya taşınmaz" className="w-full max-w-sm rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        <select name="durum" defaultValue={durum ?? ''} aria-label="Durum" className="rounded-md border border-slate-300 px-2 text-sm"><option value="">Tüm durumlar</option>{SOZLESME_DURUMLARI.map((d) => <option key={d} value={d}>{DURUM_ETIKETI[d]}</option>)}</select>
        <button className="rounded-md border border-slate-300 bg-white px-3 text-sm">Süz</button>
      </form>
      <Tablo>
        <thead><tr><Th>No</Th><Th>Taşınmaz</Th><Th>Birim</Th><Th>Durum</Th><Th>Başlangıç</Th><Th>Bitiş</Th><Th className="text-right">Güncel bedel</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {liste.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/sozlesmeler/${s.id}`} className="text-marka hover:underline">{s.sozlesmeNo}</Link></Td>
              <Td>{s.tasinmaz}</Td><Td>{s.birim}</Td>
              <Td><Rozet ton={DURUM_TONU[s.durum]}>{DURUM_ETIKETI[s.durum]}</Rozet></Td>
              <Td><TarihMetni deger={s.baslangic} /></Td>
              <Td><TarihMetni deger={s.bitis} />{(s.durum === 'AKTIF' || s.durum === 'UZADI') && s.kalanGun !== null && s.kalanGun <= 90 && s.kalanGun >= 0 ? <>{' '}<Rozet ton="sari">{s.kalanGun} gün</Rozet></> : null}</Td>
              <Td className="text-right"><ParaMetni deger={s.guncelBedel} /> <span className="text-xs text-slate-500">/{s.bedelTabani === 'AYLIK' ? 'ay' : 'yıl'}</span></Td>
            </tr>
          ))}
        </tbody>
      </Tablo>
    </>
  )
}
