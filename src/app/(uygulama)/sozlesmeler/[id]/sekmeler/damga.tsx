import { prisma } from '@/server/db'
import { sozlesmeDamgaKayitlari } from '@/server/damga/servis'
import { BelgeYukle } from '@/components/belge-yukle'
import { EylemFormu, type EylemAlani } from '@/components/eylem-formu'
import { HesapIzi } from '@/components/hesap-izi'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { damgaKaydiEkleAction, damgaKaydiIptalAction, damgaMakbuzBaglaAction } from '../../actions'

const OLAY: Record<string, string> = { ILK: 'İlk (sözleşme)', YAZILI_ARTIS: 'Yazılı artış', YAZILI_UZATMA: 'Yazılı uzatma' }
const TAHSIL: Record<string, string> = { ISTIHKAKTAN: 'İstihkaktan kesinti', MALIK_BEYAN: 'Malik beyanı' }

const EKLE_ALANLARI: EylemAlani[] = [
  { ad: 'olay', etiket: 'Olay', tur: 'select', secenekler: [{ deger: 'YAZILI_ARTIS', etiket: 'Yazılı artış (ek protokol)' }, { deger: 'YAZILI_UZATMA', etiket: 'Yazılı uzatma (ek protokol)' }, { deger: 'ILK', etiket: 'İlk (sözleşme; matrah otomatik)' }] },
  { ad: 'olayTarihi', etiket: 'Olay tarihi', tur: 'date', zorunlu: true },
  { ad: 'matrah', etiket: 'Matrah', ondalik: true, yerTutucu: '24.000,00', ipucu: 'Yazılı artışta artan tutar × kalan süre; uzatmada uzatılan sürenin kirası. ILK için boş bırakın.' },
  { ad: 'tahsil', etiket: 'Tahsil', tur: 'select', secenekler: [{ deger: 'ISTIHKAKTAN', etiket: 'İstihkaktan kesinti' }, { deger: 'MALIK_BEYAN', etiket: 'Malik beyanı' }] },
]
const IPTAL_ALANLARI: EylemAlani[] = [{ ad: 'neden', etiket: 'İptal nedeni', zorunlu: true }]

/** Spec §6.7: damga kayıtları, malik payları ve kalan kesinti; malik beyanında makbuz takibi (H10). */
export async function DamgaSekmesi({ sozlesmeId, taslak }: { sozlesmeId: number; taslak: boolean }) {
  const [kayitlar, makbuzlar] = await Promise.all([
    sozlesmeDamgaKayitlari(sozlesmeId),
    prisma.belge.findMany({ where: { sahipTur: 'sozlesme', sahipId: sozlesmeId, belgeTuru: 'DAMGA_MAKBUZU' }, orderBy: { id: 'desc' }, select: { id: true, dosyaAdi: true } }),
  ])
  const makbuzSecenekleri = makbuzlar.map((b) => ({ deger: String(b.id), etiket: b.dosyaAdi }))
  return (
    <div className="space-y-4">
      <Kart baslik="Damga vergisi kayıtları">
        {kayitlar.length === 0 ? <p className="text-sm text-slate-500">Damga kaydı yok.{taslak ? ' Sözleşme aktifleştirilince ILK kaydı açılır.' : ''}</p> : (
          <Tablo>
            <thead><tr><Th>Olay</Th><Th>Tarih</Th><Th className="text-right">Matrah</Th><Th>Oran</Th><Th className="text-right">Tutar</Th><Th>Tahsil</Th><Th className="text-right">Kalan kesinti</Th><Th>Makbuz</Th><Th>Durum</Th><Th>Hesap izi</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {kayitlar.map((d) => (
                <tr key={d.id} className={d.iptal ? 'text-slate-400 line-through' : ''}>
                  <Td>{OLAY[d.olay] ?? d.olay}</Td>
                  <Td><TarihMetni deger={d.olayTarihi} /></Td>
                  <Td className="text-right"><ParaMetni deger={d.matrah} /></Td>
                  <Td>binde {d.oranBinde.replace('.', ',')}</Td>
                  <Td className="text-right"><ParaMetni deger={d.tutar} /></Td>
                  <Td>{TAHSIL[d.tahsil] ?? d.tahsil}</Td>
                  <Td className="text-right">{d.tahsil === 'ISTIHKAKTAN' ? <ParaMetni deger={d.kalan} /> : '—'}</Td>
                  <Td>{d.makbuzBelgeId === null ? (d.tahsil === 'MALIK_BEYAN' && !d.iptal ? <Rozet ton="sari">bekleniyor</Rozet> : '—') : <a href={`/api/belgeler/${d.makbuzBelgeId}`} target="_blank" rel="noreferrer" className="text-marka hover:underline">Aç</a>}</Td>
                  <Td>{d.iptal ? <Rozet>iptal</Rozet> : <Rozet ton="yesil">geçerli</Rozet>}</Td>
                  <Td>
                    <HesapIzi satirlar={d.satirlar} />
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-marka">Malik payları</summary>
                      <ul className="mt-1 space-y-0.5">{d.paylar.map((p) => <li key={p.kisiId}>{p.ad}: <ParaMetni deger={p.tutar} />{d.tahsil === 'ISTIHKAKTAN' ? <> (kalan <ParaMetni deger={p.kalan} />)</> : null}</li>)}</ul>
                    </details>
                    {d.iptal ? null : (
                      <div className="mt-1 grid gap-1">
                        {makbuzSecenekleri.length > 0 ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-marka">Makbuz bağla</summary>
                            <EylemFormu eylem={damgaMakbuzBaglaAction} dugme="Bağla" alanlar={[{ ad: 'belgeId', etiket: 'Makbuz', tur: 'select', secenekler: makbuzSecenekleri }]} kimlikOneki={`makbuz-${d.id}-`}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="version" value={d.version} />
                              <input type="hidden" name="sozlesmeId" value={sozlesmeId} />
                            </EylemFormu>
                          </details>
                        ) : null}
                        <details className="text-xs">
                          <summary className="cursor-pointer text-marka">İptal et</summary>
                          <EylemFormu eylem={damgaKaydiIptalAction} dugme="Kaydı iptal et" tur="tehlike" alanlar={IPTAL_ALANLARI} kimlikOneki={`damga-iptal-${d.id}-`}>
                            <input type="hidden" name="id" value={d.id} />
                            <input type="hidden" name="version" value={d.version} />
                            <input type="hidden" name="sozlesmeId" value={sozlesmeId} />
                          </EylemFormu>
                        </details>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tablo>
        )}
      </Kart>
      {taslak ? null : (
        <Kart baslik="Damga kaydı ekle">
          <div className="max-w-md">
            <EylemFormu eylem={damgaKaydiEkleAction} dugme="Kaydet" tur="birincil" alanlar={EKLE_ALANLARI} kimlikOneki="damga-yeni-">
              <input type="hidden" name="sozlesmeId" value={sozlesmeId} />
            </EylemFormu>
          </div>
        </Kart>
      )}
      <Kart baslik="Damga makbuzu yükle">
        <p className="mb-2 text-sm text-slate-600">Malik beyanında ödenen damga vergisinin makbuzunu yükleyin; ardından ilgili kayda bağlayın.</p>
        <BelgeYukle sahipTur="sozlesme" sahipId={sozlesmeId} belgeTuru="DAMGA_MAKBUZU" />
      </Kart>
    </div>
  )
}
