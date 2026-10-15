import type { SozlesmeDetayi } from '@/server/sozlesme/sorgu'
import { Tablo, Td, Th } from '@/components/ui/tablo'

export function GecmisSekmesi({ s }: { s: SozlesmeDetayi }) {
  return (
    <Tablo>
      <thead><tr><Th>Zaman</Th><Th>Eylem</Th><Th>Kullanıcı</Th><Th>Ayrıntı</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {s.olaylar.map((o) => (
          <tr key={o.id}>
            <Td className="whitespace-nowrap">{o.zaman.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</Td>
            <Td>{o.eylem}</Td><Td>{o.kullaniciId ?? 'sistem'}</Td>
            <Td><details><summary className="cursor-pointer text-xs text-marka">göster</summary><pre className="max-w-xl overflow-auto text-xs">{JSON.stringify({ once: o.once, sonra: o.sonra }, null, 2)}</pre></details></Td>
          </tr>
        ))}
      </tbody>
    </Tablo>
  )
}
