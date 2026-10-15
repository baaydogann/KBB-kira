# KBB Kira Takip Sistemi — Tasarım Dokümanı

**Tarih:** 2026-10-15 · **Durum:** Kullanıcı incelemesinde
**İlgili:** [ADR-001](../../adr/ADR-001-teknoloji-yigini.md) ·
[Vergi araştırması](../../arastirma/01-vergi.md) ·
[Kira hukuku ve endeks](../../arastirma/02-kira-hukuku-ve-endeks.md) ·
[Kamu muhasebesi](../../arastirma/03-kamu-muhasebe.md)

---

## 1. Amaç ve başarı ölçütleri

Konya Büyükşehir Belediyesi (KBB) **kiracı** konumundadır: vatandaşlardan ve şirketlerden **taşınmaz** kiralar.
Personel bu sözleşmelerin süre, ödeme, artış ve kesinti takibinde zorlanmaktadır.

Uygulamanın amacı:
- Sözleşme, taşınmaz ve malik (hak sahibi) bilgilerini tek yerde tutmak.
- Ödeme takvimini, kira artışlarını ve vergi kesintilerini mevzuata uygun ve **kuruşu kuruşuna** hesaplamak.
- Ödeme emrini hazırlamak: hesap, föy, ek listesi ve Excel. Asıl ödeme emri mevcut muhasebe yazılımında kesilir.
- Hiçbir yasal ya da sözleşmesel tarihi kaçırmamak için hatırlatma üretmek.

**Başarı ölçütleri**
1. Hiçbir ödeme, artış, yenileme ya da fesih bildirimi tarihi kaçmaz. Hepsi panoda ve `.ics` takviminde yer alır.
2. Her tutar yeniden üretilebilir ve gerekçelidir: hangi kural, hangi oran, hangi endeks, hangi yuvarlama kullanıldı.
3. Hesap çekirdeğinde para tipi olarak hiçbir yerde `Number` (kayan nokta) kullanılmaz. Özellik testleri, binlerce rastgele senaryoda toplam korunumunu kanıtlar.
4. Ödeme emri hazırlık föyü ve ekleri tek işlemle çıkar.

## 2. Kapsam

**Dahil (fazlara göre)**

| Faz | İçerik |
|---|---|
| F1 Çekirdek | Auth, kullanıcılar, taşınmaz/kişi/IBAN/sözleşme/malik, hesap çekirdeği, ödeme takvimi, artış motoru, endeks (EVDS + onay), hatırlatma motoru, pano, `.ics`, parametreler, tatiller, audit, belge yükleme |
| F2 Ödeme | Ödeme paketi akışı, 22/A sorgu kaydı, haciz, damga, föy/fiş/harcama pusulası/Excel çıktıları, dönemsel raporlar, denetim dosyası |
| F3 Genişleme | OCR + kural tabanlı alan önerisi, Excel içe aktarma, DOCX yazı şablonları, bütçe projeksiyonu |

Her faz kendi uygulama planını alır. Plan sırası F1 → F2 → F3'tür. Bir faz bitmeden sonraki fazın planı yazılmaz.

**Kapsam dışı (YAGNI):** taşıt ve menkul kiralama, e-posta/SMS bildirimleri, rol/yetki sistemi, EBYS ve muhasebe yazılımı API entegrasyonu, LLM/bulut yapay zekâ, mobil uygulama, çoklu kurum, belediyenin kiraya verdiği taşınmazlar.

## 3. Kullanıcılar ve kısıtlar

- Kullanıcılar KBB personelidir; **hepsi eşit yetkilidir** (rol yok). Kullanıcı ekleme ve pasifleştirme dahil her işlemi herkes yapabilir; her işlem audit'e yazılır.
- Dört göz kontrolü **yoktur**. Kesinleştirmeyi hazırlayan kişi yapar; kim, ne zaman ve neyi değiştirdi audit'te durur.
- Uygulama intranette çalışır. Sunucunun EVDS'e (internet) çıkışı vardır.
- Veritabanı PostgreSQL 17, saat dilimi Europe/Istanbul.
- KVKK: kişisel veri (TCKN, IBAN, adres) kurum dışına çıkmaz. OCR yereldir, LLM yoktur.

## 4. Mimari

Ayrıntılar [ADR-001](../../adr/ADR-001-teknoloji-yigini.md)'de.

```
┌────────────── Docker imajı (tek) ──────────────┐
│  web (Next.js 15)          worker (Node)       │
│   src/app  → UI/route       zamanlayıcı (croner)│
│   src/server → servisler ◄──┘  işler           │
│   src/core  → saf domain (hesap, takvim, kural)│
└──────────────┬──────────────────────┬──────────┘
               │                      │
         PostgreSQL 17          belgeler volume
                                (PDF, sha256)
        EVDS3 (TCMB) ◄── worker (HTTPS, `key` header)
```

**Katman kuralları** (ESLint `import/no-restricted-paths` ile zorunlu)
- `src/core` hiçbir I/O yapmaz. `next`, `@prisma/*` ve `src/server` import edemez. Girdi alır, `Result` döner.
- `src/server` içinde repository'ler (Prisma) ve servisler (use case, transaction sınırı) bulunur. Hesap yapmaz, `core`'u çağırır.
- `src/app` yalnızca UI, route ve server action içerir; server action'lar ince tutulur ve servis çağırır.
- `worker/` zamanlayıcı giriş noktasıdır; `src/server` servislerini çağırır.
- `src/core` ve `src/server/para` içinde `parseFloat`, `Number(`, `toFixed`, `Math.round` ve `+`'nın sayısal kullanımı lint ile yasaktır. Para işlemleri yalnızca `Para` yardımcıları üzerinden yapılır.

**Teknolojiler:** Node 22, pnpm, Next.js 15, React 19, TypeScript, Prisma 6, PostgreSQL 17, zod 4, decimal.js, @node-rs/argon2, Tailwind 4, shadcn/ui (Radix), TanStack Table, croner, exceljs, puppeteer-core + chromium (PDF), docxtemplater + pizzip (DOCX), pdfjs-dist (görüntüleyici), tesseract-ocr + tesseract-ocr-tur + poppler-utils (CLI), vitest, fast-check, Stryker, Playwright.

## 5. Veri modeli

Tablo ve alan adları Türkçe ve snake_case'tir. Tüm tablolarda `id` (bigserial), `olusturma_zamani`, `guncelleme_zamani` alanları bulunur; değiştirilebilir tablolarda ayrıca `version int` (iyimser kilit) vardır.

**Tipler:** para `NUMERIC(18,2)`, oran (yüzde) `NUMERIC(9,4)`, endeks değeri `NUMERIC(14,4)`, tarih `DATE`, an `TIMESTAMPTZ`, hisse `pay INT` + `payda INT`.

### 5.1 Ana varlıklar

**`kullanici`**: `kullanici_adi` (unique), `ad_soyad`, `sifre_hash` (argon2id), `aktif`, `hatali_giris_sayisi`, `kilit_bitis`, `son_giris`, `ics_token_hash`.

**`oturum`**: `kullanici_id`, `token_hash` (sha256, unique), `son_aktivite`, `bitis`, `ip`, `user_agent`.

**`birim`** (harcama birimi): `ad`, `kurumsal_kod`, `fonksiyonel_kod`, `finans_kodu`, `gerceklestirme_gorevlisi`, `harcama_yetkilisi`, `aktif`.

