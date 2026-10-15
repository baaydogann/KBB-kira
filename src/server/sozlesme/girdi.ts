import type { KiraDonemiGirdi } from '@/core/hesap/taksit-tutari'
import type { BedelTabani } from '@/core/tipler'
import { paraDb, tarihDb, tarihDbOpt } from '../donustur'

export function kiraDonemiGirdileri(
  rows: readonly { id: number; baslangic: Date; bitis: Date | null; bedelTutari: { toString(): string }; bedelTabani: BedelTabani }[],
): KiraDonemiGirdi[] {
  return rows.map((k) => ({
    id: String(k.id),
    baslangic: tarihDb(k.baslangic),
    bitis: tarihDbOpt(k.bitis),
    bedel: paraDb(k.bedelTutari),
    taban: k.bedelTabani,
  }))
}
