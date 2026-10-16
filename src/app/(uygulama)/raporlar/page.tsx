import { ayKaydir, bugunIstanbul, tarihinAyi } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'

const VERGI_RAPORLARI = [
  { ad: 'muhtasar', baslik: 'Muhtasar listesi', aciklama: 'Kira stopajı: hak sahibi ve ödeme türü kodu başına gayrisafi tutar ve kesilen vergi.' },
  { ad: 'damga', baslik: 'Damga vergisi listesi', aciklama: 'İstihkaktan kesilen damga vergisi: sözleşme, malik ve damga olayı.' },
  { ad: 'kesinti-22a', baslik: '22/A kesinti listesi', aciklama: '6183 md. 22/A kesintileri: vergi dairesi, belge no, borçlu; özet sayfasıyla.' },
]

/** Spec §11: vergi listeleri ödeme tarihine göre (yalnızca ödenmiş paketler). Formlar GET ile indirme uç noktasına gider. */
export default async function RaporlarSayfasi() {
  await kullaniciGerekli()
  const onceki = ayKaydir(tarihinAyi(bugunIstanbul()), -1)
  const varsayilan = `${onceki.yil}-${String(onceki.ay).padStart(2, '0')}`
  return (
    <>
      <SayfaBasligi baslik="Raporlar" aciklama="Listeler ödendi tarihine göredir; kesinleşmiş ama ödenmemiş paketler girmez." />
      <div className="grid gap-4 md:grid-cols-3">
        {VERGI_RAPORLARI.map((r) => (
          <Kart key={r.ad} baslik={r.baslik}>
            <p className="mb-3 text-xs text-slate-600">{r.aciklama}</p>
            <form method="get" action={`/api/raporlar/${r.ad}`} className="grid gap-2 text-sm">
              <label className="grid gap-1">Ay<input type="month" name="ay" defaultValue={varsayilan} required className="rounded border border-slate-300 px-2 py-1" /></label>
              <label className="grid gap-1">Biçim
                <select name="bicim" defaultValue="xlsx" className="rounded border border-slate-300 px-2 py-1">
                  <option value="xlsx">Excel (xlsx)</option>
                  <option value="csv">CSV (;)</option>
                </select>
              </label>
              <button type="submit" className="rounded bg-marka px-3 py-1.5 font-medium text-white hover:opacity-90">İndir</button>
            </form>
          </Kart>
        ))}
      </div>
    </>
  )
}
