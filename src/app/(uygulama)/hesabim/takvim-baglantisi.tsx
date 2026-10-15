'use client'

import { useState, useTransition } from 'react'
import { Dugme } from '@/components/ui/dugme'
import { Uyari } from '@/components/ui/uyari'
import { takvimBaglantisiIptalAction, takvimBaglantisiUretAction } from './actions'

export function TakvimBaglantisi({ varMi }: { varMi: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [aktif, setAktif] = useState(varMi)
  const [hata, setHata] = useState<string | null>(null)
  const [bekliyor, baslat] = useTransition()
  return (
    <div className="space-y-3 text-sm">
      <p>Hatırlatmaları Outlook veya Google Takvim&apos;e &quot;internetten takvim ekle&quot; ile abone olarak görebilirsiniz. Bağlantı kişiseldir; paylaşmayın.</p>
      <p className="text-slate-600">Takvimde yalnızca sözleşme no, taşınmaz kısa adı, tarih ve tutar bulunur; kişi adı, T.C. kimlik no ve IBAN yer almaz.</p>
      <Uyari ton="bilgi">
        Her etkinliğe bir önceki gün 09:00&apos;da çalan bir alarm eklenir. iOS ve macOS Takvim bu alarmı uygular; Google Takvim ve Outlook
        abone olunan takvimlerdeki alarmları çoğunlukla yok sayar ve kendi bildirim ayarlarını kullanır. Bu uygulamalar abonelikleri de
        saatler süren bir gecikmeyle yeniler; yeni hatırlatmalar hemen görünmeyebilir.
      </Uyari>
      {hata ? <Uyari ton="hata">{hata}</Uyari> : null}
      {url ? <Uyari ton="basari"><span className="break-all font-mono">{url}</span><br />Bu adres yalnızca şimdi gösterilir; kopyalayın.</Uyari> : null}
      <div className="flex gap-2">
        <Dugme tur="birincil" disabled={bekliyor} onClick={() => baslat(async () => {
          const r = await takvimBaglantisiUretAction()
          if ('hata' in r) { setHata(r.hata); return }
          setHata(null)
          setUrl(r.url)
          setAktif(true)
        })}>
          {aktif ? 'Bağlantıyı yenile (eskisi geçersiz olur)' : 'Takvim bağlantısı oluştur'}
        </Dugme>
        {aktif ? (
          <Dugme tur="tehlike" disabled={bekliyor} onClick={() => baslat(async () => {
            const r = await takvimBaglantisiIptalAction()
            if (r) { setHata(r.hata); return }
            setHata(null)
            setUrl(null)
            setAktif(false)
          })}>İptal et</Dugme>
        ) : null}
      </div>
    </div>
  )
}
