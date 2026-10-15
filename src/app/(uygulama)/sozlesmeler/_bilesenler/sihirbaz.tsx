'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { Alan, Girdi, MetinAlani, Secim } from '@/components/ui/alan'
import { Dugme, DugmeLink } from '@/components/ui/dugme'
import { Uyari } from '@/components/ui/uyari'
import { BelgeYukle } from '@/components/belge-yukle'
import { formatTL } from '@/core/para'
import { formatTarih } from '@/core/tarih'
import { onizleAction, sozlesmeKaydetAction, type OnizleSonucu } from '../actions'
import { MalikSatirlari } from './malik-satirlari'
import type { Kisiler, SihirbazVerisi } from './secenekler'

const ADIMLAR = ['Belge', 'Taşınmaz ve birim', 'Malikler', 'Bedel ve ödeme', 'Artış', 'Bütçe, onay ve geçiş', 'Önizleme'] as const

type Onizleme = Extract<OnizleSonucu, { ok: true }>['satirlar']

const ALAN_ADLARI: Record<string, string> = {
  sozlesmeNo: 'Sözleşme no', tasinmazId: 'Taşınmaz', birimId: 'Harcama birimi', imzaTarihi: 'İmza tarihi', baslangic: 'Başlangıç', bitis: 'Bitiş',
  ilkKiraBaslangici: 'İlk kira başlangıcı', bedelTutari: 'Kira bedeli', vadeParametresi: 'Vade günü', artisPeriyoduAy: 'Artış periyodu',
  sabitArtisOrani: 'Sabit artış oranı', ekonomikKod: 'Ekonomik kod', gecisTarihi: 'Geçiş tarihi', gecisBedeli: 'Güncel kira bedeli',
  onayBelgesiTarihi: 'Onay belgesi tarihi', piyasaArastirmaTarihi: 'Piyasa araştırma tarihi', odenmisSayilanSonTarih: 'Ödenmiş sayılan son tarih', malikler: 'Malikler',
}
const MALIK_ALANLARI: Record<string, string> = { kisiId: 'malik', pay: 'pay', payda: 'payda', ibanId: 'IBAN', vekilKisiId: 'vekil' }

/** Zod yolu ("malikler.1.pay") kullanıcıya okunur bir ada çevrilir. */
function alanAdi(yol: string): string {
  const m = /^malikler\.(\d+)\.(\w+)$/.exec(yol)
  if (m) return `${Number(m[1]) + 1}. malik (${MALIK_ALANLARI[m[2]!] ?? m[2]})`
  return ALAN_ADLARI[yol] ?? yol
}

/** Sunucuya gitmeden yakalanan zorunlu seçimler: boş seçim (0) sunucuda anlaşılmaz bir sayı hatası verirdi. */
function secimHatalari(v: SihirbazVerisi): Record<string, string> {
  const h: Record<string, string> = {}
  if (!v.tasinmazId) h.tasinmazId = 'Taşınmaz seçin.'
  if (!v.birimId) h.birimId = 'Harcama birimi seçin.'
  if (v.malikler.some((m) => !m.kisiId)) h.malikler = 'Her satırda bir malik seçin.'
  return h
}

