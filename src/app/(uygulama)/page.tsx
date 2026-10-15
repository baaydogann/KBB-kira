import { formatOran, para } from '@/core/para'
import { ayAdi } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { panoVerisi, type PanoSekmesi } from '@/server/hatirlatma/servis'
import { saglikDurumu } from '@/server/isler/kayit'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Sekmeler } from '@/components/ui/sekmeler'
import { Uyari } from '@/components/ui/uyari'
import { HatirlatmaSatiri } from '@/components/hatirlatma-satiri'

const SEKMELER: { anahtar: PanoSekmesi; etiket: string }[] = [
  { anahtar: 'bugun', etiket: 'Bugün' }, { anahtar: 'hafta', etiket: 'Bu hafta' }, { anahtar: 'gecikmis', etiket: 'Gecikmiş' },
  { anahtar: 'karar', etiket: 'Karar bekleyen' }, { anahtar: 'tumu', etiket: 'Tümü' },
]

function Kart({ etiket, deger, ton }: { etiket: string; deger: string; ton?: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{etiket}</p><p className={`text-2xl font-semibold ${ton ?? ''}`}>{deger}</p></div>
}

export default async function PanoSayfasi({ searchParams }: { searchParams: Promise<{ sekme?: string | string[] }> }) {
  await kullaniciGerekli()
  const { sekme } = await searchParams
  const [p, saglik] = await Promise.all([panoVerisi(), saglikDurumu()])
  // Bilinmeyen ya da çoklu sekme değeri varsayılana düşer: gecikmiş iş varsa o, yoksa bugün.
  const aktif: PanoSekmesi = SEKMELER.find((s) => s.anahtar === sekme)?.anahtar ?? (p.listeler.gecikmis.length ? 'gecikmis' : 'bugun')
  return (
    <>
      <SayfaBasligi baslik="Pano" />
      {saglik.length ? <div className="mb-4 space-y-1">{saglik.map((u) => <Uyari key={u} ton="hata">{u}</Uyari>)}</div> : null}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Kart etiket="Gecikmiş" deger={String(p.kartlar.gecikmis)} ton={p.kartlar.gecikmis ? 'text-red-600' : ''} />
        <Kart etiket="Bu hafta vadesi gelen" deger={String(p.kartlar.buHaftaVade)} />
        <Kart etiket="Karar bekleyen" deger={String(p.kartlar.kararBekleyen)} ton={p.kartlar.kararBekleyen ? 'text-amber-600' : ''} />
        <Kart etiket={p.kartlar.sonTufe12 ? `${ayAdi(p.kartlar.sonTufe12.ay)} TÜFE12` : 'TÜFE12'} deger={p.kartlar.sonTufe12 ? formatOran(para(p.kartlar.sonTufe12.oran)) : '—'} />
      </div>
      <Sekmeler sekmeler={SEKMELER.map((s) => ({ ...s, sayi: p.listeler[s.anahtar].length }))} aktif={aktif} temelUrl="/" />
      <ul className="mt-2 rounded-lg border border-slate-200 bg-white text-sm">
        {p.listeler[aktif].length === 0 ? <li className="px-3 py-6 text-center text-slate-500">Bu sekmede bekleyen iş yok.</li> : null}
        {p.listeler[aktif].map((h) => <HatirlatmaSatiri key={h.id} h={h} />)}
      </ul>
    </>
  )
}
