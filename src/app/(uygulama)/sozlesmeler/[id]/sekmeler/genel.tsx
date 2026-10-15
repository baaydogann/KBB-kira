import Link from 'next/link'
import type { ReactNode } from 'react'
import { tarihDb, tarihDbOpt } from '@/server/donustur'
import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { bugunIstanbul, karsilastir } from '@/core/tarih'
import { tbk347KapsamindaMi } from '@/core/tipler'
import { Kart } from '@/components/ui/kart'
import { DugmeLink } from '@/components/ui/dugme'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { ParaMetni, OranMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { aktiflestirAction, belirsizAction, feshetAction, sonlandirAction, taslakSilAction, yenileAction } from '../../actions'

const FESIH_ALANLARI: EylemAlani[] = [
  { ad: 'tarih', etiket: 'Fesih tarihi', tur: 'date', zorunlu: true },
  { ad: 'neden', etiket: 'Neden (TBK 348: yazılı bildirim)', zorunlu: true },
]

export function GenelSekmesi({ s }: { s: SozlesmeDetayi }) {
  const kimlik = <><input type="hidden" name="id" value={s.id} /><input type="hidden" name="version" value={s.version} /></>
  const yururlukte = s.durum === 'AKTIF' || s.durum === 'UZADI'
  const bitis = tarihDbOpt(s.bitis)
  const bitisGecti = bitis !== null && karsilastir(bitis, bugunIstanbul()) < 0
  // Arsa kararları (sona erdir / belirsiz süreliye çevir) yalnızca süresi dolmuş, yürürlükteki arsa kirası içindir (TBK 327); servis aynı kuralı denetler.
  const arsaKarari = yururlukte && bitisGecti && !tbk347KapsamindaMi(s.tasinmaz.tur)
  const satir = (e: string, d: ReactNode) => <div className="grid grid-cols-[14rem_1fr] gap-2 border-b border-slate-100 py-1"><span className="text-slate-500">{e}</span><span>{d}</span></div>
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Kart baslik="Künye">
        {satir('Taşınmaz', <Link href={`/tasinmazlar/${s.tasinmazId}`} className="text-marka hover:underline">{s.tasinmaz.kisaAd} ({s.tasinmaz.tur})</Link>)}
        {satir('Ekonomik kod', s.ekonomikKod)}
        {satir('Başlangıç / bitiş', <><TarihMetni deger={tarihDb(s.baslangic)} /> – <TarihMetni deger={bitis} /></>)}
        {satir('İlk kira başlangıcı', <TarihMetni deger={tarihDb(s.ilkKiraBaslangici)} />)}
        {satir('Sözleşme bedeli', <><ParaMetni deger={s.bedelTutari.toFixed(2)} /> {s.bedelTabani} {s.bedelTuru}</>)}
        {satir('Ödeme düzeni', `${s.odemePeriyoduAy} aylık, ${s.odemeZamani === 'PESIN' ? 'peşin' : 'dönem sonu'}, ${s.vadeKurali} (${s.vadeParametresi})`)}
        {satir('Artış', <>{s.artisKurali} / {s.artisDegisimTuru} / {s.artisPeriyoduAy} ay {s.sabitArtisOrani ? <OranMetni deger={s.sabitArtisOrani.toString()} /> : null}</>)}
        {satir('Damga vergisi', s.damgaTahsil === 'ISTIHKAKTAN' ? 'İstihkaktan kesilir' : 'Malik beyan eder')}
        {satir('Dayanak / onay', `${s.ihaleDayanagi} — ${s.onayBelgesiNo ?? 'onay no yok'}`)}
        {s.oncekiSozlesme ? satir('Önceki sözleşme', <Link href={`/sozlesmeler/${s.oncekiSozlesme.id}`} className="text-marka hover:underline">{s.oncekiSozlesme.sozlesmeNo}</Link>) : null}
        {s.sonrakiSozlesme ? satir('Yenileme', <Link href={`/sozlesmeler/${s.sonrakiSozlesme.id}`} className="text-marka hover:underline">{s.sonrakiSozlesme.sozlesmeNo}</Link>) : null}
        {s.fesihTarihi ? satir('Fesih', <><TarihMetni deger={tarihDb(s.fesihTarihi)} /> — {s.fesihNedeni}</>) : null}
      </Kart>
      <div className="space-y-4">
        {s.durum === 'TASLAK' ? (
          <Kart baslik="Taslak">
            <div className="space-y-3">
              <DugmeLink href={`/sozlesmeler/${s.id}/duzenle`}>Düzenle</DugmeLink>
              <EylemFormu eylem={aktiflestirAction} dugme="Aktifleştir" tur="birincil" onayMetni="Sözleşme aktifleşecek ve taksit planı oluşturulacak. Devam edilsin mi?">{kimlik}</EylemFormu>
              <EylemFormu eylem={taslakSilAction} dugme="Taslağı sil" tur="tehlike" onayMetni="Taslak kalıcı olarak silinecek.">{kimlik}</EylemFormu>
            </div>
          </Kart>
        ) : null}
        {yururlukte ? (
          <>
            {!s.sonrakiSozlesme ? <Kart baslik="Yenile"><EylemFormu eylem={yenileAction} dugme="Yenileme taslağı oluştur"><input type="hidden" name="id" value={s.id} /></EylemFormu></Kart> : null}
            <Kart baslik="Feshet">
              <EylemFormu eylem={feshetAction} dugme="Fesih kaydet" tur="tehlike" alanlar={FESIH_ALANLARI} onayMetni="Fesih tarihinden sonraki planlı taksitler iptal edilecek.">
                {kimlik}
              </EylemFormu>
            </Kart>
            {arsaKarari ? (
              <Kart baslik="Arsa: süre doldu (TBK 327)">
                <div className="space-y-3">
                  <EylemFormu eylem={belirsizAction} dugme="Kullanım sürüyor: belirsiz süreliye çevir">{kimlik}</EylemFormu>
                  <EylemFormu eylem={sonlandirAction} dugme="Kullanım bitti: sona erdi" tur="tehlike">{kimlik}</EylemFormu>
                </div>
              </Kart>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
