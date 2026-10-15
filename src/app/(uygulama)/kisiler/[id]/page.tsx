import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ibanBicimle } from '@/core/dogrulama'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kisiDetayi, kisiGorunenAd } from '@/server/kisi/servis'
import { statuKurallari } from '@/server/parametre/servis'
import { BulunamadiHatasi } from '@/server/hata'
import { bugunIstanbul } from '@/core/tarih'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Dugme } from '@/components/ui/dugme'
import { Rozet } from '@/components/ui/rozet'
import { Uyari } from '@/components/ui/uyari'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { KisiFormu } from '../kisi-formu'
import { IbanFormu } from '../iban-formu'
import { ibanAktiflikAction, statuTeyitAction } from '../actions'

export default async function KisiSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const kimlik = yolKimligi((await params).id)
  if (kimlik === null) notFound()
  const k = await kisiDetayi(kimlik).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  const kural = (await statuKurallari(bugunIstanbul()))[k.vergiStatusu]
  // İstemci bileşenine yalnızca form alanları geçer: Prisma satırı (IBAN'lar, Decimal içeren sözleşmeler dahil) serileştirilemez.
  const veri = {
    id: k.id, version: k.version, tip: k.tip, tckn: k.tckn, vkn: k.vkn, ad: k.ad, soyad: k.soyad, unvan: k.unvan,
    vergiDairesi: k.vergiDairesi, vergiStatusu: k.vergiStatusu, telefon: k.telefon, adres: k.adres,
  }
  return (
    <>
      <SayfaBasligi baslik={kisiGorunenAd(k)} />
      <div className="space-y-4">
        {kural.teyitGerekli ? (
          <Uyari ton={k.statuTeyitli ? 'basari' : 'uyari'}>
            <div className="flex items-center justify-between gap-3">
              <span>{k.statuTeyitli ? 'Vergi statüsü müşavir tarafından teyit edildi.' : 'Bu vergi statüsünde stopaj/KDV uygulaması belirsiz; mali müşavir teyidi gerekli (spec §21).'}</span>
              <form action={statuTeyitAction}>
                <input type="hidden" name="kisiId" value={k.id} />
                <input type="hidden" name="teyitli" value={String(!k.statuTeyitli)} />
                <Dugme type="submit">{k.statuTeyitli ? 'Teyidi geri al' : 'Teyit edildi olarak işaretle'}</Dugme>
              </form>
            </div>
          </Uyari>
        ) : null}
        <Kart baslik="Kimlik ve vergi"><KisiFormu veri={veri} /></Kart>
        <Kart baslik="IBAN'lar">
          <div className="space-y-3">
            <Tablo>
              <thead><tr><Th>IBAN</Th><Th>Banka</Th><Th>Durum</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {k.ibanlar.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-mono text-xs">{ibanBicimle(i.iban)}</Td>
                    <Td>{i.bankaAdi ?? '—'}</Td>
                    <Td>{i.aktif ? <Rozet ton="yesil">Aktif</Rozet> : <Rozet>Pasif</Rozet>}</Td>
                    <Td>
                      <form action={ibanAktiflikAction}>
                        <input type="hidden" name="ibanId" value={i.id} /><input type="hidden" name="kisiId" value={k.id} />
                        <input type="hidden" name="aktif" value={String(!i.aktif)} />
                        <Dugme type="submit" tur="hayalet">{i.aktif ? 'Pasifleştir' : 'Aktifleştir'}</Dugme>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tablo>
            <IbanFormu kisiId={k.id} />
          </div>
        </Kart>
        <Kart baslik="Sözleşmeleri">
          {k.malikKayitlari.length === 0 ? <p className="text-sm text-slate-500">Bu kişiye bağlı sözleşme yok.</p> : (
            <ul className="list-disc pl-5 text-sm">
              {k.malikKayitlari.map((m) => (
                <li key={m.id}>
                  <Link href={`/sozlesmeler/${m.sozlesmeId}`} className="text-marka hover:underline">{m.sozlesme.sozlesmeNo}</Link>
                  {' '}— {m.sozlesme.tasinmaz.kisaAd} — hisse {m.pay}/{m.payda}
                </li>
              ))}
            </ul>
          )}
        </Kart>
      </div>
    </>
  )
}
