# ADR-001: Teknoloji yığını ve mimari yaklaşım

**Durum:** Kabul edildi
**Tarih:** 2026-10-15
**Karar verenler:** Proje sahibi (Baydoğan)

## Bağlam

Konya Büyükşehir Belediyesi'nin kiracı olduğu taşınmaz kira sözleşmeleri için takip, artış, kesinti
ve ödeme emri hazırlık uygulaması. Yüzlerce sözleşme, birkaç eşit yetkili personel, intranet.
Kritik nitelikler: hesap doğruluğu, denetlenebilirlik (Sayıştay), tarih kaçırmama. Yük düşük.
Ekip Next.js + Prisma + Postgres (`anket` projesi) ve Go (`api-go`) biliyor; Docker + GitLab CI kullanılıyor.

## Karar

**Next.js 15 tam yığın monolit + aynı imajdan ayrı `worker` süreci + PostgreSQL 17.**
Para/oran hesapları framework'ten bağımsız saf TypeScript çekirdeğinde (`src/core`), `decimal.js` ile.

## Değerlendirilen seçenekler

### A: Next.js monolit + worker (seçildi)

| Boyut | Değerlendirme |
|---|---|
| Karmaşıklık | Düşük — tek kod tabanı, tek dil |
| Maliyet | Tek imaj, iki konteyner + Postgres |
| Ölçeklenebilirlik | Bu yük için fazlasıyla yeterli |
| Ekip aşinalığı | Yüksek (`anket` ile aynı yığın) |

**Artılar:** Hızlı teslim, paylaşılan tipler (zod şemaları form + içe aktarma + API'de ortak), tek deploy.
**Eksiler:** İş mantığının server action'lara sızma riski → klasör sınırı + lint kuralı ile korunur.

### B: Go API + React SPA

**Artılar:** Güçlü tip, `shopspring/decimal`, `api-go` deneyimi.
**Eksiler:** İki kod tabanı, iki dil, DTO tekrarı; teslim ~1,5–2×; performans avantajı bu yükte değersiz.

### C: Low-code (NocoDB/Appsmith)

**Artılar:** Ekranlar günler içinde.
**Eksiler:** Hesap kuralları, kuruş dağıtımı, hesap izi, hatırlatma, OCR yine özel kod ister; test edilemez.
"Kusursuz matematik" hedefiyle çelişir. **Elendi.**

## Sonuçlar

- **Kolaylaşan:** Test (saf çekirdek), denetim (hesap anlık görüntüsü), deploy (tek imaj).
- **Zorlaşan:** Next sunucu kodunda iş mantığı yazma eğilimi; `src/core` dışına hesap yazmak yasak.
- **Yeniden bakılacak:** Belirsiz vergi kalemleri (bkz. spec §21) müşavir teyidinden sonra parametre olarak güncellenir.
- Ölçek 10×'e çıksa bile mimari değişmez; ihtiyaç olursa worker yatay çoğaltılabilir (advisory lock sayesinde).
