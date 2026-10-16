import type { PaketDetayi } from '@/server/paket/sorgu'
import { HesapIzi } from '@/components/hesap-izi'
import { ParaMetni } from '@/components/para'
import { TarihMetni } from '@/components/tarih'
import { Kart } from '@/components/ui/kart'
import { Tablo, Td, Th } from '@/components/ui/tablo'

/** Malik bazında dağılım (K3+K4) ve kesintiler; her satırın hesap izi açılabilir (spec §6.8, §15). */
export function DagilimBolumu({ p }: { p: PaketDetayi }) {
  if (p.dagilim.length === 0 || p.toplam === null) return null
  const t = p.toplam
  return (
    <Kart baslik="Dağılım">
      <Tablo>
        <thead>
          <tr>
            <Th>Sözleşme</Th><Th>Dönem / parça</Th><Th>Malik</Th><Th>Ödeme</Th><Th>Hisse</Th>
            <Th className="text-right">Brüt</Th><Th className="text-right">KDV</Th><Th className="text-right">Stopaj</Th><Th className="text-right">Damga</Th>
            <Th className="text-right">Haciz</Th><Th className="text-right">22/A</Th><Th className="text-right">Net</Th><Th>Hesap izi</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {p.dagilim.map((d) => (
            <tr key={d.id}>
              <Td>{d.sozlesmeNo}</Td>
              <Td><TarihMetni deger={d.parcaBaslangic} /> – <TarihMetni deger={d.parcaBitis} /></Td>
              <Td>{d.kisiAdi}</Td>
              <Td>{d.odemeKisiAdi}<br /><span className="font-mono text-xs text-slate-500">{d.ibanMaskeli ?? 'IBAN yok'}</span></Td>
              <Td>{d.pay}/{d.payda}</Td>
              <Td className="text-right"><ParaMetni deger={d.brut} /></Td>
              <Td className="text-right"><ParaMetni deger={d.kdv} /></Td>
              <Td className="text-right"><ParaMetni deger={d.stopaj} /></Td>
              <Td className="text-right"><ParaMetni deger={d.damga} /></Td>
              <Td className="text-right"><ParaMetni deger={d.haciz} /></Td>
              <Td className="text-right"><ParaMetni deger={d.kesinti22a} /></Td>
              <Td className="text-right font-semibold"><ParaMetni deger={d.net} /></Td>
              <Td><HesapIzi satirlar={d.satirlar} /></Td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <Td colSpan={5}>Toplam (gider: <ParaMetni deger={t.gider} />)</Td>
            <Td className="text-right"><ParaMetni deger={t.brut} /></Td>
            <Td className="text-right"><ParaMetni deger={t.kdv} /></Td>
            <Td className="text-right"><ParaMetni deger={t.stopaj} /></Td>
            <Td className="text-right"><ParaMetni deger={t.damga} /></Td>
            <Td className="text-right"><ParaMetni deger={t.haciz} /></Td>
            <Td className="text-right"><ParaMetni deger={t.kesinti22a} /></Td>
            <Td className="text-right"><ParaMetni deger={t.net} /></Td>
            <Td />
          </tr>
        </tbody>
      </Tablo>
    </Kart>
  )
}
