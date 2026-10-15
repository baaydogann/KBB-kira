'use client'

import { useActionState } from 'react'
import { Alan, Girdi, MetinAlani, Secim } from '@/components/ui/alan'
import { Dugme } from '@/components/ui/dugme'
import { FormMesaji } from '@/components/form-durumu'
import { BOS_FORM } from '@/app/_lib/form-durumu'
import { tasinmazKaydetAction } from './actions'

export interface TasinmazFormVerisi {
  id?: number; version?: number; tur?: string; kisaAd?: string; adres?: string; ilce?: string; mahalle?: string | null
  ada?: string | null; parsel?: string | null; bagimsizBolum?: string | null; tapuBilgisi?: string | null; m2?: string | null
  kullananBirimId?: number | null; kullanimAmaci?: string; notlar?: string | null
}

const TURLER = [['BINA', 'Bina'], ['ISYERI', 'İşyeri / dükkân'], ['ARSA', 'Arsa'], ['DEPO', 'Depo'], ['KONUT', 'Konut']]
const AMACLAR = [['HIZMET_BINASI', 'Hizmet binası'], ['LOJMAN', 'Lojman'], ['DEPO', 'Depo'], ['OTOPARK', 'Otopark'], ['SOSYAL_TESIS', 'Sosyal tesis'], ['DIGER', 'Diğer']]

// React 19 başarısız gönderimden sonra formu sıfırlar; <select>'in defaultValue'su sonradan değişince seçili seçeneği
// güncellemez, sıfırlama ilk varsayılana döner. Gönderilen değer `key` olunca select yeniden kurulur ve değer korunur.
export function TasinmazFormu({ veri = {}, birimler }: { veri?: TasinmazFormVerisi; birimler: { id: number; ad: string }[] }) {
  const [durum, eylem, bekliyor] = useActionState(tasinmazKaydetAction, BOS_FORM)
  const h = durum.alanHatalari
  const d = durum.degerler
  return (
    <form action={eylem} className="grid gap-3 md:grid-cols-3">
      <div className="md:col-span-3"><FormMesaji durum={durum} /></div>
      {veri.id ? <><input type="hidden" name="id" value={veri.id} /><input type="hidden" name="version" value={veri.version} /></> : null}
      <Alan etiket="Tür" ad="tur" hata={h.tur}><Secim key={d?.tur ?? ''} name="tur" defaultValue={d?.tur ?? veri.tur ?? 'ISYERI'}>{TURLER.map(([k, e]) => <option key={k} value={k}>{e}</option>)}</Secim></Alan>
      <Alan etiket="Kısa ad" ad="kisaAd" hata={h.kisaAd}><Girdi name="kisaAd" defaultValue={d?.kisaAd ?? veri.kisaAd} required /></Alan>
      <Alan etiket="Kullanım amacı" ad="kullanimAmaci" hata={h.kullanimAmaci}><Secim key={d?.kullanimAmaci ?? ''} name="kullanimAmaci" defaultValue={d?.kullanimAmaci ?? veri.kullanimAmaci ?? 'HIZMET_BINASI'}>{AMACLAR.map(([k, e]) => <option key={k} value={k}>{e}</option>)}</Secim></Alan>
      <Alan etiket="Adres" ad="adres" hata={h.adres} className="md:col-span-2"><Girdi name="adres" defaultValue={d?.adres ?? veri.adres} required /></Alan>
      <Alan etiket="İlçe" ad="ilce" hata={h.ilce}><Girdi name="ilce" defaultValue={d?.ilce ?? veri.ilce} required /></Alan>
      <Alan etiket="Mahalle" ad="mahalle" hata={h.mahalle}><Girdi name="mahalle" defaultValue={d?.mahalle ?? veri.mahalle ?? ''} /></Alan>
      <Alan etiket="Ada" ad="ada" hata={h.ada}><Girdi name="ada" defaultValue={d?.ada ?? veri.ada ?? ''} /></Alan>
      <Alan etiket="Parsel" ad="parsel" hata={h.parsel}><Girdi name="parsel" defaultValue={d?.parsel ?? veri.parsel ?? ''} /></Alan>
      <Alan etiket="Bağımsız bölüm" ad="bagimsizBolum" hata={h.bagimsizBolum}><Girdi name="bagimsizBolum" defaultValue={d?.bagimsizBolum ?? veri.bagimsizBolum ?? ''} /></Alan>
      <Alan etiket="Alan (m²)" ad="m2" hata={h.m2} ipucu="1.250,50"><Girdi name="m2" defaultValue={d?.m2 ?? veri.m2 ?? ''} inputMode="decimal" /></Alan>
      <Alan etiket="Kullanan birim" ad="kullananBirimId" hata={h.kullananBirimId}>
        <Secim key={d?.kullananBirimId ?? ''} name="kullananBirimId" defaultValue={d?.kullananBirimId ?? veri.kullananBirimId ?? ''}>
          <option value="">—</option>
          {birimler.map((b) => <option key={b.id} value={b.id}>{b.ad}</option>)}
        </Secim>
      </Alan>
      <Alan etiket="Tapu bilgisi" ad="tapuBilgisi" hata={h.tapuBilgisi} className="md:col-span-3"><Girdi name="tapuBilgisi" defaultValue={d?.tapuBilgisi ?? veri.tapuBilgisi ?? ''} /></Alan>
      <Alan etiket="Notlar" ad="notlar" hata={h.notlar} className="md:col-span-3"><MetinAlani name="notlar" defaultValue={d?.notlar ?? veri.notlar ?? ''} /></Alan>
      <div><Dugme type="submit" tur="birincil" disabled={bekliyor}>Kaydet</Dugme></div>
    </form>
  )
}
