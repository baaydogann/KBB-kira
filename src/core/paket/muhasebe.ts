import { SIFIR, formatTL, topla, type Para } from '../para'

export interface FisHesaplari {
  gider: string; vergi: string; emanet22a: string; emanetHaciz: string; banka: string
  butceGider: string; giderYansitma: string; odenekliGider: string; gonderilecekOdenek: string
}

export interface FisSatiri { kayit: number; hesap: string; aciklama: string; borc: Para; alacak: Para }

export interface FisGirdisi {
  tertipler: readonly { ekonomikKod: string; tertip: string; gider: Para }[]
  stopaj: Para; damga: Para; haciz: Para; kesinti22a: Para; net: Para
  ilkOdemeler: readonly { sozlesmeNo: string; taahhut: Para | null }[]
  hesaplar: FisHesaplari
}

/**
 * Muhasebe işlem fişi önerisi (MİBMY; spec §10.2): 1) gider / kesintiler ve banka, 2) bütçe gideri / gider yansıtma, 3) ödenekli gider /
 * gönderilecek ödenek. Tutarı sıfır olan satır yazılmaz. İlk ödemede taahhüt (920/921) kaydının varlığı not olarak hatırlatılır.
 */
export function fisOnerisi(g: FisGirdisi): { satirlar: FisSatiri[]; notlar: string[] } {
  const h = g.hesaplar
  const giderToplami = topla(g.tertipler.map((t) => t.gider))
  const borc = (kayit: number, hesap: string, aciklama: string, tutar: Para): FisSatiri => ({ kayit, hesap, aciklama, borc: tutar, alacak: SIFIR })
  const alacak = (kayit: number, hesap: string, aciklama: string, tutar: Para): FisSatiri => ({ kayit, hesap, aciklama, borc: SIFIR, alacak: tutar })
  const satirlar = [
    ...g.tertipler.map((t) => borc(1, `${h.gider}.${t.ekonomikKod}`, `Kira gideri — ${t.tertip}`, t.gider)),
    alacak(1, h.vergi, 'Gelir vergisi stopajı', g.stopaj),
    alacak(1, h.vergi, 'Damga vergisi', g.damga),
    alacak(1, h.emanet22a, '6183 md. 22/A kesintisi', g.kesinti22a),
    alacak(1, h.emanetHaciz, 'Haciz kesintisi', g.haciz),
    alacak(1, h.banka, 'Hak sahiplerine ödenecek', g.net),
    borc(2, h.butceGider, 'Bütçe giderleri', giderToplami),
    alacak(2, h.giderYansitma, 'Gider yansıtma', giderToplami),
    borc(3, h.odenekliGider, 'Ödenekli giderler', giderToplami),
    alacak(3, h.gonderilecekOdenek, 'Gönderilecek bütçe ödenekleri', giderToplami),
  ].filter((s) => !s.borc.plus(s.alacak).isZero())
  const notlar = g.ilkOdemeler.map((o) =>
    `İlk ödeme — ${o.sozlesmeNo}: sözleşme taahhüdü 920/921 hesaplarına kaydedilmiş olmalı${o.taahhut === null ? '' : ` (sözleşme bedeli, KDV hariç: ${formatTL(o.taahhut)})`}.`)
  return { satirlar, notlar }
}