**`tasinmaz`**
- Tür: `tur` (BINA | ISYERI | ARSA | DEPO | KONUT).
- Konum: `kisa_ad`, `adres`, `il`, `ilce`, `mahalle`, `ada`, `parsel`, `bagimsiz_bolum`, `tapu_bilgisi`, `m2`.
- Kullanım: `kullanan_birim_id`, `kullanim_amaci` (HIZMET_BINASI | LOJMAN | DEPO | OTOPARK | SOSYAL_TESIS | DIGER).
- `notlar`.

**`kisi`** (malik / hak sahibi / vekil)
- Kimlik: `tip` (GERCEK | TUZEL), `tckn` (gerçek kişide zorunlu, checksum doğrulamalı), `vkn` (tüzelde zorunlu, checksum doğrulamalı), `ad`, `soyad`, `unvan`.
- Vergi: `vergi_dairesi`, `vergi_statusu` (§6.6).
- İletişim: `telefon`, `adres`.

**`iban`**: `kisi_id`, `iban` (TR + 24 hane, mod-97 doğrulamalı, boşluksuz saklanır), `banka_adi`, `aktif`.

**`sozlesme`**
- Kimlik ve bağlantılar: `sozlesme_no`, `tasinmaz_id`, `birim_id`, `ekonomik_kod` (§10.3 eşlemesinden varsayılan gelir, değiştirilebilir).
- Tarihler: `imza_tarihi`, `baslangic`, `bitis` (NULL = belirsiz süreli), `ilk_kira_baslangici` (yenileme zincirinin ilk başlangıcı; 5 ve 10 yıllık sayaçlar bu tarihten işler), `onceki_sozlesme_id` (yenileme zinciri).
- Bedel: `bedel_tutari`, `bedel_tabani` (AYLIK | YILLIK), `bedel_turu` (BRUT | NET; varsayılan BRUT).
- Ödeme düzeni: `odeme_periyodu_ay` (1 | 3 | 6 | 12), `odeme_zamani` (PESIN | DONEM_SONU), `vade_kurali` (§7.2), `vade_parametresi` (int).
- Artış: `artis_kurali` (TUFE12 | YIUFE | TUFE_YIUFE_ORT | SABIT | YOK | ELLE), `artis_degisim_turu` (ON_IKI_AY_ORT | YILLIK; endeks bazlı kurallarda), `sabit_artis_orani`, `artis_periyodu_ay` (varsayılan 12).
- Kıst dönem: `kist_yontemi` (GERCEK_GUN | OTUZ_GUN; varsayılan GERCEK_GUN).
- Damga: `damga_tahsil` (ISTIHKAKTAN | MALIK_BEYAN; varsayılan ISTIHKAKTAN).
- Dayanak: `ihale_dayanagi` (4734_22E | 2886_51L | DIGER), `onay_belgesi_no`, `onay_belgesi_tarihi`, `piyasa_arastirma_tarihi`, `encumen_karar_no` (opsiyonel).
- Durum: `durum` (TASLAK | AKTIF | UZADI | FESHEDILDI | SONA_ERDI), `fesih_tarihi`, `fesih_nedeni`, `notlar`.

