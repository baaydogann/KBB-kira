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
import { Rozet } from '@/components/ui/rozet'
import { Uyari } from '@/components/ui/uyari'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { KisiFormu, StatuTeyitFormu } from '../kisi-formu'
import { IbanAktiflikFormu, IbanFormu } from '../iban-formu'
import { borcSorguSilAction, hacizEkleAction, hacizKapatAction } from '../actions'
import { BorcSorguFormu } from './kesinti-formlari'
import { kisiKesintileri } from '@/server/kesinti/servis'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'

const HACIZ_ALANLARI: EylemAlani[] = [
  { ad: 'alacakli', etiket: 'Kesintinin gönderileceği daire (icra/vergi dairesi)', zorunlu: true },
  { ad: 'dosyaNo', etiket: 'Dosya no', zorunlu: true },
  { ad: 'tebligTarihi', etiket: 'Tebliğ tarihi', tur: 'date', zorunlu: true },
  { ad: 'toplamTutar', etiket: 'Haciz tutarı', zorunlu: true, ondalik: true, yerTutucu: '1.234,56' },
]
const KAPAT_ALANLARI: EylemAlani[] = [{ ad: 'neden', etiket: 'Kapanış nedeni', zorunlu: true }]

export default async function KisiSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const kimlik = yolKimligi((await params).id)
  if (kimlik === null) notFound()
  const k = await kisiDetayi(kimlik).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  const kural = (await statuKurallari(bugunIstanbul()))[k.vergiStatusu]
  const kesinti = await kisiKesintileri(k.id, bugunIstanbul())
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
              <StatuTeyitFormu kisiId={k.id} version={k.version} vergiStatusu={k.vergiStatusu} teyitli={k.statuTeyitli} />
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
                      <IbanAktiflikFormu ibanId={i.id} kisiId={k.id} aktif={i.aktif} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tablo>
            <IbanFormu kisiId={k.id} />
          </div>
        </Kart>
        <Kart baslik="22/A borç sorguları">
          <div className="space-y-3">
            {kesinti.sorgular.length === 0 ? <p className="text-sm text-slate-500">Kayıtlı borç sorgusu yok.</p> : (
              <Tablo>
                <thead><tr><Th>Sorgu tarihi</Th><Th>Geçerlilik bitişi</Th><Th>Borç</Th><Th className="text-right">Tutar</Th><Th>Vergi dairesi</Th><Th>Belge no</Th><Th>Belge</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {kesinti.sorgular.map((s) => (
                    <tr key={s.id}>
                      <Td><TarihMetni deger={s.sorguTarihi} /></Td>
                      <Td><TarihMetni deger={s.gecerlilikBitis} /> {s.gecerli ? <Rozet ton="yesil">geçerli</Rozet> : <Rozet>süresi doldu</Rozet>}</Td>
                      <Td>{s.borcVar ? <Rozet ton="kirmizi">var</Rozet> : <Rozet ton="yesil">yok</Rozet>}</Td>
                      <Td className="text-right"><ParaMetni deger={s.borcTutari} /></Td>
                      <Td>{s.vergiDairesi ?? '—'}</Td>
                      <Td>{s.belgeNo ?? '—'}</Td>
                      <Td>{s.belgeId === null ? '—' : <a href={`/api/belgeler/${s.belgeId}`} target="_blank" rel="noreferrer" className="text-marka hover:underline">Aç</a>}</Td>
                      <Td>
                        {s.kullanildi ? <span className="text-xs text-slate-500">pakette kullanıldı</span> : (
                          <EylemFormu eylem={borcSorguSilAction} dugme="Sil" tur="hayalet" onayMetni="Borç sorgusu silinsin mi?" kimlikOneki={`sorgu-${s.id}-`}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="kisiId" value={k.id} />
                          </EylemFormu>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tablo>
            )}
            <BorcSorguFormu kisiId={k.id} />
          </div>
        </Kart>
        <Kart baslik="Hacizler">
          <div className="space-y-3">
            {kesinti.hacizler.length === 0 ? <p className="text-sm text-slate-500">Kayıtlı haciz yok.</p> : (
              <Tablo>
                <thead><tr><Th>Daire</Th><Th>Dosya no</Th><Th>Tebliğ</Th><Th className="text-right">Tutar</Th><Th className="text-right">Kalan</Th><Th>Durum</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {kesinti.hacizler.map((x) => (
                    <tr key={x.id}>
                      <Td>{x.alacakli}</Td>
                      <Td>{x.dosyaNo}</Td>
                      <Td><TarihMetni deger={x.tebligTarihi} /></Td>
                      <Td className="text-right"><ParaMetni deger={x.toplamTutar} /></Td>
                      <Td className="text-right"><ParaMetni deger={x.kalanTutar} /></Td>
                      <Td>{x.durum === 'AKTIF' ? <Rozet ton="sari">aktif</Rozet> : <Rozet>kapandı</Rozet>}{x.kapanisNedeni ? <span className="ml-1 text-xs text-slate-500">{x.kapanisNedeni}</span> : null}</Td>
                      <Td>
                        {x.durum === 'AKTIF' ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-marka">Kapat</summary>
                            <EylemFormu eylem={hacizKapatAction} dugme="Haczi kapat" alanlar={KAPAT_ALANLARI} kimlikOneki={`haciz-${x.id}-`}>
                              <input type="hidden" name="id" value={x.id} />
                              <input type="hidden" name="version" value={x.version} />
                              <input type="hidden" name="kisiId" value={k.id} />
                            </EylemFormu>
                          </details>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tablo>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-marka">Haciz ekle</summary>
              <div className="mt-2 max-w-md">
                <EylemFormu eylem={hacizEkleAction} dugme="Haczi kaydet" tur="birincil" alanlar={HACIZ_ALANLARI} kimlikOneki="haciz-yeni-">
                  <input type="hidden" name="kisiId" value={k.id} />
                </EylemFormu>
              </div>
            </details>
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
