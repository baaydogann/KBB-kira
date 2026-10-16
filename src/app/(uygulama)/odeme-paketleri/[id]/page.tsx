import { notFound } from 'next/navigation'
import { bugunIstanbul } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { BulunamadiHatasi } from '@/server/hata'
import { paketDetayi, paketOnerileri } from '@/server/paket/sorgu'
import { yolKimligi } from '@/app/_lib/form'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { Rozet } from '@/components/ui/rozet'
import { PAKET_DURUM_ETIKETI, PAKET_DURUM_TONU } from '../durum'
import { EylemFormu } from '@/components/eylem-formu'
import { paketHesaplaAction } from '../actions'
import { DagilimBolumu } from './bolumler/dagilim'
import { FaturalarBolumu } from './bolumler/faturalar'
import { OnKontrolBolumu } from './bolumler/on-kontrol'
import { TaksitlerBolumu } from './bolumler/taksitler'

export default async function PaketSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await kullaniciGerekli()
  const id = yolKimligi((await params).id)
  if (id === null) notFound()
  const bugun = bugunIstanbul()
  const p = await paketDetayi(id, bugun).catch((e: unknown) => { if (e instanceof BulunamadiHatasi) notFound(); throw e })
  const duzenlenebilir = p.durum === 'TASLAK' || p.durum === 'HESAPLANDI'
  const oneriler = duzenlenebilir ? await paketOnerileri(id, bugun) : []
  return (
    <>
      <SayfaBasligi baslik={`Ödeme paketi #${p.id} — ${p.ad}`} aciklama={p.birim.ad} />
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm md:grid-cols-4">
        <div>Durum<br /><Rozet ton={PAKET_DURUM_TONU[p.durum]}>{PAKET_DURUM_ETIKETI[p.durum]}</Rozet></div>
        <div>Vade aralığı<br /><TarihMetni deger={p.vadeBaslangic} /> – <TarihMetni deger={p.vadeBitis} /></div>
        <div>Hesap tarihi<br /><TarihMetni deger={p.hesapTarihi} /></div>
        <div>Kalan ödenek<br />{p.kalanOdenek === null ? '—' : <ParaMetni deger={p.kalanOdenek} />}</div>
      </div>
      <div className="space-y-4">
        {duzenlenebilir ? (
          <div className="flex flex-wrap items-start gap-3">
            <EylemFormu eylem={paketHesaplaAction} dugme={p.durum === 'HESAPLANDI' ? 'Yeniden hesapla' : 'Hesapla'} tur="birincil" kimlikOneki="hesapla-">
              <input type="hidden" name="paketId" value={p.id} />
              <input type="hidden" name="version" value={p.version} />
            </EylemFormu>
            <p className="max-w-xl text-xs text-slate-600">Oranlar bugünün parametrelerinden alınır. 22/A borç sorgularını ve faturaları hesaplamadan önce girin; kesinleştirme hesapla ile aynı gün yapılır.</p>
          </div>
        ) : null}
        <OnKontrolBolumu p={p} />
        <TaksitlerBolumu p={p} oneriler={oneriler} duzenlenebilir={duzenlenebilir} />
        <FaturalarBolumu p={p} duzenlenebilir={duzenlenebilir} />
        <DagilimBolumu p={p} />
      </div>
    </>
  )
}
