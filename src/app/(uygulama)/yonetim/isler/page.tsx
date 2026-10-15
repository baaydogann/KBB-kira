import { kullaniciGerekli } from '@/server/auth/gerekli'
import { IS_ETIKETLERI, type IsAdi } from '@/server/isler'
import { sonCalismalar } from '@/server/isler/kayit'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { EylemFormu } from '@/components/eylem-formu'
import { isCalistirAction } from './actions'

const TON = { CALISIYOR: 'mavi', BASARILI: 'yesil', HATALI: 'kirmizi', ATLANDI: 'gri' } as const

export default async function IslerSayfasi() {
  await kullaniciGerekli()
  const liste = await sonCalismalar()
  return (
    <>
      <SayfaBasligi baslik="Zamanlanmış işler" aciklama="Worker süreci bu işleri otomatik çalıştırır. Gerekirse buradan hemen çalıştırabilirsiniz; aynı iş aynı anda iki kez çalışmaz." />
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(IS_ETIKETLERI) as IsAdi[]).map((ad) => (
            <Kart key={ad} baslik={ad}>
              <p className="mb-2 text-sm text-slate-600">{IS_ETIKETLERI[ad]}</p>
              <EylemFormu eylem={isCalistirAction} dugme="Şimdi çalıştır"><input type="hidden" name="is" value={ad} /></EylemFormu>
            </Kart>
          ))}
        </div>
        <Tablo>
          <thead><tr><Th>İş</Th><Th>Başlangıç</Th><Th>Bitiş</Th><Th>Durum</Th><Th>Özet / hata</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((c) => (
              <tr key={c.id}>
                <Td>{c.isAdi}</Td>
                <Td>{c.baslangic.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</Td>
                <Td>{c.bitis?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? '—'}</Td>
                <Td><Rozet ton={TON[c.durum]}>{c.durum}</Rozet></Td>
                <Td className="max-w-xl break-words text-xs">
                  {c.ozet}
                  {c.hata ? <span className={c.durum === 'HATALI' ? 'block text-red-700' : 'block text-amber-700'}>{c.hata}</span> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
