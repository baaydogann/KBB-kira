import type { HesapSatiri } from '@/core/hesap/goruntu'
import { ayAdi, bugunIstanbul } from '@/core/tarih'
import { artisIcinYururluk, ilkDonemArtisBekliyorMu } from '@/server/artis/servis'
import { tarihDbOpt } from '@/server/donustur'
import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Kart } from '@/components/ui/kart'
import { Rozet, type RozetTonu } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { HesapIzi } from '@/components/hesap-izi'
import { OranMetni, ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { artisElleOranAction, artislariSimdiHesaplaAction, artisOnaylaAction, kiraBedeliDegistirAction } from '../../actions'

const TON: Record<string, RozetTonu> = { BEKLEMEDE: 'sari', HESAPLANDI: 'mavi', ONAYLANDI: 'yesil', IPTAL: 'gri' }

const ELLE_ORAN_ALANLARI: EylemAlani[] = [
  { ad: 'oran', etiket: 'Oran (%)', yerTutucu: '25,00', ondalik: true, zorunlu: true },
  { ad: 'gerekce', etiket: 'Gerekçe', yerTutucu: 'Protokol tarihi vb.', zorunlu: true },
]

/** `ufukGun`: ARTIS_HESAP_UFUK_GUN parametresi (artış tarihine kaç gün kala günlük işin hesapladığı); tanımsızsa null. */
export function DonemlerSekmesi({ s, ufukGun }: { s: SozlesmeDetayi; ufukGun: number | null }) {
  const yururlukte = s.durum === 'AKTIF' || s.durum === 'UZADI'
  // Artış hesabı, elle oran ve onay ileri tarihli fesih/sona ermede de etkin bitişe kadar yapılır (bedel değişikliği yapılmaz).
  const artisYururlukte = artisIcinYururluk(s, bugunIstanbul()) !== null
  // Yeni kira dönemi açılınca, o tarihte ya da öncesinde başlayan onaysız artışlar bir daha onaylanamaz (sıra kuralı). İstisna: yenilemenin
  // ayarlanmamış ILK dönemi kendi başlangıcındaki artışla onaylanır (dönemin bedeli değişir).
  const sonKd = s.kiraDonemleri.at(-1)
  const sonKiraBaslangici = sonKd?.baslangic.getTime() ?? 0
  const ilkDonemArtisi = ilkDonemArtisBekliyorMu(s, sonKd)
  const bedelAlanlari: EylemAlani[] = [
    { ad: 'baslangic', etiket: 'Başlangıç', tur: 'date', zorunlu: true },
    { ad: 'bedel', etiket: 'Yeni bedel', ondalik: true, zorunlu: true, ipucu: s.bedelTabani === 'AYLIK' ? 'Aylık bedel' : 'Yıllık bedel' },
    {
      ad: 'kaynak', etiket: 'Kaynak', tur: 'select',
      secenekler: [{ deger: 'TESPIT', etiket: 'Tespit kararı (TBK 344/3)' }, { deger: 'ANLASMA', etiket: 'Yazılı anlaşma' }, { deger: 'ELLE', etiket: 'Düzeltme' }],
    },
    { ad: 'aciklama', etiket: 'Dayanak', yerTutucu: 'Karar no / protokol', zorunlu: true },
  ]
  return (
    <div className="space-y-4">
      <Kart baslik="Kira dönemleri">
        <Tablo>
          <thead><tr><Th>Başlangıç</Th><Th>Bitiş</Th><Th className="text-right">Bedel</Th><Th>Taban</Th><Th>Kaynak</Th><Th>Açıklama</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {s.kiraDonemleri.map((k) => (
              <tr key={k.id}>
                <Td><TarihMetni deger={tarihDbOpt(k.baslangic)} /></Td><Td><TarihMetni deger={tarihDbOpt(k.bitis)} /></Td>
                <Td className="text-right"><ParaMetni deger={k.bedelTutari.toFixed(2)} /></Td><Td>{k.bedelTabani}</Td><Td>{k.kaynak}</Td><Td>{k.aciklama ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Tablo>
      </Kart>

      <Kart baslik="Artış hesapları" eylemler={artisYururlukte && s.artisKurali !== 'YOK' ? (
        <EylemFormu eylem={artislariSimdiHesaplaAction} dugme="Şimdi hesapla"><input type="hidden" name="id" value={s.id} /></EylemFormu>
      ) : null}>
        {s.artislar.length === 0 ? <p className="text-sm text-slate-600">Henüz artış hesabı yok. Sıradaki artış tarihine {ufukGun === null ? 'yaklaşınca' : `${ufukGun} gün kala`} günlük işle hesaplanır.</p> : (
          <Tablo>
            <thead><tr><Th>Dönem</Th><Th>Referans ay</Th><Th className="text-right">Tavan</Th><Th className="text-right">Sözleşme</Th><Th className="text-right">Uygulanan</Th><Th className="text-right">Eski → yeni</Th><Th>Durum</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {s.artislar.map((a) => {
                const gerekce = (a.gerekce ?? {}) as { satirlar?: HesapSatiri[]; neden?: string; eksikSeriler?: string[] }
                const acik = (a.durum === 'BEKLEMEDE' || a.durum === 'HESAPLANDI') && artisYururlukte
                const gecersiz = acik && a.donemBaslangic.getTime() <= sonKiraBaslangici && !(ilkDonemArtisi && a.donemBaslangic.getTime() === sonKiraBaslangici)
                return (
                  <tr key={a.id}>
                    <Td><TarihMetni deger={tarihDbOpt(a.donemBaslangic)} /></Td>
                    <Td>{ayAdi({ yil: a.referansYil, ay: a.referansAy })}</Td>
                    <Td className="text-right"><OranMetni deger={a.tavan?.toString() ?? null} /></Td>
                    <Td className="text-right"><OranMetni deger={a.sozlesmeOrani?.toString() ?? null} /></Td>
                    <Td className="text-right"><OranMetni deger={a.uygulananOran?.toString() ?? null} /></Td>
                    <Td className="text-right"><ParaMetni deger={a.eskiBedel.toFixed(2)} /> → {a.yeniBedel ? <ParaMetni deger={a.yeniBedel.toFixed(2)} /> : '—'}</Td>
                    <Td>
                      <Rozet ton={TON[a.durum] ?? 'gri'}>{a.durum}</Rozet>
                      {gerekce.neden === 'ENDEKS_YOK' ? <div className="text-xs text-amber-700">Onaylı endeks bekleniyor: {gerekce.eksikSeriler?.join(', ')}</div> : null}
                      {gerekce.neden === 'ELLE_ORAN_YOK' ? <div className="text-xs text-amber-700">Elle oran girilmeli</div> : null}
                      {gecersiz ? <div className="text-xs text-slate-500">Sonraki kira dönemi açıldığından artık onaylanamaz.</div> : null}
                    </Td>
                    <Td className="space-y-2">
                      <HesapIzi satirlar={gerekce.satirlar ?? []} />
                      {a.durum === 'HESAPLANDI' && acik && !gecersiz ? (
                        <EylemFormu eylem={artisOnaylaAction} dugme="Onayla" tur="birincil" onayMetni="Yeni kira dönemi açılacak ve planlı taksitler yeni bedelle yeniden hesaplanacak.">
                          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="version" value={a.version} /><input type="hidden" name="sozlesmeId" value={s.id} />
                        </EylemFormu>
                      ) : null}
                      {a.durum === 'BEKLEMEDE' && acik && !gecersiz && s.artisKurali === 'ELLE' ? (
                        <EylemFormu eylem={artisElleOranAction} dugme="Oranı kaydet" alanlar={ELLE_ORAN_ALANLARI}>
                          <input type="hidden" name="id" value={a.id} /><input type="hidden" name="version" value={a.version} /><input type="hidden" name="sozlesmeId" value={s.id} />
                        </EylemFormu>
                      ) : null}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Tablo>
        )}
      </Kart>

      {yururlukte ? (
        <Kart baslik="Kira bedelini değiştir (tespit kararı, anlaşma, düzeltme)">
          <div className="max-w-md">
            <EylemFormu eylem={kiraBedeliDegistirAction} dugme="Yeni kira dönemi aç" alanlar={bedelAlanlari} onayMetni="Bu tarihten itibaren yeni bedel uygulanacak; ödeme sürecindeki taksitlerde fazla ödeme çıkarsa hatırlatma açılır.">
              <input type="hidden" name="id" value={s.id} /><input type="hidden" name="version" value={s.version} />
            </EylemFormu>
          </div>
        </Kart>
      ) : null}
    </div>
  )
}
