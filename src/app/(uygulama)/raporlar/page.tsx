import { ayKaydir, bugunIstanbul, parcala, tarihinAyi } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { gecikmisOdemeler, sozlesmeDurumRaporu } from '@/server/rapor/yonetim'
import { ParaMetni } from '@/components/para'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'

const AZAMI_SATIR = 500
const DURUM_ADI: Record<string, string> = { AKTIF: 'Aktif', UZADI: 'Uzadı', FESHEDILDI: 'Feshedildi', SONA_ERDI: 'Sona erdi' }
const GIRDI = 'rounded border border-slate-300 px-2 py-1'
const DUGME = 'rounded bg-marka px-3 py-1.5 font-medium text-white hover:opacity-90'

function ExcelBaglantisi({ rapor }: { rapor: string }) {
  return <a href={`/api/raporlar/${rapor}`} className="text-sm text-marka hover:underline">{"Excel'i indir"}</a>
}

function SinirNotu({ toplam }: { toplam: number }) {
  return toplam > AZAMI_SATIR ? <p className="mt-2 text-xs text-amber-700">İlk {AZAMI_SATIR} satır gösteriliyor ({toplam} satır var); tamamı için {"Excel'i"} indirin.</p> : null
}

const VERGI_RAPORLARI = [
  { ad: 'muhtasar', baslik: 'Muhtasar listesi', aciklama: 'Kira stopajı: hak sahibi ve ödeme türü kodu başına gayrisafi tutar ve kesilen vergi.' },
  { ad: 'damga', baslik: 'Damga vergisi listesi', aciklama: 'İstihkaktan kesilen damga vergisi: sözleşme, malik ve damga olayı.' },
  { ad: 'kesinti-22a', baslik: '22/A kesinti listesi', aciklama: '6183 md. 22/A kesintileri: vergi dairesi, belge no, borçlu; özet sayfasıyla.' },
]

/** Spec §11: vergi listeleri ödeme tarihine göre (yalnızca ödenmiş paketler). Formlar GET ile indirme uç noktasına gider. */
export default async function RaporlarSayfasi() {
  await kullaniciGerekli()
  const bugun = bugunIstanbul()
  const [gecikmis, durumlar] = await Promise.all([gecikmisOdemeler(bugun), sozlesmeDurumRaporu(bugun)])
  const onceki = ayKaydir(tarihinAyi(bugun), -1)
  const varsayilan = `${onceki.yil}-${String(onceki.ay).padStart(2, '0')}`
  return (
    <>
      <SayfaBasligi baslik="Raporlar" aciklama="Listeler ödendi tarihine göredir; kesinleşmiş ama ödenmemiş paketler girmez." />
      <div className="grid gap-4 md:grid-cols-3">
        {VERGI_RAPORLARI.map((r) => (
          <Kart key={r.ad} baslik={r.baslik}>
            <p className="mb-3 text-xs text-slate-600">{r.aciklama}</p>
            <form method="get" action={`/api/raporlar/${r.ad}`} className="grid gap-2 text-sm">
              <label className="grid gap-1">Ay<input type="month" name="ay" defaultValue={varsayilan} required className={GIRDI} /></label>
              <label className="grid gap-1">Biçim
                <select name="bicim" defaultValue="xlsx" className={GIRDI}>
                  <option value="xlsx">Excel (xlsx)</option>
                  <option value="csv">CSV (;)</option>
                </select>
              </label>
              <button type="submit" className={DUGME}>İndir</button>
            </form>
          </Kart>
        ))}
        <Kart baslik="Ödenek / taahhüt">
          <p className="mb-3 text-xs text-slate-600">Yıl içinde vadesi olan taksitlerin gideri (brüt + KDV), ödenen ve kalan; ekonomik kod ve birim başına. Kesinleşmemiş taksitler bugünün oranlarıyla tahmindir.</p>
          <form method="get" action="/api/raporlar/odenek" className="grid gap-2 text-sm">
            <label className="grid gap-1">Yıl<input type="number" name="yil" min={2000} max={2100} defaultValue={parcala(bugun).yil} required className={GIRDI} /></label>
            <button type="submit" className={DUGME}>{"Excel'i indir"}</button>
          </form>
        </Kart>
      </div>
      <div className="mt-6 space-y-4">
        <Kart baslik={`Gecikmiş ödemeler (${gecikmis.length})`} eylemler={<ExcelBaglantisi rapor="gecikmis" />}>
          {gecikmis.length === 0 ? <p className="text-sm text-slate-600">Gecikmiş ödeme yok.</p> : (
            <Tablo>
              <thead><tr><Th>Sözleşme</Th><Th>Taşınmaz</Th><Th>Birim</Th><Th>Vade</Th><Th className="text-right">Gecikme</Th><Th className="text-right">Tutar</Th><Th>Durum</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {gecikmis.slice(0, AZAMI_SATIR).map((x) => (
                  <tr key={x.taksitId}>
                    <Td><a href={`/sozlesmeler/${x.sozlesmeId}?sekme=taksitler`} className="text-marka hover:underline">{x.sozlesmeNo}</a></Td>
                    <Td>{x.kisaAd}</Td><Td>{x.birim}</Td><Td><TarihMetni deger={x.vade} /></Td>
                    <Td className="text-right">{x.gecikmeGun} gün</Td><Td className="text-right"><ParaMetni deger={x.tutar.toFixed(2)} /></Td>
                    <Td>{x.paketId === null ? 'Planlandı' : <a href={`/odeme-paketleri/${x.paketId}`} className="text-marka hover:underline">{x.durum === 'PAKETTE' ? 'Pakette' : 'Ödeme emrinde'} #{x.paketId}</a>}</Td>
                  </tr>
                ))}
              </tbody>
            </Tablo>
          )}
          <SinirNotu toplam={gecikmis.length} />
        </Kart>
        <Kart baslik={`Sözleşme durumu (${durumlar.length})`} eylemler={<ExcelBaglantisi rapor="sozlesme-durum" />}>
          <Tablo>
            <thead><tr><Th>Sözleşme</Th><Th>Taşınmaz</Th><Th>Birim</Th><Th>Durum</Th><Th>Etkin bitiş</Th><Th className="text-right">Kalan gün</Th><Th className="text-right">Güncel bedel</Th><Th>Sonraki artış</Th><Th className="text-right">Açık hatırlatma</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {durumlar.slice(0, AZAMI_SATIR).map((x) => (
                <tr key={x.sozlesmeId}>
                  <Td><a href={`/sozlesmeler/${x.sozlesmeId}`} className="text-marka hover:underline">{x.sozlesmeNo}</a></Td>
                  <Td>{x.kisaAd}</Td><Td>{x.birim}</Td><Td>{DURUM_ADI[x.durum] ?? x.durum}</Td><Td><TarihMetni deger={x.bitisEtkin} /></Td>
                  <Td className="text-right">{x.kalanGun ?? '—'}</Td>
                  <Td className="text-right"><ParaMetni deger={x.guncelBedel.toFixed(2)} /> <span className="text-xs text-slate-500">{x.bedelTabani === 'AYLIK' ? '/ay' : '/yıl'}</span></Td>
                  <Td><TarihMetni deger={x.sonrakiArtis} /></Td><Td className="text-right">{x.acikHatirlatma}</Td>
                </tr>
              ))}
            </tbody>
          </Tablo>
          <SinirNotu toplam={durumlar.length} />
        </Kart>
      </div>
    </>
  )
}