export function Sihirbaz({ baslangicVerisi, secenekler, id, version, belgeId: ilkBelge }: {
  baslangicVerisi: SihirbazVerisi
  secenekler: { tasinmazlar: { id: number; kisaAd: string }[]; birimler: { id: number; ad: string }[]; kisiler: Kisiler }
  id: number | null
  version: number | null
  belgeId: number | null
}) {
  const router = useRouter()
  // Tüm girdiler istemci durumunda tutulur: başarısız bir kaydetme/önizleme girilenleri silmez.
  const [v, setV] = useState(baslangicVerisi)
  const [adim, setAdim] = useState(0)
  // Kayıt oluştuktan sonra (belge bağlanamadıysa sihirbaz açık kalır) sonraki kaydetmeler güncellemedir, kopya taslak açmaz.
  const [kayit, setKayit] = useState<{ id: number | null; version: number | null }>({ id, version })
  const [belgeId, setBelgeId] = useState<number | null>(ilkBelge)
  // Henüz bir sözleşmeye bağlanmamış, bu oturumda yüklenen geçici belge; kaydederken bağlanır.
  const [geciciBelge, setGeciciBelge] = useState<number | null>(null)
  const [hatalar, setHatalar] = useState<Record<string, string>>({})
  const [genelHata, setGenelHata] = useState<string | null>(null)
  const [belgeUyarisi, setBelgeUyarisi] = useState<string | null>(null)
  const [onizleme, setOnizleme] = useState<{ anahtar: string; satirlar: Onizleme } | null>(null)
  const [bekliyor, baslat] = useTransition()
  const d = <K extends keyof SihirbazVerisi>(k: K, deger: SihirbazVerisi[K]) => setV((x) => ({ ...x, [k]: deger }))
  const metin = (k: keyof SihirbazVerisi) => ({ id: k, value: String(v[k] ?? ''), onChange: (e: { target: { value: string } }) => d(k, e.target.value as never) })
  // Bileşen değil, düz fonksiyon: render içinde tanımlanan bileşen her tuşta input'u yeniden bağlar ve odak kaybolur.
  const alan = (e: string, k: string, cocuk: ReactNode, ipucu?: string) => <Alan etiket={e} ad={k} hata={hatalar[k]} ipucu={ipucu}>{cocuk}</Alan>
  const anahtar = JSON.stringify(v)

  function hataGoster(alanHatalari: Record<string, string>, mesaj: string | null) {
    setHatalar(alanHatalari)
    setGenelHata(mesaj)
  }

  function onizle() {
    const secim = secimHatalari(v)
    if (Object.keys(secim).length) return hataGoster(secim, 'Önizleme için eksik seçimleri tamamlayın.')
    baslat(async () => {
      try {
        const r = await onizleAction(v)
        if (r.ok) {
          setOnizleme({ anahtar, satirlar: r.satirlar })
          hataGoster({}, null)
        } else {
          setOnizleme(null)
          hataGoster(r.alanHatalari, r.mesaj || 'Önizleme hesaplanamadı.')
        }
      } catch {
        hataGoster({}, 'Sunucuya ulaşılamadı; girdileriniz korundu, tekrar deneyin.')
      }
    })
  }

  function kaydet() {
    const secim = secimHatalari(v)
    if (Object.keys(secim).length) return hataGoster(secim, 'Kaydetmeden önce eksik seçimleri tamamlayın.')
    baslat(async () => {
      try {
        const r = await sozlesmeKaydetAction(v, kayit.id, kayit.version, geciciBelge)
        if (!r.ok) {
          setBelgeUyarisi(null)
          return hataGoster(r.alanHatalari, r.hata)
        }
        hataGoster({}, null)
        if (r.belgeHatasi) {
          // Taslak kaydedildi, PDF bağlanamadı: sayfadan ayrılmayıp hata gösterilir; yeniden kaydetmek bağlamayı tekrar dener.
          setKayit({ id: r.id, version: r.version })
          setBelgeUyarisi(r.belgeHatasi)
          return
        }
        router.push(`/sozlesmeler/${r.id}`)
      } catch {
        hataGoster({}, 'Sunucuya ulaşılamadı; girdileriniz korundu, tekrar deneyin. Kayıt tamamlanmış olabilir: sözleşme listesini denetleyin.')
      }
    })
  }

  function belgeYuklendi(yeni: number) {
    setBelgeId(yeni)
    // Kayıtlı taslağa yüklenen belge doğrudan o sözleşmeye bağlıdır; yalnızca kayıtsız taslakta geçici belge beklenir.
    setGeciciBelge(kayit.id === null ? yeni : null)
    setBelgeUyarisi(null)
  }

  const hataSatirlari = Object.entries(hatalar).filter(([, m]) => m !== genelHata)

  return (
    <div className={belgeId ? 'grid gap-4 lg:grid-cols-2' : ''}>
      {belgeId ? <iframe src={`/api/belgeler/${belgeId}`} title="Sözleşme PDF" className="h-[80vh] w-full rounded border border-slate-200 bg-white" /> : null}
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1 text-xs">
          {ADIMLAR.map((a, i) => (
            <li key={a}><button type="button" aria-current={i === adim ? 'step' : undefined} onClick={() => setAdim(i)} className={i === adim ? 'rounded bg-marka px-2 py-1 text-white' : 'rounded bg-slate-200 px-2 py-1'}>{i + 1}. {a}</button></li>
          ))}
        </ol>
        {belgeUyarisi && kayit.id !== null ? (
          <Uyari ton="uyari">
            <p>Taslak kaydedildi, ancak PDF sözleşmeye bağlanamadı: {belgeUyarisi}</p>
            <p className="mt-1">PDF&apos;i &quot;Belge&quot; adımından yeniden yükleyip tekrar kaydedebilir ya da taslağı açıp oradan yükleyebilirsiniz.</p>
            <div className="mt-2"><DugmeLink href={`/sozlesmeler/${kayit.id}`}>Taslağı aç</DugmeLink></div>
          </Uyari>
        ) : null}
        {genelHata ? <Uyari ton="hata">{genelHata}{hataSatirlari.length ? <ul className="mt-1 list-disc pl-5">{hataSatirlari.map(([k, m]) => <li key={k}>{alanAdi(k)}: {m}</li>)}</ul> : null}</Uyari> : null}

        {adim === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Taranmış sözleşme PDF&apos;ini yükleyin; giriş sırasında solda görünür. İsteğe bağlıdır.</p>
            <BelgeYukle sahipTur={kayit.id === null ? 'gecici' : 'sozlesme'} sahipId={kayit.id ?? 0} belgeTuru="SOZLESME" tamam={belgeYuklendi} />
          </div>
        ) : null}

        {adim === 1 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alan('Sözleşme no', 'sozlesmeNo', <Girdi {...metin('sozlesmeNo')} />)}
            {alan('İmza tarihi', 'imzaTarihi', <Girdi type="date" {...metin('imzaTarihi')} />)}
            {alan('Taşınmaz', 'tasinmazId', <Secim id="tasinmazId" value={v.tasinmazId || ''} onChange={(e) => d('tasinmazId', Number(e.target.value))}><option value="">Seçin</option>{secenekler.tasinmazlar.map((t) => <option key={t.id} value={t.id}>{t.kisaAd}</option>)}</Secim>)}
            {alan('Harcama birimi', 'birimId', <Secim id="birimId" value={v.birimId || ''} onChange={(e) => d('birimId', Number(e.target.value))}><option value="">Seçin</option>{secenekler.birimler.map((b) => <option key={b.id} value={b.id}>{b.ad}</option>)}</Secim>)}
            {alan('Başlangıç', 'baslangic', <Girdi type="date" {...metin('baslangic')} />)}
            {alan('Bitiş (boş = belirsiz süreli)', 'bitis', <Girdi type="date" {...metin('bitis')} />)}
            {alan('İlk kira başlangıcı (yenilemelerde zincirin başı)', 'ilkKiraBaslangici', <Girdi type="date" {...metin('ilkKiraBaslangici')} />, 'Boşsa başlangıç alınır; 5 ve 10 yıllık sayaçlar buradan işler.')}
          </div>
        ) : null}

        {adim === 2 ? (
          <div className="space-y-2">
            {hatalar.malikler ? <Uyari ton="hata">{hatalar.malikler}</Uyari> : null}
            <MalikSatirlari satirlar={v.malikler} kisiler={secenekler.kisiler} degisti={(m) => d('malikler', m)} />
            <p className="text-xs text-slate-500">Hisseler kesir olarak girilir (ör. 7/24). Toplam tam olarak 1 olmalı. Vekil seçilirse ödeme vekilin IBAN&apos;ına yapılır.</p>
          </div>
        ) : null}

        {adim === 3 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alan('Kira bedeli', 'bedelTutari', <Girdi inputMode="decimal" {...metin('bedelTutari')} />, '1.234,56 biçiminde')}
            {alan('Bedel tabanı', 'bedelTabani', <Secim {...metin('bedelTabani')}><option value="AYLIK">Aylık</option><option value="YILLIK">Yıllık</option></Secim>)}
            {alan('Bedel türü', 'bedelTuru', <Secim {...metin('bedelTuru')}><option value="BRUT">Brüt</option><option value="NET">Net</option></Secim>, 'Sözleşmede yazan tutar stopaj öncesi mi (brüt), malikin eline geçen mi (net)?')}
            {alan('Ödeme periyodu', 'odemePeriyoduAy', <Secim id="odemePeriyoduAy" value={v.odemePeriyoduAy} onChange={(e) => d('odemePeriyoduAy', Number(e.target.value) as 1 | 3 | 6 | 12)}><option value={1}>Aylık</option><option value={3}>3 aylık</option><option value={6}>6 aylık</option><option value={12}>Yıllık</option></Secim>)}
            {alan('Ödeme zamanı', 'odemeZamani', <Secim {...metin('odemeZamani')}><option value="PESIN">Dönem başı (peşin)</option><option value="DONEM_SONU">Dönem sonu</option></Secim>)}
            {alan('Vade kuralı', 'vadeKurali', <Secim {...metin('vadeKurali')}><option value="DONEM_BASI_ARTI_GUN">Dönem başı + gün</option><option value="AYIN_GUNU">Ayın belirli günü</option><option value="DONEM_SONU_ARTI_GUN">Dönem sonu + gün</option></Secim>)}
            {alan(v.vadeKurali === 'AYIN_GUNU' ? 'Ayın günü' : 'Gün', 'vadeParametresi', <Girdi id="vadeParametresi" type="number" min={0} max={60} value={v.vadeParametresi} onChange={(e) => d('vadeParametresi', Number(e.target.value))} />)}
            {alan('Kıst dönem', 'kistYontemi', <Secim {...metin('kistYontemi')}><option value="GERCEK_GUN">Gerçek gün</option><option value="OTUZ_GUN">30 gün esası</option></Secim>)}
          </div>
        ) : null}

        {adim === 4 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alan('Artış kuralı', 'artisKurali', <Secim {...metin('artisKurali')}><option value="TUFE12">TÜFE</option><option value="YIUFE">Yİ-ÜFE</option><option value="TUFE_YIUFE_ORT">(TÜFE + Yİ-ÜFE) / 2</option><option value="SABIT">Sabit oran</option><option value="ELLE">Her dönem elle</option><option value="YOK">Artış yok</option></Secim>)}
            {alan('Değişim türü', 'artisDegisimTuru', <Secim {...metin('artisDegisimTuru')}><option value="ON_IKI_AY_ORT">12 aylık ortalama</option><option value="YILLIK">Yıllık</option></Secim>)}
            {v.artisKurali === 'SABIT' ? alan('Sabit oran (%)', 'sabitArtisOrani', <Girdi placeholder="25,00" {...metin('sabitArtisOrani')} />) : null}
            {alan('Artış periyodu (ay)', 'artisPeriyoduAy', <Girdi id="artisPeriyoduAy" type="number" min={1} max={120} value={v.artisPeriyoduAy} onChange={(e) => d('artisPeriyoduAy', Number(e.target.value))} />)}
            <p className="text-xs text-slate-500 md:col-span-2">Hangi kural seçilirse seçilsin uygulanan oran TÜFE 12 aylık ortalama değişimini aşamaz (TBK 344); ilk kira yılında artış yapılmaz.</p>
          </div>
        ) : null}

        {adim === 5 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alan('Ekonomik kod (boş = taşınmaza göre)', 'ekonomikKod', <Girdi id="ekonomikKod" placeholder="03.5.5.05" value={v.ekonomikKod ?? ''} onChange={(e) => d('ekonomikKod', e.target.value || null)} />)}
            {alan('İhale dayanağı', 'ihaleDayanagi', <Secim {...metin('ihaleDayanagi')}><option value="DT_4734_22E">4734 md. 22/e doğrudan temin</option><option value="PZ_2886_51L">2886 md. 51/l pazarlık</option><option value="DIGER">Diğer</option></Secim>)}
            {alan('Onay belgesi no', 'onayBelgesiNo', <Girdi {...metin('onayBelgesiNo')} />)}
            {alan('Onay belgesi tarihi', 'onayBelgesiTarihi', <Girdi type="date" {...metin('onayBelgesiTarihi')} />)}
            {alan('Piyasa araştırma tarihi', 'piyasaArastirmaTarihi', <Girdi type="date" {...metin('piyasaArastirmaTarihi')} />)}
            {alan('Encümen karar no (varsa)', 'encumenKararNo', <Girdi {...metin('encumenKararNo')} />)}
            {alan('Damga vergisi tahsili', 'damgaTahsil', <Secim {...metin('damgaTahsil')}><option value="ISTIHKAKTAN">İstihkaktan kesilir</option><option value="MALIK_BEYAN">Malik kendisi beyan eder</option></Secim>)}
            <div className="md:col-span-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="mb-2 font-medium">Yıllar önce başlamış bir sözleşmeyi giriyorsanız (göç)</p>
              <div className="grid gap-3 md:grid-cols-3">
                {alan('Güncel bedelin başladığı tarih', 'gecisTarihi', <Girdi type="date" {...metin('gecisTarihi')} />)}
                {alan('Güncel kira bedeli', 'gecisBedeli', <Girdi inputMode="decimal" {...metin('gecisBedeli')} />)}
                {alan('Bu tarihe kadarki taksitler ödendi', 'odenmisSayilanSonTarih', <Girdi type="date" {...metin('odenmisSayilanSonTarih')} />)}
              </div>
            </div>
            {alan('Notlar', 'notlar', <MetinAlani {...metin('notlar')} />)}
          </div>
        ) : null}

        {adim === 6 ? (
          <div className="space-y-3">
            <Dugme onClick={onizle} disabled={bekliyor}>Önizlemeyi hesapla</Dugme>
            {onizleme ? (
              <>
                {onizleme.anahtar !== anahtar ? <Uyari ton="uyari">Girdiler önizlemeden sonra değişti; güncel sonuç için önizlemeyi yeniden hesaplayın.</Uyari> : null}
                <div className="max-h-[50vh] overflow-auto rounded border border-slate-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-left">Dönem</th><th className="px-2 py-1 text-left">Vade</th><th className="px-2 py-1 text-right">Tutar</th><th className="px-2 py-1 text-left">Malik bazında brüt / stopaj / KDV / ödenecek</th></tr></thead>
                    <tbody>
                      {onizleme.satirlar.map((r) => (
                        <tr key={r.baslangic} className="border-t border-slate-100">
                          <td className="px-2 py-1">{formatTarih(r.baslangic)} – {formatTarih(r.bitis)}</td><td className="px-2 py-1">{formatTarih(r.vade)}</td>
                          <td className="sayi px-2 py-1">{formatTL(r.tutar)}</td>
                          <td className="px-2 py-1">{r.malikler.map((m) => <div key={m.kisiId}>{m.ad}: {formatTL(m.brut)} / {formatTL(m.stopaj)} / {formatTL(m.kdv)} / <strong>{formatTL(m.net)}</strong></div>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            <p className="text-xs text-slate-500">Önizleme gelecek artışları içermez; bugünkü vergi oranlarıyla hesaplanır.</p>
          </div>
        ) : null}

        <div className="flex justify-between border-t border-slate-200 pt-3">
          <Dugme onClick={() => setAdim((a) => Math.max(0, a - 1))} disabled={adim === 0}>Geri</Dugme>
          <div className="flex gap-2">
            {adim < ADIMLAR.length - 1 ? <Dugme onClick={() => setAdim((a) => a + 1)}>İleri</Dugme> : null}
            <Dugme tur="birincil" onClick={kaydet} disabled={bekliyor}>{bekliyor ? 'Kaydediliyor…' : 'Taslak olarak kaydet'}</Dugme>
          </div>
        </div>
      </div>
    </div>
  )
}