**`sozlesme_malik`**: `sozlesme_id`, `kisi_id`, `pay`, `payda`, `iban_id`, `vekil_kisi_id` (opsiyonel; vekil varsa ödeme vekilin IBAN'ına gider), `gecerlilik_baslangic`, `gecerlilik_bitis` (NULL = açık).
- **Değişmez kural:** Her tarih için o tarihte geçerli kayıtların Σ pay/payda = 1 olmalıdır. Hesap rasyonel sayılarla, ortak payda çapraz çarpımıyla yapılır. Kural servis katmanında her kayıtta, ayrıca DB'de deferred constraint trigger ile denetlenir.
- `0 < pay ≤ payda` olmalıdır.

**`kira_donemi`**: `sozlesme_id`, `baslangic`, `bitis`, `bedel_tutari`, `bedel_tabani`, `kaynak` (ILK | ARTIS | TESPIT | ANLASMA | ELLE), `artis_hesabi_id`, `aciklama`. Aynı sözleşmede aralıklar çakışmaz (exclusion constraint, `daterange`).

**`artis_hesabi`**
- Dönem ve endeks: `sozlesme_id`, `donem_baslangic`, `referans_yil`, `referans_ay`, `tufe12` (tavan), `sozlesme_orani`.
- Sonuç: `uygulanan_oran`, `eski_bedel`, `yeni_bedel`, `gerekce` (jsonb).
- Durum: `durum` (BEKLEMEDE | HESAPLANDI | ONAYLANDI | IPTAL), `onaylayan_id`, `onay_zamani`.

**`taksit`**
- Dönem: `sozlesme_id`, `tur` (NORMAL | FARK | KIST), `donem_baslangic`, `donem_bitis`, `vade_tarihi`.
- Tutar: `brut_tutar`, `hesap_goruntusu` (jsonb, §6.8).
- Durum: `durum` (PLANLANDI | PAKETTE | ODEME_EMRINDE | ODENDI | IPTAL), `ana_taksit_id` (FARK türü için).
- Benzersizlik: `(sozlesme_id, tur, donem_baslangic)`.

**`taksit_dagilim`** (paket hesaplanınca oluşur)
- Kimlik: `taksit_id`, `paket_id`, `kisi_id`, `odeme_kisi_id` (vekil ise farklı olur), `iban_id`, `pay`, `payda`.
- Tutarlar: `brut`, `kdv`, `stopaj`, `stopaj_orani`, `damga_kesintisi`, `haciz_kesintisi`, `kesinti_22a`, `net`.
- `CHECK (net >= 0)` ve `CHECK (brut + kdv - stopaj - damga_kesintisi - haciz_kesintisi - kesinti_22a = net)`.

### 5.2 Ödeme ve vergi varlıkları

**`odeme_paketi`**
- Tanım: `birim_id`, `ad`, `vade_baslangic`, `vade_bitis`, `durum` (TASLAK | HESAPLANDI | KESINLESTI | ODEME_EMRINDE | ODENDI | IPTAL).
- Muhasebe bilgisi: `muhasebe_odeme_emri_no`, `muhasebe_odeme_emri_tarihi`, `odeme_tarihi`.
- İzlenebilirlik: `kesinlestiren_id`, `kesinlesme_zamani`, `iptal_nedeni`.
- Bir taksit aynı anda en fazla bir aktif (iptal edilmemiş) pakette bulunabilir: partial unique index ile sağlanır.

**`borc_sorgu`** (22/A): `kisi_id`, `sorgu_tarihi`, `gecerlilik_bitis` (= sorgu_tarihi + 15 gün, parametre), `borc_var`, `borc_tutari`, `vergi_dairesi`, `belge_no`, `belge_id`.

**`haciz`**: `kisi_id`, `alacakli`, `dosya_no`, `teblig_tarihi`, `toplam_tutar`, `kalan_tutar`, `durum` (AKTIF | KAPANDI).

**`damga_kaydi`**: `sozlesme_id`, `olay` (ILK | YAZILI_ARTIS | YAZILI_UZATMA), `matrah`, `oran`, `azami`, `tutar`, `tahsil` (ISTIHKAKTAN | MALIK_BEYAN), `kalan_kesinti`, `makbuz_belge_id`.

### 5.3 Destek varlıkları

**`endeks_degeri`**
- Seri ve dönem: `seri` (TUFE_ENDEKS | TUFE_12AY_ORT | TUFE_YILLIK | YIUFE_ENDEKS | YIUFE_12AY_ORT | YIUFE_YILLIK), `yil`, `ay`.
- Değer: `deger`, `baz_yili`, `kaynak` (EVDS | ELLE), `evds_degeri` (karşılaştırma için).
- Onay: `onay_durumu` (BEKLIYOR | ONAYLANDI), `onaylayan_id`, `onay_zamani`.
- Benzersizlik: `(seri, yil, ay)`.

**`parametre`**: `anahtar`, `deger` (text; tip bilgisi anahtarın şemasında), `yururluk_baslangic`, `yururluk_bitis`, `mevzuat_dayanagi`, `aciklama`. Aynı anahtarın yürürlük aralıkları çakışmaz.

**`tatil`**: `tarih`, `ad`, `yarim_gun` (bool).

**`hatirlatma`**
- Kimlik: `anahtar` (unique), `tur`, `iliskili_tur`, `iliskili_id`.
- İçerik ve zaman: `baslik`, `aciklama`, `hedef_tarih`, `gorunur_tarih`, `oncelik` (KRITIK | YUKSEK | NORMAL).
- Durum: `durum` (ACIK | TAMAMLANDI | ERTELENDI | OTOMATIK_KAPANDI), `ertelenen_tarih`, `tamamlayan_id`, `not`.

**`belge`**: `sahip_tur`, `sahip_id`, `belge_turu` (SOZLESME | TAPU | ONAY_BELGESI | PIYASA_ARASTIRMA | BORC_YAZISI | FATURA | EK_PROTOKOL | MAHKEME_KARARI | DAMGA_MAKBUZU | DIGER), `dosya_adi`, `sha256`, `boyut`, `mime`, `yukleyen_id`.

**`ocr_sonucu`**: `belge_id`, `durum` (KUYRUKTA | ISLENIYOR | TAMAM | HATA), `metin` (sayfa bazında jsonb), `hocr_yolu`, `oneriler` (jsonb), `hata`.

**`yazi_sablonu`**: `ad`, `tur`, `dosya_id`, `aktif`.

**`butce_senaryosu`**: `ad`, `hedef_yil`, `aylik_tufe12_varsayimi` (jsonb: ay → oran), `yenileme_varsay` (bool).

**`is_calisma`**: `is_adi`, `baslangic`, `bitis`, `durum`, `ozet`, `hata`.

**`olay_gunlugu`** (audit, append-only): `kullanici_id`, `zaman`, `varlik`, `varlik_id`, `eylem`, `once` (jsonb), `sonra` (jsonb), `ip`. UPDATE ve DELETE işlemleri trigger ile engellenir.

## 6. Hesap çekirdeği (`src/core/hesap`)

### 6.1 Genel kurallar
- Para hesapları yalnızca `decimal.js` ile yapılır: `Decimal.set({ precision: 40, rounding: ROUND_HALF_UP })`.
- Para değerleri iki ondalığa **yalnızca kuralın söylediği adımda** yuvarlanır. Ara adımlarda yuvarlama yapılmaz.
- Yuvarlama modları parametredir. Varsayılanlar:

| Adım | Mod |
|---|---|
| Kira artışı sonucu | `ROUND_DOWN` (tavanı kuruş farkıyla bile aşmamak için) |
| Stopaj, KDV, damga, brütleştirme | `ROUND_HALF_UP` |
| Yıllık bedelin taksitlere bölünmesi | `ROUND_DOWN`; artık son taksite eklenir |
| Hisse dağıtımı | En büyük kalan yöntemi (§6.4) |

- Her fonksiyon saftır ve `Result<T, HesapHatasi>` döner. Hata kodları Türkçe mesaj sözlüğüne eşlenir.

### 6.2 K1 — Taksit brüt tutarı
Taksit dönemi `[d1, d2]`. Bu dönemle kesişen her `kira_donemi` için ayrı hesap yapılır ve sonuçlar toplanır:
- **AYLIK taban:** tam aylar `bedel × ay_sayısı` olarak hesaplanır. Kıst ay `GERCEK_GUN` yönteminde `bedel × gün / ayın_gün_sayısı`, `OTUZ_GUN` yönteminde `bedel × gün / 30` olur.
- **YILLIK taban:** kira yılı (sözleşme başlangıcından itibaren 12 ay) içinde `k = 12 / odeme_periyodu_ay` taksit vardır. İlk `k−1` taksitin her biri `⌊bedel × periyot / 12⌋₀,₀₁` (kuruşa aşağı yuvarlanır). Son taksit `bedel − Σ önceki` olur. Böylece kira yılı toplamı tam olarak `bedel` eder.
- Kıst dönem tutarı `ROUND_HALF_UP` ile kuruşa yuvarlanır.

### 6.3 K2 — Kira artışı
Girdiler: dönem başlangıcı `D`, önceki dönemde fiilen geçerli bedel `B`, artış kuralı, onaylı endeksler, parametreler.

1. `D` tarihi ilk kira başlangıcından itibaren 12 ay dolmadan geliyorsa ya da kural `YOK` ise → `oran = 0` (2019 HMB genelgesi md. 2).
2. Referans ay: `ref = ay(D) − 1`.
3. Tavan: `tavan = TUFE_12AY_ORT[ref]`. Değer **onaylı** olmalıdır; değilse sonuç `BEKLEMEDE` olur.
   - Konut ve 11.06.2022–01.07.2024 arasında başlayan dönemler: `min(25, tavan)` (tarihsel kayıtlar için).
   - 01.07.2020'den önce başlayan kamu işyeri dönemleri: tavan yok (tarihsel kayıtlar için).
4. Sözleşme oranı:
   - `TUFE12` → `TUFE_12AY_ORT[ref]` ya da `TUFE_YILLIK[ref]` (`artis_degisim_turu`'na göre)
   - `YIUFE` → `YIUFE_12AY_ORT[ref]` ya da `YIUFE_YILLIK[ref]`
   - `TUFE_YIUFE_ORT` → `(TÜFE_x + YİÜFE_x) / 2`, 4 ondalık, `ROUND_HALF_UP`
   - `SABIT` → `sabit_artis_orani`
   - `ELLE` → kullanıcının girdiği oran (gerekçe zorunlu)
5. `uygulanan = max(0, min(sözleşme_oranı, tavan))`.
6. `yeni_bedel = ROUND_DOWN(B × (1 + uygulanan / 100), 2)`.
7. Tespit kararı (`kaynak = TESPIT`) girilirse K2 uygulanmaz; bedel karardaki tutardır (TBK 344/3).
8. **Onay sonrası taksitler:** Artış onaylandığında, yeni `kira_donemi` açılır.
   - Dönemi artışla kesişen ve durumu PLANLANDI olan taksitlerin brüt tutarı ve anlık görüntüsü **yeniden hesaplanır**.
   - Durumu PAKETTE, ODEME_EMRINDE ya da ODENDI olan taksitler eski bedelle hesaplanmışsa değiştirilmez. Aradaki fark için `tur = FARK` taksiti oluşturulur. Vade, onay tarihi + `FARK_VADE_GUN` (parametre, varsayılan 10) olur.
   - Fark negatif çıkarsa (ör. elle düzeltme) taksit oluşturulmaz; KRITIK hatırlatma açılır ve fazla ödeme kullanıcı tarafından takip edilir.

### 6.4 K3 — Hisseye bölüştürme (en büyük kalan / Hamilton)
Girdi `T` kuruştur (tamsayı); hisseler `pᵢ/qᵢ` şeklindedir.
1. Her malik için `tabanᵢ = ⌊T × pᵢ / qᵢ⌋` ve `kalanᵢ = (T × pᵢ) mod qᵢ / qᵢ` (rasyonel) hesaplanır.
2. `artık = T − Σ tabanᵢ` (0 ≤ artık < malik sayısı).
3. Artık kuruşlar, `kalanᵢ` en büyük olandan başlayarak birer birer dağıtılır. Kalanlar eşitse küçük `kisi_id` önce alır (deterministik).
4. **Değişmez kural:** `Σ payᵢ = T`.

Dağılımda **vade tarihinde geçerli** malik seti kullanılır. Taksit dönemi içinde malik değişikliği varsa paket ön kontrolünde uyarı verilir ve kullanıcı "dönemi böl" seçeneğiyle taksiti iki parçaya ayırabilir.

### 6.5 K4 — Malik başına kesintiler
Her dağılım satırı için kesinti sırası şöyledir:

```
brüt_i
+ KDV_i        = ROUND_HALF_UP(brüt_i × kdv_oranı)          (statü KDV'li ise)
− stopaj_i     = ROUND_HALF_UP(brüt_i × stopaj_oranı)       (statü stopajlı ise)
− damga_i      (§6.7, istihkaktan kesilecek kalan)
− haciz_i      (aktif hacizler, tebliğ tarihi sırasıyla, kalan tutara kadar)
− 22A_i        (§6.5.2)
= net_i  (≥ 0, aksi halde hata: NEGATIF_NET)
```

- Oranlar, taksitin **tahakkuk tarihinde** (paketin hesaplandığı tarih) yürürlükteki parametreden alınır.
- **NET sözleşme:** Hisseye bölüştürme net tutar üzerinden yapılır (K3). Sonra her malik için `brüt_i = ROUND_HALF_UP(net_i / (1 − stopaj_oranı))` ve `stopaj_i = brüt_i − net_i` hesaplanır. Stopaja tabi olmayan statüde `brüt_i = net_i` olur. Bu şekilde sözleşmede yazan net tutar aynen korunur.

#### 6.5.1 Toplama
22/A ve haciz kontrolleri, **bir paket içinde aynı ödeme alıcısına** (`odeme_kisi_id`) giden tüm dağılımların toplamı üzerinden yapılır. Kesinti tutarları dağılımlara, vade sırasına göre (önce eski vade) uygulanır.

#### 6.5.2 22/A
- `ödenecek = Σ (brüt + KDV − stopaj − damga − haciz)` alıcı bazında hesaplanır.
- `ödenecek > ESIK_22A_ODEME` (5.000) ise:
  - Ödeme tarihinde geçerli bir `borc_sorgu` yoksa → **bloke**.
  - Sorgu varsa ve `borc_tutari > ESIK_22A_BORC` (5.000) ise → `kesinti = min(borc_tutari, ödenecek)`. Kesinti, vergi dairesi ve belge no ile birlikte kesinti satırı olarak yazılır.

### 6.6 Vergi statüsü → kural eşlemesi (parametre tablosu)

| `vergi_statusu` | Stopaj | KDV | Not |
|---|---|---|---|
| GMSI_GERCEK | %20 (GVK 94/5-a) | — | Varsayılan gerçek kişi |
| SERBEST_MESLEK | %20 | — | |
| TICARI_AKTIF | 0 | %20 | ⚠ "Müşavir teyidi gerekli" rozeti |
| BASIT_USUL | %20 | — | ⚠ Teyit rozeti |
| SIRKET | 0 | %20 | Fatura no/tarih zorunlu |
| KOOPERATIF | %20 (KVK 15/1-b, kod 042) | — | ⚠ KDV teyidi |
| VAKIF_DERNEK | %20 (GVK 94/5-b) | — | İktisadi işletme değilse |
| KAMU | 0 | 0 | ⚠ Teyit rozeti |

KDV tevkifatı her statüde 0'dır (belediye belirlenmiş alıcı değildir). Bu da parametredir.

### 6.7 K5 — Damga vergisi
- `tutar = min(ROUND_HALF_UP(matrah × DAMGA_KIRA_ORANI), DAMGA_AZAMI[yıl])`.
- **ILK** olayında matrah, sözleşme süresi boyunca ilk bedelle hesaplanan toplam **brüt** kiradır (KDV hariç). Süresiz sözleşmede matrah `DAMGA_SURESIZ_AY` (12) aylık brüt kiradır.
- **YAZILI_ARTIS** (ek protokol ya da yazılı belge varsa) olayında matrah artan tutardır (kalan süre × fark). **YAZILI_UZATMA** olayında matrah uzatılan sürenin kirasıdır. Sözleşme kendiliğinden uzarsa ya da sözleşmedeki madde gereği endeks artışı yapılırsa damga **doğmaz**.
- Tutar malik hisselerine K3 ile bölünür.
- `ISTIHKAKTAN` yönteminde tutar, sözleşmenin ilk taksit dağılımlarından kesilir. Net tutar yetmezse `kalan_kesinti` bir sonraki taksite devreder.
- `MALIK_BEYAN` yönteminde kesinti yapılmaz. Makbuz belgesi yüklenene kadar hatırlatma açık kalır (H10).

### 6.8 Hesap anlık görüntüsü
Her taksit (ve hesaplanmış her dağılım) şunları jsonb olarak saklar: kullanılan kira dönemleri, endeks değerleri ve onay kimlikleri, parametre değerleri ve yürürlük kayıtları, yuvarlama modları, `core` kural sürümü (`HESAP_SURUMU` sabiti) ve adım adım hesap satırları.

Arayüzdeki "hesap izi" paneli bu görüntüden çizilir. Hesap **yeniden çalıştırıldığında** aynı sonuç çıkmazsa bu bir hatadır (test edilir).

### 6.9 Uyum uyarıları (bloke etmez)
- `odeme_periyodu_ay > 3` ya da `odeme_zamani = DONEM_SONU` → 2019 HMB genelgesi md. 3 uyarısı.
- `artis_periyodu_ay < 12` → TBK 344 / genelge uyarısı.
- Kullanım amacı HIZMET_BINASI ya da LOJMAN olan yeni sözleşme → 2024/7 Tasarruf Genelgesi izin hatırlatması (parametre `TASARRUF_GENELGESI_BITIS` tarihine kadar).

## 7. Ödeme takvimi motoru (`src/core/takvim`)

### 7.1 Dönem üretimi
- Dönem `i` başlangıcı **her zaman orijinal başlangıçtan** hesaplanır: `ayEkle(baslangic, i × odeme_periyodu_ay)`. Zincirleme ekleme yapılmaz. `ayEkle`, hedef ayda o gün yoksa ayın son gününü verir. Örnek: başlangıç 31.01 ise dönemler 28/29.02, 31.03, 30.04, 31.05 tarihlerinde başlar.
- Dönem bitişi, bir sonraki dönem başlangıcından bir gün öncedir. Son dönem sözleşme bitişinde kesilir (kıst olur).
- Belirsiz süreli ya da uzamış sözleşmelerde dönemler **24 ay ileriye** kadar üretilir (`takvim-uzat` işi).
- **Artış dönemi** başlangıcı `ayEkle(ilk_kira_baslangici, k × artis_periyodu_ay)` formülüyle bulunur (k ≥ 1). "Kira yılı" bu iki tarih arasındaki aralıktır.
- Tarih aritmetiği `src/core/tarih` içindeki saf fonksiyonlarla yapılır (`DATE` = takvim günü, saat dilimi yok). Harici tarih kütüphanesi kullanılmaz.

### 7.2 Vade kuralları
- `DONEM_BASI_ARTI_GUN(n)` — peşin; vade = dönem başı + n gün (varsayılan n = 0).
- `AYIN_GUNU(g)` — dönemin ilk ayının g. günü (peşin) ya da son ayının g. günü (dönem sonu). Ayda g. gün yoksa ayın son günü alınır.
- `DONEM_SONU_ARTI_GUN(n)` — dönem sonu + n gün.

Sözleşmesel vadeler tatile denk gelse de **kaydırılmaz**; panoda "tatile denk geliyor" etiketi gösterilir. Yasal son günler (muhtasar 26, 22/A geçerliliği vb.) tatildeyse bir sonraki iş gününe kayar.

### 7.3 Uzama
- **Konut ve çatılı işyeri** (tür BINA, ISYERI, DEPO, KONUT): Belirli süreli sözleşmenin bitiş tarihi geldiğinde, `durum = AKTIF` iken fesih kaydı yoksa sözleşme otomatik olarak `UZADI` olur: `bitis += 12 ay` ve uzama sayacı artar (TBK 347). Bu işlem audit'e yazılır ve kullanıcıya bildirilir. 10. uzama yılından sonra H8 hatırlatması devreye girer.
- **Arsa** (tür ARSA): TBK 347 uygulanmaz; sözleşme süre bitiminde sona erer (TBK 327). Bitiş tarihinde otomatik uzama **yapılmaz**. Sözleşme `SONA_ERDI` adayı olur ve "Kullanım sürüyor mu?" kararı için KRITIK hatırlatma açılır. Kullanıcı ya yenileme sözleşmesi girer ya da sözleşmeyi **belirsiz süreliye** dönüştürür (`bitis = NULL`; fesih dönemleri TBK 329'a göre 6 aylık dönem sonu, 3 ay önceden).
- H6 kuralındaki "15 gün önce son gün" uyarısı yalnızca TBK 347 kapsamındaki türlerde üretilir. Arsada H6 yalnızca 90/60/30 gün uyarılarını verir.

## 8. Endeks akışı (`src/server/endeks` + worker)

- **Kaynak:** TCMB EVDS3 — `https://evds3.tcmb.gov.tr/igmevdsms-dis/series=<SERİ>&startDate=dd-MM-yyyy&endDate=dd-MM-yyyy&type=json`, header `key: <EVDS_API_KEY>`.
- **Seriler** (parametre tablosunda tutulur, değiştirilebilir): `TP.TUKFIY2025.GENEL` (TÜFE 2025=100), Yİ-ÜFE serisi (`TP.TUFE1YI.T1`, baz yılı ilk kurulumda doğrulanacak).
- **Hesaplama:**
  - `TUFE_12AY_ORT[t] = (Σ_{k=0..11} I[t−k] / Σ_{k=12..23} I[t−k] − 1) × 100` → 2 ondalık, `ROUND_HALF_UP`.
  - `TUFE_YILLIK[t] = (I[t] / I[t−12] − 1) × 100` → 2 ondalık.
  - Farklı baz yıllı endeksler aynı formülde **karıştırılmaz**. 2026 öncesi aylar için 2003=100 serisi (`TP.GENENDEKS.T1`) ayrı tutulur. Geçmiş oranlar TÜİK'in yayımladığı değerlerle elle yüklenir (ilk kurulumda 2024-10 → güncel tablo).
- **Onay:** EVDS'ten gelen değer `BEKLIYOR` durumunda kaydedilir. Kullanıcı TÜİK bülteniyle karşılaştırıp onaylar ya da resmi değeri girer (`kaynak = ELLE`, `evds_degeri` saklanır). **Onaylanmamış değer hiçbir hesapta kullanılmaz.**
- Onay verildiğinde `ay(D) − 1 = onaylanan ay` koşulunu sağlayan ve `BEKLEMEDE` durumundaki tüm artış hesapları çalıştırılır.
- EVDS erişilemezse `is_calisma` hata kaydı oluşur ve panoda "EVDS'e ulaşılamadı — elle girin" bandı gösterilir.

## 9. Hatırlatma motoru (`src/core/hatirlatma-kurallari` + worker)

- Kurallar saf fonksiyondur: `(veri anlık görüntüsü, bugün, parametreler) → HatirlatmaAdayi[]`.
- `hatirlatma-uret` işi her gün 06:00'da çalışır. Adaylar `anahtar` ile upsert edilir. Koşulu artık sağlanmayan açık hatırlatma `OTOMATIK_KAPANDI` olur. Kullanıcının tamamladığı ya da ertelediği kayıt ezilmez.
- Anahtar biçimi: `<KURAL>:<varlık>:<id>:<hedef_tarih>`, örneğin `H6_SON_GUN:sozlesme:42:2027-03-16`.

| Kod | Olay | Görünür olma (parametre) | Öncelik |
|---|---|---|---|
| H1 | Taksit vadesi | Vadeden 7 ve 3 gün önce, vade günü; vade geçince GECIKMIS | Vade geçince KRITIK |
| H2 | Ödeme emri hazırla | Vadeden 10 iş günü önce | YUKSEK |
| H3 | 22/A sorgusu | Paket hazırlanırken geçerli sorgu yoksa; mevcut sorgunun geçerliliği bitmeden 3 gün önce | YUKSEK |
| H4 | Endeks onayı | Ayın 3'ü (iş günü) itibarıyla BEKLIYOR olan değer | YUKSEK |
| H5 | Kira artışı | Dönem başından 30 gün önce "yaklaşıyor"; HESAPLANDI → "onayla"; BEKLEMEDE | YUKSEK |
| H6 | Sözleşme bitişi | 90, 60 ve 30 gün önce; **bitişten 15 gün önce "fesih bildirimi son gün"** (TBK 347; arsada yok, bkz. §7.3) | Son gün KRITIK |
| H7 | 5 yıllık tespit riski | `ilk_kira_baslangici + 5n yıl` tarihinden 6 ay önce | NORMAL |
| H8 | 10 uzama yılı | Her uzama yılı bitiminden 3 ay önce | NORMAL |
| H9 | Muhtasar listesi | Her ayın 20'si (son gün 26) | YUKSEK |
| H10 | Damga | ISTIHKAKTAN: muhtasar dönemi; MALIK_BEYAN: imzadan sonra 15 gün içinde makbuz yoksa | YUKSEK |
| H11 | Bütçe projeksiyonu | Her yıl 1 Eylül | NORMAL |
| H12 | Eksik veri | IBAN yok, Σ hisse ≠ 1, sözleşme PDF'i yok, vergi statüsü teyitli değil, onay belgesi eksik | NORMAL |
| H13 | Mevzuat gözden geçirme | Tarihli parametrelerin `yururluk_bitis` tarihinden 30 gün önce (ör. 2024/7 genelgesi 17.05.2027) | NORMAL |

**`.ics` takvim**
- `GET /takvim/<token>.ics` adresinden sunulur. Token kullanıcıya özeldir; DB'de hash'i tutulur, yenilenebilir.
- İçerik: açık hatırlatmalar, tüm gün etkinliği (VEVENT) ve VALARM (−1 gün 09:00).
- **TCKN, IBAN ve kişi adı içermez**; yalnızca sözleşme no, taşınmaz kısa adı ve olay bulunur.

## 10. Ödeme paketi ve çıktılar (F2)

### 10.1 Akış
1. **Oluştur:** birim ve vade aralığı seçilir; durumu PLANLANDI olan taksitler önerilir, kullanıcı seçer → TASLAK.
2. **Ön kontrol:**
   - Bloke eden hatalar: IBAN yok; Σ hisse ≠ 1; 22/A sorgusu yok ya da süresi dolmuş; artış BEKLEMEDE; vergi statüsü boş; SIRKET için fatura no/tarih yok; net < 0.
   - Uyarılar: §6.9; ödenek yetersiz (ödenek girildiyse); teyit rozetli statü; dönem içinde malik değişikliği.
3. **Hesapla:** `taksit_dagilim` satırları oluşur ve anlık görüntü yazılır → HESAPLANDI.
4. **Kesinleştir:** tek transaction içinde taksitler `SELECT … FOR UPDATE` ile kilitlenir. Paket ve dağılımlar değiştirilemez olur, taksitler PAKETTE durumuna geçer → KESINLESTI.
5. Asıl muhasebe sisteminde kesilen ödeme emrinin no ve tarihi girilir → ODEME_EMRINDE.
6. Ödeme tarihi girilir (toplu) → ODENDI; taksitler ODENDI olur.
- **İptal:** KESINLESTI ya da ODEME_EMRINDE durumundaki paket, gerekçe yazılarak iptal edilebilir. Taksitler PLANLANDI'ya döner. ODENDI durumundaki paket iptal edilemez; düzeltme için ters/fark taksiti oluşturulur.

### 10.2 Çıktılar
- **Ödeme Emri Hazırlık Föyü (PDF):** MİBMY yeni Örnek 32 alan yapısına uygundur.
  - Başlık: idare, harcama birimi, kurumsal kod, bütçe yılı.
  - Alıcı satırları: ad, TCKN/VKN, IBAN, net.
  - Detay: ödeme kalemi, bütçe tertibi, brüt; kesinti türü, oran, hesaba esas tutar.
  - Toplamlar.
  - Ek belge listesi.
  - İmza alanları: gerçekleştirme görevlisi, harcama yetkilisi.
- **Ek belge kontrol listesi** (HBY md. 35/a, md. 5, md. 49/4):
  - Sözleşmenin ilk ödemesinde: onay belgesi, piyasa fiyat araştırma tutanağı, sözleşme (taahhüt dosyası).
  - Her ödemede: fatura (SIRKET / TICARI_AKTIF) ya da harcama pusulası (diğerleri).
- **Harcama Pusulası (Örnek 1, PDF):** fatura vermeyen gerçek kişiler için, alıcı başına bir adet.
- **Muhasebe işlem fişi önerisi (PDF):**
  - 630 B (brüt + KDV; belediye için KDV gider niteliğindedir) / 360 A (stopaj, damga) / 103 A (net) / 333 A (22/A).
  - 830 B / 835 A.
  - 905 B / 900 A.
  - İlk ödemede 920/921 taahhüt notu.
- **Excel aktarım dosyası:** alıcı başına bir satır. Açıklama alanı: `<TCKN|VKN> – kira ödemesi – <dönem> – <sözleşme no>` (328 Seri No'lu GVGT).
- **Kira artış hesap tablosu (PDF):** paket içinde artış dönemi olan sözleşmeler için.

### 10.3 Ekonomik kod eşlemesi (parametre)

| Taşınmaz türü / kullanım amacı | Varsayılan kod |
|---|---|
| HIZMET_BINASI (BINA, ISYERI) | 03.5.5.05 |
| LOJMAN (KONUT) | 03.5.5.06 |
| ARSA | 03.5.5.07 |
| DEPO, OTOPARK, SOSYAL_TESIS, DIGER | 03.5.5.90 |

## 11. Dönemsel raporlar (F2)
- **Muhtasar stopaj listesi** (ay seçilir, ödendi tarihine göre): tür kodu (041/042), TCKN/VKN, soyad/unvan, ad, gayrisafi tutar, kesilen vergi. Excel ve CSV.
- **Damga vergisi beyan listesi:** ISTIHKAKTAN kesilenler.
- **22/A kesinti aktarım listesi:** vergi dairesi bazında.
- **Ödenek/taahhüt raporu:** yıl × ekonomik kod × birim kırılımında yıllık yük, ödenen ve kalan.
- **Gecikmiş ödemeler** ve **sözleşme durum raporu.**
- **Denetim dosyası (PDF, sözleşme bazında):** sözleşme künyesi, malik geçmişi, kira dönemleri, artış hesapları (endeks ve onaylarıyla), taksitler, dağılımlar, hesap izleri, audit özeti.

## 12. Yazı şablonları (F3)
- DOCX şablonları docxtemplater ile doldurulur. Yönetici şablonu Word'de düzenleyip yükler.
- Alan sözlüğü ekranda listelenir: `{sozlesme.no}`, `{tasinmaz.adres}`, `{malik.ad_soyad}`, `{eski_bedel}`, `{yeni_bedel}`, `{oran}`, `{referans_ay}`, `{bugun}` vb. Para alanları Türkçe biçimli gelir; tutarın yazıyla karşılığı da üretilir.
- Hazır şablonlar: kira artış bildirimi, ek protokol taslağı, fesih bildirimi (TBK 348), yenileme teklifi, ödeme emri ön yazısı, borç sorgu talep yazısı.
- Çıktı DOCX'tir (PDF dönüşümü yok; resmi yazı EBYS'den çıkar).

## 13. Bütçe projeksiyonu (F3)
- Hedef yıl ve senaryo seçilir. Senaryo, her ay için TÜFE12 varsayımı içerir; "yenileme varsay" seçeneği vardır.
- Aynı `core` fonksiyonları (K1, K2, K4) gelecek tarihlere uygulanır. Varsayımsal endeksler gerçek endeks tablosuna **yazılmaz**; bellek içi kaynaktan okunur.
- Çıktı ay × ekonomik kod × birim kırılımında brüt, stopaj, KDV ve net tutarlardır; Excel olarak alınır. Geçmiş yıllar için gerçekleşen ile projeksiyon karşılaştırılır.

## 14. Veri girişi, OCR ve Excel içe aktarma

### 14.1 Belgeler
- Yalnızca PDF kabul edilir, en fazla 50 MB. `%PDF-` magic byte kontrolü yapılır.
- Dosya `belgeler/<sha256[0:2]>/<sha256>.pdf` yoluna yazılır; aynı içerik tek kopya tutulur.
- Belgeler oturum kontrollü route üzerinden sunulur.

### 14.2 OCR hattı (F3)
- Belge yüklenince sözleşme türündeyse `ocr` kuyruğuna alınır.
- Worker şu adımları izler: `pdftoppm -r 300 -gray` → sayfa PNG'leri → `tesseract -l tur <png> - hocr txt` → sayfa metni ve hOCR.
- Süre sınırı sayfa başına 60 sn, en fazla 40 sayfa.

### 14.3 Kural tabanlı çıkarıcılar (`src/core/ocr-kurallar`)

| Alan | Kural | Doğrulama / güven |
|---|---|---|
| TCKN | `\b[1-9]\d{10}\b` | Resmi checksum (10. ve 11. hane) |
| VKN | `\b\d{10}\b` | VKN algoritması |
| IBAN | `TR\s?\d{2}(\s?\d{4}){5}\s?\d{2}` (boşluk toleranslı) | mod-97. Yalnızca rakam bağlamında O→0, I/l→1, S→5, B→8 düzeltmesi yapılır |
| Tutar | `\d{1,3}(\.\d{3})*(,\d{2})?\s*(TL|₺|Türk Lirası)` | Yakınında yazıyla tutar varsa Türkçe sayı ayrıştırıcıyla karşılaştırılır; eşleşirse YÜKSEK güven |
| Tarih | `gg.aa.yyyy`, `gg/aa/yyyy`, `g <Ay> yyyy` | Takvim geçerliliği |
| Süre | `(\d+)\s*\(?[a-zçğıöşü ]*\)?\s*(yıl|ay)` | Başlangıç + süre = bitiş tutarlılığı |
| Ada/parsel | `(\d+)\s*ada\s*(\d+)\s*parsel` | — |
| Artış hükmü | "TÜFE", "ÜFE", "%", "artış yapılmaz" anahtar kelime penceresi | Yalnızca öneri (DÜŞÜK güven) |
| Taraflar | "Kiraya veren" / "Kiracı" başlık penceresi | Yalnızca öneri |

Çıkarıcı çıktısı her öneri için şunları içerir: `{alan, değer, güven: YUKSEK|ORTA|DUSUK, sayfa, bbox}`.

### 14.4 Giriş ekranı
- Solda pdf.js görüntüleyici yer alır; seçili önerinin bbox'ı sarı ile vurgulanır.
- Sağda sihirbaz form bulunur: taşınmaz → malikler → bedel ve ödeme → artış → bütçe ve onay → **ilk 24 ay taksit önizlemesi** → kaydet.
- Öneriler alan yanında rozet olarak görünür ve tek tek **kabul edilmelidir**; hiçbir öneri kendiliğinden kaydedilmez.
- OCR olmasa da aynı ekran elle giriş için kullanılır.

### 14.5 Excel içe aktarma (F3)
- İndirilebilir şablon kullanılır: taşınmaz, kişi, sözleşme ve malik sayfaları.
- Yüklenen dosya formla **aynı zod şemaları** ile doğrulanır. Satır bazında hata raporu üretilir; önizlemeden sonra onaylanır.
- Tüm kayıtlar TASLAK olarak gelir; aktifleştirme elle yapılır.

## 15. Ekranlar ve görsel dil

| Ekran | İçerik |
|---|---|
| Pano | 4 özet kart (gecikmiş, bu hafta vade, karar bekleyen, son TÜFE12); sekmeler: Bugün / Bu hafta / Gecikmiş / Karar bekleyen; hatırlatma satırında tamamla, ertele ve kayda git; üstte genel arama (sözleşme no, malik, ada/parsel) ve bildirim zili |
| Sözleşmeler | Filtrelenebilir tablo (durum, birim, bitişe kalan gün) |
| Sözleşme detayı | Özet şeridi + sekmeler: Genel, Malikler (hisse çubuğu, tarihçe), Kira dönemleri (zaman çizelgesi), Taksitler, Belgeler, Hatırlatmalar, Geçmiş |
| Sözleşme girişi | §14.4 |
| Taşınmazlar, Kişiler | Liste ve detay; kişide IBAN'lar, borç sorguları ve hacizler |
| Ödeme paketleri | Sihirbaz (§10.1), paket listesi |
| Endeksler | Ay tablosu, onay ekranı (EVDS ve TÜİK değerleri yan yana, fark uyarısı) |
| Raporlar | §11 |
| Bütçe | §13 |
| Yönetim | Parametreler (tarihçeli), tatiller, kullanıcılar, yazı şablonları, iş çalışma geçmişi, audit arama |

**Görsel dil:**
- Tailwind 4 + shadcn/ui; açık tema varsayılan.
- Sayısal sütunlar sağa hizalı, `font-variant-numeric: tabular-nums`.
- Para `1.234,56 ₺` biçimindedir; biçimlendirme `Decimal` string'inden yapılır, `Number` ve `Intl` kullanılmaz. Tarih `gg.aa.yyyy`.
- Her hesaplanmış tutar tıklanabilir ve "hesap izi" panelini açar (§6.8).
- Formlarda klavye ile ilerleme vardır; hata mesajları Türkçe ve eyleme dönüktür.

## 16. Güvenlik ve KVKK
- **Kimlik doğrulama:** kullanıcı adı ve argon2id (memory 64 MiB, t = 3, p = 1).
- **Oturum:** 256-bit rastgele token; DB'de sha256 hash'i tutulur. Çerez `HttpOnly; Secure; SameSite=Lax`. 8 saat hareketsizlikte oturum düşer.
- **Kaba kuvvet koruması:** 5 hatalı girişte hesap 15 dakika kilitlenir. Ek olarak IP bazlı hız sınırı: 20 deneme/dk.
- **Şifre kuralı:** en az 12 karakter. Şifre değişikliğinde diğer oturumlar düşer.
- İlk kullanıcı CLI ile oluşturulur: `pnpm kullanici:olustur`.
- **Web güvenliği:**
  - Server action'larda Origin kontrolü vardır; route handler'larda Origin/Host doğrulanır.
  - Güvenlik header'ları: CSP (`default-src 'self'`), `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`.
- **KVKK:**
  - Listelerde TCKN ve IBAN maskelidir (`*******1234`), detayda açık gösterilir.
  - Kişisel veri içeren dışa aktarımlar audit'e yazılır.
  - Test ve geliştirme ortamında gerçek veri kullanılmaz.
- **Gizli bilgiler:** `EVDS_API_KEY` ve `DATABASE_URL` yalnızca ortam değişkeninde tutulur, repoya girmez.

## 17. Hata yönetimi ve tutarlılık
- `core` istisna fırlatmaz, `Result` döner. Servisler bu sonucu Türkçe mesaj ve alan bazlı hata listesi olarak arayüze iletir.
- **Transaction sınırları:** paket kesinleştirme, artış onayı (yeni `kira_donemi` + fark taksitleri) ve malik değişikliği tek transaction içinde yapılır.
- **Eşzamanlılık:** değiştirilebilir kayıtlarda iyimser kilit (`version`) kullanılır; çakışmada "kayıt başka biri tarafından değiştirildi, yenileyin" mesajı gösterilir. Paket kesinleştirmede `FOR UPDATE`, aktif paket için partial unique index kullanılır.
- **Worker işleri** idempotenttir ve `pg_try_advisory_lock(<iş kimliği>)` ile tek kopya çalışır. Her çalışma `is_calisma` tablosuna yazılır. Başarısız işler panoda bant olarak görünür.
- **DB kısıtları:** CHECK (net ≥ 0, kesinti denklemi, 0 < pay ≤ payda), exclusion (`kira_donemi` ve `parametre` aralıkları), unique (hatırlatma anahtarı, taksit), trigger (Σ hisse = 1 deferred; audit append-only).

## 18. Test stratejisi

| Katman | Araç | Kapsam |
|---|---|---|
| `core` birim | vitest | K1–K5, takvim, vade kuralları, hatırlatma kuralları, OCR çıkarıcıları, TCKN/VKN/IBAN doğrulayıcıları, Türkçe yazıyla sayı ayrıştırıcı/üretici |
| Altın testler | vitest + JSON fixture | Mevzuat ve araştırma örnekleri: §6.4 tablosu, araştırmadaki yevmiye örneği, 2024-10 → 2026-09 TÜFE12 tablosuyla artış hesapları |
| Özellik testleri | fast-check | Σ dağılım = toplam; net ≥ 0; artış ≤ tavan; yıllık taksit toplamı = yıllık bedel; hesap iki kez çalışınca aynı sonuç; NET sözleşmede net korunumu |
| Mutasyon | Stryker (`src/core`) | Eşik **%90**; altına düşerse CI kırılır |
| Entegrasyon | vitest + gerçek Postgres (docker) | Repository'ler, transaction'lar, kısıtlar, trigger'lar, eşzamanlı kesinleştirme |
| E2E | Playwright | Giriş → sözleşme gir → taksit planı → endeks onayı → artış → paket → PDF/Excel |

Gerçek sözleşme taramaları repoya **konmaz**. OCR testleri sentetik/anonim taramalarla yapılır. Gerçek belgelerle doğruluk ölçümü yalnızca kurum sunucusunda, repoya girmeyen bir script ile yapılır.

## 19. Deploy ve operasyon
- **İmaj:** `node:22-bookworm-slim` + `tesseract-ocr` `tesseract-ocr-tur` `poppler-utils` `chromium` `fonts-dejavu` + Next standalone çıktısı + worker. Prisma `binaryTargets = ["native", "debian-openssl-3.0.x"]` (`anket` deneyimi).
- **docker-compose servisleri:**
  - `web` (port 3000)
  - `worker` (aynı imaj, `node worker/index.js`)
  - `postgres:17`
  - Volume'lar: `pgdata`, `belgeler`
- **Ortam değişkenleri:** `DATABASE_URL`, `EVDS_API_KEY`, `APP_URL`, `TZ=Europe/Istanbul`, `BELGE_DIZINI`.
- **GitLab CI:** lint → typecheck → test (birim + özellik) → entegrasyon → mutasyon (`core` değiştiyse) → e2e → build → deploy.
- **Yedekleme:** her gece `pg_dump -Fc` ve `belgeler` rsync; 30 gün saklanır. Ayda bir geri yükleme testi yapılır (runbook).
- **Migrasyon:** `prisma migrate deploy`. Trigger, exclusion ve partial index'ler raw SQL migrasyonlarıyla eklenir.

## 20. Başlangıç parametreleri (seed)

| Anahtar | Değer | Yürürlük | Dayanak |
|---|---|---|---|
| STOPAJ_94_5A | 20 | 2009-02-03 → | GVK 94/5-a, BKK 2009/14592 |
| STOPAJ_94_5B | 20 | 2009-02-03 → | GVK 94/5-b |
| STOPAJ_KVK_15_1B | 20 | 2009-02-03 → | KVK 15/1-b |
| KDV_GENEL | 20 | 2023-07-10 → | KDV oran kararı (öncesi 18) |
| KDV_TEVKIFAT_KIRA | 0 | — | Belediye belirlenmiş alıcı değil |
| DAMGA_KIRA_BINDE | 1,89 | — | DVK (1) s. tablo I/A-2 |
| DAMGA_AZAMI | 29.115.961,10 | 2026-01-01 → 2026-12-31 | DVK GT Seri 71 |
| DAMGA_AZAMI | 24.477.478,90 | 2025-01-01 → 2025-12-31 | — |
| DAMGA_SURESIZ_AY | 12 | — | Uygulama (teyit) |
| ESIK_22A_ODEME | 5.000 | 2020-03-03 → | Tahsilat GT Seri A No 12 |
| ESIK_22A_BORC | 5.000 | 2020-03-03 → | aynı |
| SURE_22A_GECERLILIK_GUN | 15 | — | aynı |
| MUHSGK_KOD_KIRA | 041 | — | GİB |
| MUHSGK_KOD_KOOPERATIF | 042 | — | GİB |
| TBK344_KONUT_SINIR | 25 | 2022-06-11 → 2024-07-01 | 7409 / 7456 (tarihsel) |
| FARK_VADE_GUN | 10 | — | Uygulama |
| TASARRUF_GENELGESI_BITIS | 2027-05-17 | — | Genelge 2024/7 |
| EVDS_SERI_TUFE | TP.TUKFIY2025.GENEL | 2026-01 → | TCMB |
| EVDS_SERI_YIUFE | TP.TUFE1YI.T1 | — | Kurulumda doğrulanacak |

İlk kurulumda TÜFE12 geçmişi (2024-10 → 2026-09) araştırma tablosundan **onaylı** olarak yüklenir ([02-kira-hukuku-ve-endeks.md §6](../../arastirma/02-kira-hukuku-ve-endeks.md)). Resmi tatiller 2026–2028 yılları için seed edilir.

## 21. Açık konular (mali müşavir / hukuk müşavirliği teyidi)

Bu konular parametre ya da uyarı olarak tasarlanmıştır; teyit sonrasında **kod değişmeden** parametre güncellenir.

1. TICARI_AKTIF ve BASIT_USUL malikte stopaj uygulaması.
2. Damga vergisi: istihkaktan kesinti mi, malik beyanı mı (varsayılan istihkaktan)? NET sözleşmede matrahın brüt alınması.
3. Süresiz sözleşmede damga matrahı (varsayılan 12 ay).
4. Kiracı sıfatıyla encümen/meclis kararının gerekip gerekmediği (alan opsiyonel).
5. 2026–2028 analitik bütçe rehberinde 03.5.5.xx kodlarının güncelliği; depo için doğru kod.
6. 2019 HMB Kamu Taşınmaz Kiralamaları Genelgesi'nin yürürlükte olup olmadığı (uyarılar buna bağlı).
7. 2024/7 Tasarruf Genelgesi'nin depo ve arsa kiralarını kapsayıp kapsamadığı.
8. 22/A kesintisinin muhasebe hesabı (333 varsayımı) ve 2026 idari para cezası tutarı.
9. KBB'nin 31.03.2026 MİBMY değişikliğiyle 135 Tek Hazine hesabı kapsamına girip girmediği (fiş önerisini etkiler).
10. Yİ-ÜFE EVDS seri kodunun ve baz yılının doğrulanması.

## 22. Mevzuat dayanakları (özet)
- **6098 TBK:** md. 310 (malik değişikliği), 315, 327, 329–330, 339/2, **344** (artış tavanı, 5 yıllık tespit), 345, **347** (uzama, 10 yıl), 348 (yazılı fesih).
- **6217** geçici 2 (kamu kiracı ertelemesi, 01.07.2020'de sona erdi).
- **4734** md. 4, **22/e**; Doğrudan Temin Tebliği md. 4/2. **2886** md. 51/l.
- **5393** md. 18/e, 34, 63, 67. **5018** md. 27–28.
- **GVK** 70, **94/5-a**, 98, 119; BKK 2009/14592. **KVK** 15/1-b.
- **KDVK** 1/3-f, **17/4-d**; KDV GUT I/C-2.1.3.
- **DVK** 2, **3/2**, 5, 8, 9, 14, 19, 22, 23, **24**; (1) s. tablo I/A-2; GT Seri 71.
- **6183 md. 22/A**; Tahsilat GT Seri A No 1 (EK-11 sıra 22), No 12.
- **328 Seri No'lu GVGT** (banka zorunluluğu).
- Mahalli İdareler Harcama Belgeleri Yönetmeliği md. 3, 5, **35/a**, 49/4.
- MİBMY (2016) + 31.03.2026 değişikliği (Örnek 32 / 33).
- HMB Kamu Taşınmaz Kiralamaları Genelgesi (RG 16.01.2019). Tasarruf Genelgesi 2024/7.
- 6325 md. 18/B (kira uyuşmazlığında zorunlu arabuluculuk).
