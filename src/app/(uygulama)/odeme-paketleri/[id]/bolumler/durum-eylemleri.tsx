import type { Tarih } from '@/core/tarih'
import type { PaketDetayi } from '@/server/paket/sorgu'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { paketIptalAction, paketKesinlestirAction, paketOdemeEmriAction, paketOdemeGeriAlAction, paketOdendiAction } from '../../actions'

const IPTAL_ALANLARI: EylemAlani[] = [{ ad: 'neden', etiket: 'İptal nedeni', zorunlu: true }]
const ODEME_EMRI_ALANLARI: EylemAlani[] = [
  { ad: 'no', etiket: 'Ödeme emri no', zorunlu: true },
  { ad: 'tarih', etiket: 'Ödeme emri tarihi', tur: 'date', zorunlu: true, ipucu: 'Hesap günü ile bugün arasında; 22/A belgesi bu tarihte geçerli olmalı.' },
]
const ODENDI_ALANLARI: EylemAlani[] = [{ ad: 'odemeTarihi', etiket: 'Ödeme tarihi', tur: 'date', zorunlu: true }]
const GERI_AL_ALANLARI: EylemAlani[] = [{ ad: 'neden', etiket: 'Geri alma nedeni', zorunlu: true, ipucu: 'Ör. banka iadesi ya da yanlış işaretleme.' }]

/**
 * Spec §10.1-4: paket durum geçişleri (kesinleştir → ödeme emri → ödendi; iptal; ödemeyi geri al) ve durum zaman çizelgesi. Ödenmiş paket
 * iptal edilmez; tutar düzeltmesi kira dönemi bedelinden yapılır.
 */
export function DurumEylemleriBolumu({ p, bugun }: { p: PaketDetayi; bugun: Tarih }) {
  const gizli = (
    <>
      <input type="hidden" name="paketId" value={p.id} />
      <input type="hidden" name="version" value={p.version} />
    </>
  )
  const iptal = (
    <details className="text-sm">
      <summary className="cursor-pointer text-red-700">İptal et</summary>
      <EylemFormu eylem={paketIptalAction} dugme="Paketi iptal et" tur="tehlike" alanlar={IPTAL_ALANLARI} kimlikOneki="iptal-"
        onayMetni="Paket iptal edilecek; kesinleşmişse taksitler ödenmemiş duruma, kesintiler kalanlara döner. Devam edilsin mi?">{gizli}</EylemFormu>
    </details>
  )
  const hataYok = p.onKontrol !== null && p.onKontrol.hatalar.length === 0
  const uyariSayisi = p.onKontrol?.uyarilar.length ?? 0
  return (
    <Kart baslik="Durum">
      <dl className="mb-3 grid gap-2 text-sm md:grid-cols-4">
        <div><dt className="text-slate-500">Kesinleşme</dt><dd>{p.kesinlesmeZamani ? p.kesinlesmeZamani.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'}</dd></div>
        <div><dt className="text-slate-500">Ödeme emri</dt><dd>{p.muhasebeOdemeEmriNo ? <>{p.muhasebeOdemeEmriNo} · <TarihMetni deger={p.muhasebeOdemeEmriTarihi} /></> : '—'}</dd></div>
        <div><dt className="text-slate-500">Ödeme</dt><dd><TarihMetni deger={p.odemeTarihi} /></dd></div>
        <div><dt className="text-slate-500">İptal</dt><dd>{p.iptalNedeni ?? '—'}</dd></div>
        {p.odemeGeriAlmaNedeni ? <div className="md:col-span-4"><dt className="text-slate-500">Ödeme geri alındı (son)</dt><dd>{p.odemeGeriAlmaNedeni}</dd></div> : null}
      </dl>
      <div className="flex flex-wrap items-start gap-4">
        {p.durum === 'HESAPLANDI' && hataYok ? (
          <div>
            <EylemFormu eylem={paketKesinlestirAction} dugme="Kesinleştir" tur="birincil" kimlikOneki="kesinlestir-"
              onayMetni={`${uyariSayisi} uyarı var. Paket kesinleşince dağılım değiştirilemez. Devam edilsin mi?`}>{gizli}</EylemFormu>
            {p.hesapTarihi !== bugun ? <p className="mt-1 text-xs text-amber-700">Hesap bugün yapılmadı; kesinleştirmeden önce yeniden hesaplayın.</p> : null}
          </div>
        ) : null}
        {p.durum === 'KESINLESTI' ? (
          <EylemFormu eylem={paketOdemeEmriAction} dugme="Ödeme emrini kaydet" tur="birincil" alanlar={ODEME_EMRI_ALANLARI} kimlikOneki="odeme-emri-">{gizli}</EylemFormu>
        ) : null}
        {p.durum === 'ODEME_EMRINDE' ? (
          <EylemFormu eylem={paketOdendiAction} dugme="Ödendi" tur="birincil" alanlar={ODENDI_ALANLARI} kimlikOneki="odendi-">{gizli}</EylemFormu>
        ) : null}
        {p.durum === 'ODENDI' ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-marka">Ödemeyi geri al</summary>
            <EylemFormu eylem={paketOdemeGeriAlAction} dugme="Ödemeyi geri al" tur="tehlike" alanlar={GERI_AL_ALANLARI} kimlikOneki="geri-al-"
              onayMetni="Ödeme kaydı silinecek ve paket ödeme emrine dönecek. Devam edilsin mi?">{gizli}</EylemFormu>
          </details>
        ) : null}
        {p.durum !== 'ODENDI' && p.durum !== 'IPTAL' ? iptal : null}
      </div>
    </Kart>
  )
}
