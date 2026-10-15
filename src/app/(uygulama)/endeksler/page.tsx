import type { OranSerisi } from '@/core/hesap/artis'
import { ayAdi } from '@/core/tarih'
import { kullaniciGerekli } from '@/server/auth/gerekli'
import { ORAN_SERILERI, bekleyenEndeksler, endeksTablosu } from '@/server/endeks/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { Uyari } from '@/components/ui/uyari'
import { OranMetni } from '@/components/para'
import { ElleGirisFormu, OnayFormu } from './endeks-formlari'

const SERI_ADI: Record<OranSerisi, string> = {
  TUFE_12AY_ORT: 'TÜFE 12 ay ort. (tavan)', TUFE_YILLIK: 'TÜFE yıllık', YIUFE_12AY_ORT: 'Yİ-ÜFE 12 ay ort.', YIUFE_YILLIK: 'Yİ-ÜFE yıllık',
}

export default async function EndekslerSayfasi() {
  await kullaniciGerekli()
  const [bekleyen, tablo] = await Promise.all([bekleyenEndeksler(), endeksTablosu()])
  return (
    <>
      <SayfaBasligi baslik="Endeksler" aciklama="TÜİK oranları her ayın 3'ünde yayımlanır. EVDS'ten gelen değer TÜİK bülteniyle karşılaştırılıp onaylanmadan hiçbir hesapta kullanılmaz." />
      <div className="space-y-4">
        <Kart baslik="Onay bekleyenler">
          {bekleyen.length === 0 ? <p className="text-sm text-slate-600">Onay bekleyen endeks yok.</p> : (
            <div className="space-y-3">
              {bekleyen.map((e) => (
                <div key={e.id} className="rounded border border-slate-200 p-3">
                  <p className="mb-2 text-sm">
                    <strong>{SERI_ADI[e.seri]}</strong> — {ayAdi({ yil: e.yil, ay: e.ay })}: EVDS hesabı <strong><OranMetni deger={e.deger.toString()} /></strong> ({e.evdsSeriKodu})
                  </p>
                  <OnayFormu id={e.id} />
                </div>
              ))}
            </div>
          )}
        </Kart>
        <Kart baslik="Elle giriş (EVDS'e ulaşılamadığında)">
          <Uyari ton="uyari">Elle girilen değer hemen onaylı olur ve sonradan değiştirilemez; girmeden önce TÜİK bültenini kontrol edin.</Uyari>
          <div className="mt-3">
            <ElleGirisFormu seriler={ORAN_SERILERI.map((s) => ({ deger: s, etiket: SERI_ADI[s] }))} />
          </div>
          <div className="mt-3"><Uyari ton="bilgi">EVDS çekimini hemen çalıştırmak için Yönetim → Zamanlanmış işler ekranını kullanın.</Uyari></div>
        </Kart>
        <Tablo>
          <thead><tr><Th>Ay</Th>{ORAN_SERILERI.map((s) => <Th key={s} className="text-right">{SERI_ADI[s]}</Th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {tablo.map((satir) => (
              <tr key={`${satir.ay.yil}-${satir.ay.ay}`}>
                <Td>{ayAdi(satir.ay)}</Td>
                {ORAN_SERILERI.map((s) => {
                  const k = satir.seriler[s]
                  return (
                    <Td key={s} className="text-right">
                      {k === null ? <span className="text-slate-400">—</span> : (
                        <span className="space-x-1">
                          <OranMetni deger={k.deger.toString()} />
                          {k.onayDurumu === 'ONAYLANDI' ? null : <Rozet ton="sari">onay bekliyor</Rozet>}
                        </span>
                      )}
                    </Td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
