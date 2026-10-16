import Link from 'next/link'
import type { OneriSatiri, PaketDetayi } from '@/server/paket/sorgu'
import { EylemFormu } from '@/components/eylem-formu'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { paketTaksitBolAction, paketTaksitEkleAction, pakettenTaksitCikarAction } from '../../actions'

function PaketGizli({ p }: { p: Pick<PaketDetayi, 'id' | 'version'> }) {
  return (
    <>
      <input type="hidden" name="paketId" value={p.id} />
      <input type="hidden" name="version" value={p.version} />
    </>
  )
}

/** Paketteki taksitler; düzenlenebilir pakette böl/çıkar ve eklenebilir taksitler. */
export function TaksitlerBolumu({ p, oneriler, duzenlenebilir }: { p: PaketDetayi; oneriler: OneriSatiri[]; duzenlenebilir: boolean }) {
  return (
    <div className="space-y-4">
      <Kart baslik={`Taksitler (${p.taksitler.length})`}>
        {p.taksitler.length === 0 ? <p className="text-sm text-slate-500">Pakette taksit yok.</p> : (
          <Tablo>
            <thead><tr><Th>Sözleşme</Th><Th>Dönem</Th><Th>Vade</Th><Th>Tür</Th><Th className="text-right">Tutar</Th>{duzenlenebilir ? <Th>Böl</Th> : null}{duzenlenebilir ? <Th><span className="sr-only">İşlem</span></Th> : null}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {p.taksitler.map((t) => (
                <tr key={t.taksitId}>
                  <Td><Link href={`/sozlesmeler/${t.sozlesmeId}?sekme=taksitler`} className="text-marka hover:underline">{t.sozlesmeNo}</Link> <span className="text-xs text-slate-500">{t.kisaAd}</span></Td>
                  <Td><TarihMetni deger={t.donemBaslangic} /> – <TarihMetni deger={t.donemBitis} /></Td>
                  <Td><TarihMetni deger={t.vade} />{t.gecikmis ? <span className="ml-1"><Rozet ton="kirmizi">gecikmiş</Rozet></span> : null}</Td>
                  <Td>{t.tur}</Td>
                  <Td className="text-right"><ParaMetni deger={t.tutar} /></Td>
                  {duzenlenebilir ? (
                    <Td>
                      <EylemFormu eylem={paketTaksitBolAction} dugme={t.bolunsun ? 'Bölmeyi kaldır' : 'Gün oranında böl'} tur="hayalet" kimlikOneki={`bol-${t.taksitId}-`}>
                        <PaketGizli p={p} />
                        <input type="hidden" name="taksitId" value={t.taksitId} />
                        <input type="hidden" name="bolunsun" value={String(!t.bolunsun)} />
                        {t.bolunsun ? <Rozet ton="mavi">bölünecek</Rozet> : null}
                      </EylemFormu>
                    </Td>
                  ) : null}
                  {duzenlenebilir ? (
                    <Td>
                      <EylemFormu eylem={pakettenTaksitCikarAction} dugme="Çıkar" tur="hayalet" kimlikOneki={`cikar-${t.taksitId}-`}>
                        <PaketGizli p={p} />
                        <input type="hidden" name="taksitId" value={t.taksitId} />
                      </EylemFormu>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Tablo>
        )}
      </Kart>
      {duzenlenebilir ? (
        <Kart baslik="Eklenebilir taksitler">
          {oneriler.length === 0 ? <p className="text-sm text-slate-500">Bu birimde pakete eklenebilecek başka planlı taksit yok.</p> : (
            <EylemFormu eylem={paketTaksitEkleAction} dugme="Seçilenleri ekle" kimlikOneki="ekle-">
              <PaketGizli p={p} />
              <p className="text-xs text-slate-600">Gecikmiş taksitler sistem dışında ödenmiş olabilir; eklemeden önce kontrol edin.</p>
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {oneriler.map((o) => (
                  <li key={o.taksitId}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="taksitId" value={o.taksitId} />
                      <span>{o.sozlesmeNo} — <TarihMetni deger={o.donemBaslangic} /> – <TarihMetni deger={o.donemBitis} /> — vade <TarihMetni deger={o.vade} /> — <ParaMetni deger={o.tutar} /></span>
                      {o.gecikmis ? <Rozet ton="kirmizi">gecikmiş</Rozet> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </EylemFormu>
          )}
        </Kart>
      ) : null}
    </div>
  )
}
