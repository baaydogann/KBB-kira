/** Kuralın bağlandığı sözleşme sekmesi. Tabloda olmayan (motor dışı ya da gelecekteki) kurallar sözleşmenin ilk sekmesine gider. */
const KURAL_SEKMESI: ReadonlyMap<string, string> = new Map([
  ['H1', 'taksitler'], ['H2', 'taksitler'], ['H5_FAZLA_ODEME', 'taksitler'], ['H5', 'donemler'], ['ARTIS_HESAP_HATA', 'donemler'],
  ['DAMGA_HATA', 'damga'], ['H10', 'damga'],
])

/** Hatırlatma satırının bağlantısı: sözleşme sekmesi, ödeme paketi, raporlar (muhtasar), endeksler ya da parametreler. */
export function hatirlatmaAdresi(h: { sozlesmeId: number | null; kural: string; iliskiliTur: string; iliskiliId: string }): string | null {
  if (h.sozlesmeId !== null) {
    const sekme = KURAL_SEKMESI.get(h.kural)
    return `/sozlesmeler/${h.sozlesmeId}${sekme ? `?sekme=${sekme}` : ''}`
  }
  if (h.iliskiliTur === 'paket') return `/odeme-paketleri/${h.iliskiliId}`
  if (h.kural === 'H9') return '/raporlar'
  if (h.iliskiliTur === 'endeks') return '/endeksler'
  if (h.iliskiliTur === 'parametre') return '/yonetim/parametreler'
  return null
}
