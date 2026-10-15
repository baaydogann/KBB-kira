'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Secim } from './ui/alan'

const TURLER: [string, string][] = [
  ['SOZLESME', 'Sözleşme'], ['TAPU', 'Tapu'], ['ONAY_BELGESI', 'Onay belgesi'], ['PIYASA_ARASTIRMA', 'Piyasa araştırma tutanağı'],
  ['EK_PROTOKOL', 'Ek protokol'], ['MAHKEME_KARARI', 'Mahkeme kararı'], ['DIGER', 'Diğer'],
]

export function BelgeYukle({ sahipTur, sahipId, belgeTuru, tamam }: { sahipTur: 'sozlesme' | 'tasinmaz' | 'kisi' | 'gecici'; sahipId: number; belgeTuru?: string; tamam?: (id: number) => void }) {
  const router = useRouter()
  const [tur, setTur] = useState(belgeTuru ?? 'SOZLESME')
  const [durum, setDurum] = useState<string | null>(null)
  async function yukle(dosya: File) {
    setDurum('Yükleniyor…')
    const f = new FormData()
    f.set('dosya', dosya)
    f.set('sahipTur', sahipTur)
    f.set('sahipId', String(sahipId))
    f.set('belgeTuru', tur)
    try {
      const r = await fetch('/api/belgeler', { method: 'POST', body: f })
      // Hata yanıtı JSON olmayabilir (ör. ters vekilin sayfası); çözülemezse genel iletiye düşülür.
      const j = (await r.json().catch(() => ({}))) as { id?: number; hata?: string }
      if (!r.ok || j.id === undefined) {
        setDurum(j.hata ?? 'Yükleme başarısız.')
        return
      }
      setDurum('Yüklendi.')
      if (tamam) tamam(j.id)
      else router.refresh()
    } catch {
      setDurum('Yükleme başarısız; bağlantıyı denetleyip tekrar deneyin.')
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {belgeTuru ? null : <Secim value={tur} onChange={(e) => setTur(e.target.value)} className="w-56" aria-label="Belge türü">{TURLER.map(([d, e]) => <option key={d} value={d}>{e}</option>)}</Secim>}
      <input type="file" accept="application/pdf" aria-label="PDF seç" onChange={(e) => {
        const girdi = e.currentTarget
        const d = girdi.files?.[0]
        if (d) void yukle(d).finally(() => { girdi.value = '' })
      }} />
      {durum ? <span role="status" className="text-slate-600">{durum}</span> : null}
    </div>
  )
}
