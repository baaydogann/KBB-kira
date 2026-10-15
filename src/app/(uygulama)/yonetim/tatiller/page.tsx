import { kullaniciGerekli } from '@/server/auth/gerekli'
import { tatilListesi } from '@/server/tatil/servis'
import { bugunIstanbul, parcala, tarihMi } from '@/core/tarih'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Sekmeler } from '@/components/ui/sekmeler'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { Dugme } from '@/components/ui/dugme'
import { TarihMetni } from '@/components/tarih'
import { tatilSilAction } from './actions'
import { TatilFormu } from './tatil-formu'

export default async function TatillerSayfasi({ searchParams }: { searchParams: Promise<{ yil?: string }> }) {
  await kullaniciGerekli()
  const buYil = parcala(bugunIstanbul()).yil
  const { yil: yilMetni } = await searchParams
  // `yil` kullanıcı girdisidir: tam dört haneli ve çekirdeğin desteklediği aralıkta olmayan değer (?yil=0000, ?yil=3000, ?yil=a) bu yıla düşer.
  const yil = typeof yilMetni === 'string' && tarihMi(`${yilMetni}-01-01`) ? Number(yilMetni) : buYil
  const liste = await tatilListesi(yil)
  const yillar = [buYil - 1, buYil, buYil + 1, buYil + 2]
  return (
    <>
      <SayfaBasligi baslik="Resmi tatiller" aciklama="Yasal son günlerin iş gününe kaydırılmasında kullanılır. Yarım günler iş günü sayılır." />
      <div className="space-y-4">
        <Kart baslik="Tatil ekle"><TatilFormu /></Kart>
        <Sekmeler sekmeler={yillar.map((y) => ({ anahtar: String(y), etiket: String(y) }))} aktif={String(yil)} temelUrl="/yonetim/tatiller" parametre="yil" />
        <Tablo>
          <thead><tr><Th>Tarih</Th><Th>Ad</Th><Th>Tür</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((t) => (
              <tr key={t.id}>
                <Td><TarihMetni deger={t.tarih} /></Td>
                <Td>{t.ad}</Td>
                <Td>{t.yarimGun ? 'Yarım gün' : 'Tam gün'}</Td>
                <Td>
                  <form action={tatilSilAction}><input type="hidden" name="id" value={t.id} /><Dugme type="submit" tur="hayalet">Sil</Dugme></form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
