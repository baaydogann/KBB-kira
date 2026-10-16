# KBB Kira Takip — F2 Ödeme Paketi ve Çıktılar Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F1 çekirdeğinin üzerine şunları eklemek:
- ödeme paketi akışı: taslak → hesap → kesinleştirme → ödeme emri → ödendi;
- malik bazında dağılım ve kesintiler (K3–K5, 22/A, haciz, damga);
- ödeme emri hazırlık çıktıları: föy, ek listesi, harcama pusulası, fiş önerisi, artış tablosu, banka Excel'i;
- dönemsel raporlar ve sözleşme denetim dosyası;
- H3, H9 ve H10 hatırlatmaları.

**Architecture:** Aynı monolit.
- **Hesap:** Dağılım ve kesinti hesapları saf `src/core/hesap` ve `src/core/paket` modüllerindedir (decimal.js, bigint kuruş, `Result`).
- **Durum makinesi:** `src/server/paket` veriyi yükler, çekirdeği çağırır ve paket durumlarını tek transaction'larda yürütür. Kilit sırası F1 kuralını izler: önce sözleşme satırları `ORDER BY id DESC FOR UPDATE`, sonra paket, taksit, haciz, damga payı ve borç sorgusu.
- **Çıktılar:** Saf görünüm modellerinden `src/server/cikti` içinde pdfmake ve exceljs ile üretilir. Oturumlu GET route'larından indirilir ve her indirme denetim kaydına yazılır.

**Tech Stack:** F1 yığını (Next 15.5, Prisma 6.19, PostgreSQL 17, decimal.js, zod 4, vitest, fast-check, Stryker, Playwright) + `pdfmake@0.3.11`, `exceljs@4.4.0`; yalnız test için `pdfjs-dist@6.3.289`.

**Spec:** `docs/superpowers/specs/2026-10-15-kbb-kira-takip-design.md`. Bu planın dayandığı bölümler:
- veri: §5.1 (`taksit_dagilim`), §5.2;
- hesap: §6.4–§6.8;
- hatırlatma ve yasal son gün: §7.2, §9 (H1, H3, H9, H10);
- ödeme ve rapor: §10, §11;
- arayüz, güvenlik ve test: §15–§18.

Araştırma notları `docs/arastirma/01-vergi.md` ve `03-kamu-muhasebe.md` dosyalarındadır. F1 kalıpları için `docs/superpowers/plans/2026-10-15-f1-cekirdek.md`'ye bakın.

## Global Constraints

- **F1 kuralları aynen geçerlidir:** F1 planındaki tüm "Global Constraints" (sürümler, tipler, katman kuralları, yuvarlama varsayılanları, "bugün" = `bugunIstanbul()`, Türkçe biçimler, `kullaniciGerekli()` + `denetimKaydi()`, KVKK, rol yok).
- **Veritabanı güvenliği:**
  - `prisma migrate dev` ve `prisma migrate reset` **asla** çalıştırılmaz; `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` asla tanımlanmaz.
  - Migrasyon şöyle üretilir: `prisma migrate diff` + elle SQL + `prisma migrate deploy`.
  - Entegrasyon ve e2e testleri yalnızca `*_test` veritabanında çalışır (`testVeritabaniniDogrula`).
- **Git:** `.maestro/` hiçbir zaman stage edilmez; `git add` her zaman açık dosya yollarıyla yapılır. Push ve uzak sunucu işlemi yoktur.
- **Yeni bağımlılıklar (tam sürüm):**
  - `dependencies`: `pdfmake@0.3.11`, `exceljs@4.4.0`;
  - `devDependencies`: `pdfjs-dist@6.3.289`; pdfmake kendi tiplerini taşımıyorsa `@types/pdfmake@0.3.3`.
  - `pdfmake` ve `exceljs`, `next.config.ts` içindeki `serverExternalPackages` listesine eklenir.
- **Hesap modüllerinde lint:** `src/core/paket/**` ve `src/core/rapor/**` hesap kuralına tabidir. `Number`, `Math`, `parseFloat` ve `parseInt` kullanılamaz; bu dizinler ESLint `no-restricted-globals` listesine eklenir.
- **Kesinti sırası** (spec §6.5): `brüt + KDV − stopaj − damga − haciz − 22A = net ≥ 0`.
  - KDV, stopaj, damga ve brütleştirme `ROUND_HALF_UP` ile yuvarlanır.
  - Hisse ve parça dağılımı Hamilton yöntemiyle yapılır (`hisseyeDagit`).
- **Oranlar ve malik seti:**
  - Oranlar paketin hesap tarihinde (tahakkuk; `hesap_tarihi` = hesaplandığı gün) yürürlükteki parametreden alınır.
  - Malik seti taksit vadesinde geçerli olandır; bölünmüş taksitte her parçanın kendi setidir.
  - 22/A ve haciz hak sahibi (`kisi_id`) bazında, paket içinde toplanır.
- **Kilit sırası:** Taksit okuyup yazan her paket işlemi önce ilgili sözleşme satırlarını `SELECT id FROM sozlesme WHERE id IN (...) ORDER BY id DESC FOR UPDATE` ile kilitler.
  - **Neden azalan sıra:** F1'in çok sözleşmeli yolları azalan sırayla kilitler: toplu `artislariHesapla` (`orderBy: { id: 'desc' }`) ve yenileme (yeni → eski). Artan sıra bu yollarla karşılıklı kilitlenmeye (40P01) yol açardı.
  - Sonra sırasıyla paket, taksit (`ORDER BY id`), haciz, damga payı ve borç sorgusu (`ORDER BY id`) satırları kilitlenir. Kesinleştirme ve iptal aynı sırayı kullanır.
- **Paket durumları:**
  - İleri akış: `TASLAK → HESAPLANDI → KESINLESTI → ODEME_EMRINDE → ODENDI`.
  - İptal: `TASLAK | HESAPLANDI | KESINLESTI | ODEME_EMRINDE → IPTAL`.
  - Düzenleme `HESAPLANDI` paketi `TASLAK`'a döndürür.
  - Kesinleşmiş paketin dağılımı değiştirilemez; bunu DB tetikleyicisi zorlar.
- **KVKK:**
  - Kişisel veri içeren her dışa aktarım (PDF, Excel, CSV) `DISA_AKTAR` denetim satırı yazar. Satırda ad, TCKN/VKN, IBAN ve serbest metin bulunmaz.
  - TCKN/VKN/IBAN hiçbir URL'ye girmez; URL'lerde yalnızca kimlik numarası (id) bulunur.
  - Paket adı serbest metindir ve `.ics` akışına girmez.
- **Dosya biçimleri:**
  - Excel'de TCKN/VKN/IBAN metin hücresi olarak yazılır.
  - CSV `;` ayraçlıdır, UTF-8 BOM taşır, CRLF kullanır ve formül enjeksiyonuna karşı korunur.
  - PDF yazı tipi pdfmake'in Roboto'sudur; Türkçe karakterler korunur.
- **Spec'ten bilinçli sapmalar (gerekçeli):**
  - **PDF motoru:** puppeteer-core + chromium yerine saf JS **pdfmake**. İmajda tarayıcı olmaz (yaklaşık 300 MB daha küçük, sandbox bayrağı ve tarayıcı CVE'si yok). PDF'ler CI'ın tarayıcısız `node:22-bookworm-slim` aşamalarında üretilip metinleri doğrulanabilir.
  - **22/A ve haciz toplaması:** Spec'teki `odeme_kisi_id` yerine hak sahibi (`kisi_id`) bazındadır. Vergi borcu ve haciz malikin borcudur; vekil yalnızca tahsil eder. Vekil yoksa iki anahtar aynıdır.
  - **Banka Excel'i:** Satır anahtarı (hak sahibi, ödeme kişisi, IBAN) üçlüsüdür. Böylece her açıklamada kiraya verenin TCKN/VKN'si yer alır (328 Seri No'lu GVGT). Vekil yoksa "alıcı başına bir satır" ile aynıdır.
  - **Fatura zorunluluğu:** Statü kuralı `kdvli` olan tüm statülerde aranır (SIRKET, TICARI_AKTIF). KDV ödenen kira faturaya dayanır; spec §10.2 ek belge listesi de ikisini sayar.
  - **Dönemi böl:** Taksit satırı bölünmez; aksi halde `taksitPlaniniGuncelle` ile çakışırdı. Bölme dağılım düzeyinde, malik setinin değiştiği günlerde ve gün oranıyla (Hamilton) yapılır.
  - **Yeni tablolar:**
    - `paket_taksit`: pakete giren taksitler; "en fazla bir aktif paket" kısmi tekil dizini için.
    - `paket_fatura`: alıcı faturaları.
    - `dagilim_kesinti`: her kesintinin kaynağı (haciz / sorgu / damga payı); iptalde geri yükleme ve 22/A listesi için.
    - `damga_payi`: malik başına damga ve kalanı. Spec'teki `damga_kaydi.kalan_kesinti` bu kalanların toplamıdır.
  - **Ek sütunlar:**
    - `odeme_paketi.hesap_tarihi`, `on_kontrol`, `hesap_parmak_izi`, `kalan_odenek`, `olusturan_id`.
    - `taksit.sistem_disi_odeme` ve `odeme_notu`: F1'in C1 dondurmasından kalan, sistem dışında ödenmiş taksitler için.
  - **Kesinleştirme günü:** Kesinleştirme hesapla ile aynı gün yapılır (`hesap_tarihi = bugün`); aksi halde yeniden hesap istenir. Böylece oran, 22/A geçerliliği ve haciz kalanları bayatlamaz.
  - **Ödenmiş paket iptal edilmez.** Düzeltme F1'in bedel düzeltme akışıyla yapılır (FARK taksiti ya da fazla ödeme hatırlatması); yeni bir "ters taksit" türü yoktur. Yanlışlıkla "ödendi" işaretlenen ya da bankadan dönen ödeme için gerekçeli "ödemeyi geri al" vardır: ODENDI → ODEME_EMRINDE.
  - **22/A belgesinin ödeme tarihindeki geçerliliği** (spec §6.5.2 "ödeme tarihinde geçerli sorgu yoksa bloke"): Uygulamanın denetleyebildiği son adım ödeme emri girişidir. Sorgu gereken her alıcının sorgusu ödeme emri tarihinde geçerli olmalıdır; değilse ödeme emri reddedilir. "Ödendi" kaydı gerçekleşmiş bir olgudur ve engellenmez; geçersizlik uyarı olarak döner.
  - **Damga kayıtları:**
    - ILK damga kaydı, F2'den sonra aktifleştirilen ve göç işareti taşımayan sözleşmede otomatik oluşur; diğer sözleşmelere elle eklenir. Göç işaretleri `gecis_tarihi` ve `odenmis_sayilan_son_tarih` alanlarıdır.
    - İlk pakette damga kesilirken ön kontrol bilgi amaçlı bir uyarı verir: damga sistem dışında ödendiyse kaydın iptal edilmesi gerekir.
    - Parametre eksikse aktifleştirme durmaz; `DAMGA_HATA` hatırlatması açılır.
    - YAZILI_ARTIS ve YAZILI_UZATMA kayıtlarında matrahı kullanıcı girer (ek protokoldeki tutar).
  - **Hatırlatmalar:**
    - H10'un ISTIHKAKTAN kolu H9'a katılır: muhtasar hatırlatması stopaj ve istihkaktan damgayı birlikte anar. H10 yalnızca MALIK_BEYAN makbuzu içindir.
    - H9, H13 gibi kendiliğinden kapanmaz.
    - H1 ödeme sürecindeki (PAKETTE/ODEME_EMRINDE) taksitte ödenene kadar sürer; H2 yalnız PLANLANDI taksitte üretilir.
  - **Muhasebe ve bütçe:**
    - Haciz kesintisi fiş önerisinde 333 Emanetler hesabına yazılır (parametre; müşavir teyidi).
    - Ödenek uyarısı paket başına tek bir "kalan ödenek" girdisiyle yapılır (opsiyonel).
  - **Vergi statüsü** zorunlu alan olduğundan (`kisi.vergi_statusu NOT NULL`) "statü boş" ön kontrolü yoktur.

## Review Focus

1. **Paket iptalinde çift ödeme:** Artış onayıyla FARK almış ve vadesi gelmemiş bir taksit, paket iptalinde PLANLANDI'ya döner. Ana taksit ile FARK'ın toplamı yeni bedele eşit kalmalıdır; ikisi birlikte yeni bedelin üstüne çıkmamalıdır.
   - FARK tahakkuk etmişse (ödeme sürecinde ya da vadesi geçmiş) ana taksit dondurulur ve eski tutarında kalır.
   - FARK tahakkuk etmemişse FARK iptal edilir ve ana taksit yeni bedele fiyatlanır.
   - → Task 10 testleri.
2. **Aynı 22/A belgesi veya haciz iki pakette:** Borç ya da haciz kalanı iki kez kesilmemeli. Hesap yalnızca kesinleşmiş kullanımı düşer; kesinleştirme kilit altında yeniden doğrular ve ikinci paketi "yeniden hesaplayın" ile reddeder. → Task 11 testleri.
3. **Kimlik numarasının ve formülün bozulması:** Excel'de `0`'la başlayan VKN ve 26 haneli IBAN metin olarak kalmalı (bilimsel gösterim ya da baştaki sıfır kaybı olmamalı). CSV'de `=` ile başlayan bir ad formül olarak çalışmamalı. → Task 14 testleri.
4. **Hesap ile kesinleştirme arasındaki yarış:** Arada gece plan üretimi, artış onayı, malik değişikliği ya da yeni haciz olursa kesinleştirme reddedilmeli. Bunu taksit/sözleşme/kişi sürümleri ve kesinti kaynak kümesinden oluşan parmak izi sağlar; reddetmezse bayat tutar ödenir. → Task 11 testleri.
5. **Taksit dönemi içinde malik değişikliği (miras, satış):**
   - Böl seçilmezse vade günündeki malik seti kullanılmalı ve uyarı verilmeli.
   - "Böl" seçilirse tutar kuruş kaybı olmadan gün oranında parçalara ayrılmalı.
   - → Task 5 testleri.

---

## Dosya Yapısı

```
prisma/
├─ schema.prisma                                   # + F2 modelleri
└─ migrations/20261017090000_odeme_paketi/migration.sql
src/core/
├─ hesap/dagilim.ts                                # K3+K4 taksit dağılımı (parçalı)
├─ hesap/damga.ts                                  # K5 damga
├─ hesap/kesinti.ts                                # damga / haciz / 22A uygulaması
├─ hesap/goruntu.ts                                # + DAGILIM_SURUMU, DagilimGoruntusu
├─ paket/on-kontrol.ts                             # Bulgu türleri
├─ paket/hesap.ts                                  # malikParcalari, paketHesabi (dağılım + kesinti + ön kontrol)
├─ paket/ek-belge.ts                               # ek belge listesi
├─ paket/muhasebe.ts                               # muhasebe işlem fişi önerisi
├─ paket/banka.ts                                  # banka satırları ve açıklama
├─ rapor/vergi.ts                                  # muhtasar satırları
└─ hatirlatma.ts                                   # + H3, H9, H10
src/server/
├─ kesinti/{sema,servis}.ts                        # 22/A borç sorgusu, haciz
├─ damga/{sema,servis}.ts                          # damga kayıtları ve payları
├─ paket/{sema,servis,sorgu,hesapla,durum,cikti-verisi,cikti}.ts
├─ cikti/{pdf,excel,csv}.ts                        # biçim altyapısı
├─ cikti/belgeler/{foy,ek-liste,pusula,fis,artis-tablosu,denetim-dosyasi}.ts
├─ rapor/{vergi,yonetim,denetim-dosyasi}.ts
└─ (değişen) taksit/servis.ts, artis/servis.ts, sozlesme/servis.ts, hatirlatma/servis.ts,
             parametre/servis.ts, takvim/servis.ts, denetim.ts
src/app/
├─ (uygulama)/odeme-paketleri/{page.tsx, actions.ts, paket-formu.tsx, [id]/page.tsx, [id]/bolumler/*.tsx}
├─ (uygulama)/raporlar/page.tsx
├─ (uygulama)/kisiler/[id]/{kesinti-formlari.tsx} + page.tsx
├─ (uygulama)/sozlesmeler/[id]/sekmeler/damga.tsx + taksitler.tsx + page.tsx
├─ api/_lib/indirme.ts
├─ api/odeme-paketleri/[id]/{belgeler,banka}/route.ts
├─ api/raporlar/[rapor]/route.ts
└─ api/sozlesmeler/[id]/denetim-dosyasi/route.ts
tests/
├─ pdf-metni.ts                                    # pdfjs-dist ile PDF metni (yalnız test)
├─ unit/core/{dagilim,damga,kesinti,paket-hesap,ek-belge,muhasebe,banka,rapor-vergi}.test.ts
├─ unit/server/{csv,excel,pdf,taksit-tahakkuk}.test.ts
├─ integration/paket-yardimci.ts
├─ integration/{kisitlar-f2,kesinti,damga,paket,paket-hesapla,taksit-odeme,paket-durum,paket-cikti,
│               hatirlatma-f2,rapor,rapor-yonetim,denetim-dosyasi}.test.ts
└─ e2e/odeme-paketi.spec.ts
```

**Görev bağımlılıkları:**
- Task 1 her şeyden önce gelir.
- 2, 3 ve 4 birbirinden bağımsızdır; 5 bunlara dayanır.
- 6, 1'den sonra gelir. 7, 1 ve 3'ten sonra gelir.
- Ana zincir: 8 → 9 → 10 → 11.
- Çıktılar 11'den sonra gelir: 12 → 13 → 14.
- 15 ancak 11'den sonra yapılabilir.
- 16–18, 12 ve 14'ün altyapısını kullanır.
- 19 en son yapılır.
- Görevler numara sırasıyla yürütülür.

**Ortak test sabitleri** (entegrasyon):
- Sözleşme: `sozlesme-yardimci.ts` içindeki `girdi(h)` varsayılanı. 2026 yılı, aylık 10.000,00 TL brüt, peşin, vade dönem başı, imza 2025-12-20, malik A (GMSİ, %20 stopaj), sözleşmenin damga tahsili ISTIHKAKTAN.
- Bu sözleşme aktifleştirilince ILK damga kaydı oluşur: matrah 120.000,00, tutar 226,80.
- Şubat 2026 paketinde ödenecek tutar: brüt 10.000,00 − stopaj 2.000,00 − damga 226,80 = 7.773,20.

---

### Task 1: F2 şeması, kısıtlar ve tetikleyiciler

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261017090000_odeme_paketi/migration.sql`
- Test: `tests/integration/kisitlar-f2.test.ts`

**Interfaces:**
- Produces:
  - Prisma modelleri: `OdemePaketi`, `PaketTaksit`, `PaketFatura`, `TaksitDagilim`, `DagilimKesinti`, `BorcSorgu`, `Haciz`, `DamgaKaydi`, `DamgaPayi`.
  - Enum'lar: `PaketDurumu`, `HacizDurumu`, `DamgaOlayi`, `KesintiTuru`.
  - `Taksit` modeline `sistemDisiOdeme` ve `odemeNotu`.
  - Aşağıdaki kısıt ve tetikleyici adları: `kisitIhlaliMi(e, ad)` bunlarla eşleşir.

- [ ] **Step 1: Şemayı genişlet**

Mevcut modellere geri ilişkiler eklenir:
- `Birim.paketler`;
- `Kisi`: `borcSorgulari`, `hacizler`, `dagilimlar @relation("DagilimKisi")`, `odemeDagilimlari @relation("DagilimOdemeKisi")`, `damgaPaylari`, `faturalar`;
- `Iban.dagilimlar`, `SozlesmeMalik.dagilimlar`, `Sozlesme.damgaKayitlari`;
- `Taksit`: `paketKayitlari`, `dagilimlar`, `faturalar`.

Tüm `DateTime` tarih alanları `@db.Date`, anlar `@db.Timestamptz(3)`'tür. Para alanları `@db.Decimal(18, 2)`, oranlar `@db.Decimal(9, 4)`'tür. Alan adları snake_case `@map` alır; F1 modelleriyle aynı biçim kullanılır.

```prisma
enum PaketDurumu { TASLAK HESAPLANDI KESINLESTI ODEME_EMRINDE ODENDI IPTAL }
enum HacizDurumu { AKTIF KAPANDI }
enum DamgaOlayi  { ILK YAZILI_ARTIS YAZILI_UZATMA }
enum KesintiTuru { DAMGA HACIZ KESINTI_22A }

model OdemePaketi {            // @@map("odeme_paketi"), @@index([durum]), @@index([birimId])
  id Int @id @default(autoincrement())
  birimId Int;  birim Birim @relation(...)
  ad String
  vadeBaslangic DateTime @db.Date;  vadeBitis DateTime @db.Date
  durum PaketDurumu @default(TASLAK)
  kalanOdenek Decimal? @db.Decimal(18, 2)
  hesapTarihi DateTime? @db.Date
  onKontrol Json?;  hesapParmakIzi Json?
  muhasebeOdemeEmriNo String?;  muhasebeOdemeEmriTarihi DateTime? @db.Date
  odemeTarihi DateTime? @db.Date
  olusturanId Int?;  kesinlestirenId Int?;  kesinlesmeZamani DateTime? @db.Timestamptz(3)
  iptalNedeni String?
  version Int @default(0);  olusturmaZamani / guncellemeZamani (F1 kalıbı)
  taksitler PaketTaksit[];  faturalar PaketFatura[];  dagilimlar TaksitDagilim[];  kesintiler DagilimKesinti[]
}
model PaketTaksit {            // @@map("paket_taksit"), @@unique([paketId, taksitId]), @@index([taksitId])
  id; paketId → OdemePaketi; taksitId → Taksit
  aktif Boolean @default(true);  bolunsun Boolean @default(false)
  hesaplananTaksitSurumu Int?;  olusturmaZamani
}
model PaketFatura {            // @@map("paket_fatura"), @@unique([paketId, taksitId, kisiId])
  id; paketId → OdemePaketi; taksitId → Taksit; kisiId → Kisi
  faturaNo String;  faturaTarihi DateTime @db.Date;  olusturmaZamani / guncellemeZamani
}
model TaksitDagilim {          // @@map("taksit_dagilim"), @@index([paketId]), @@index([taksitId]), @@index([kisiId])
  id; paketId → OdemePaketi; taksitId → Taksit; sozlesmeMalikId → SozlesmeMalik
  kisiId → Kisi @relation("DagilimKisi");  odemeKisiId → Kisi @relation("DagilimOdemeKisi");  ibanId Int? → Iban?
  sira Int;  parca Int @default(0);  parcaBaslangic DateTime @db.Date;  parcaBitis DateTime @db.Date
  pay Int;  payda Int
  brut, kdv, stopaj Decimal(18,2);  kdvOrani, stopajOrani Decimal(9,4)
  damgaKesintisi, hacizKesintisi, kesinti22a Decimal(18,2) @default(0);  net Decimal(18,2)
  hesapGoruntusu Json;  olusturmaZamani
  kesintiler DagilimKesinti[]
}
model DagilimKesinti {         // @@map("dagilim_kesinti"), indeksler: paketId, hacizId, borcSorguId, damgaPayiId
  id; paketId → OdemePaketi; dagilimId → TaksitDagilim (onDelete: Cascade)
  tur KesintiTuru;  tutar Decimal(18,2)
  hacizId Int? → Haciz?;  borcSorguId Int? → BorcSorgu?;  damgaPayiId Int? → DamgaPayi?
  // üç kaynak ilişkisi de açıkça onDelete: Restrict (Prisma'nın isteğe bağlı ilişki varsayılanı SetNull'dur)
}
model BorcSorgu {              // @@map("borc_sorgu"), @@index([kisiId, gecerlilikBitis])
  id; kisiId → Kisi;  sorguTarihi DateTime @db.Date;  gecerlilikBitis DateTime @db.Date
  borcVar Boolean;  borcTutari Decimal(18,2) @default(0)
  vergiDairesi String?;  belgeNo String?;  belgeId Int?      // belge çok biçimli; FK yok (F1 kalıbı)
  olusturanId Int?;  olusturmaZamani
  kesintiler DagilimKesinti[]
}
model Haciz {                  // @@map("haciz"), @@index([kisiId, durum])
  id; kisiId → Kisi;  alacakli String;  dosyaNo String;  tebligTarihi DateTime @db.Date
  toplamTutar, kalanTutar Decimal(18,2);  durum HacizDurumu @default(AKTIF);  kapanisNedeni String?
  version Int @default(0);  olusturmaZamani / guncellemeZamani
  kesintiler DagilimKesinti[]
}
model DamgaKaydi {             // @@map("damga_kaydi"), @@index([sozlesmeId])
  id; sozlesmeId → Sozlesme;  olay DamgaOlayi;  olayTarihi DateTime @db.Date
  matrah Decimal(18,2);  oranBinde Decimal(9,4);  azami Decimal(18,2);  tutar Decimal(18,2)
  tahsil DamgaTahsil;  makbuzBelgeId Int?;  gerekce Json
  iptal Boolean @default(false);  iptalNedeni String?;  olusturanId Int?
  version Int @default(0);  olusturmaZamani / guncellemeZamani
  paylar DamgaPayi[]
}
model DamgaPayi {              // @@map("damga_payi"), @@unique([damgaKaydiId, kisiId])
  id; damgaKaydiId → DamgaKaydi (onDelete: Cascade); kisiId → Kisi
  pay Int;  payda Int;  tutar Decimal(18,2);  kalan Decimal(18,2);  version Int @default(0)
  kesintiler DagilimKesinti[]
}
// Taksit'e eklenenler:
//   sistemDisiOdeme Boolean @default(false) @map("sistem_disi_odeme")
//   odemeNotu String? @map("odeme_notu")
```

- [ ] **Step 2: Kısıt testlerini yaz (başarısız olmalı)**

`tests/integration/kisitlar-f2.test.ts`
- Her test `temizle()` ile başlar. Kurulum `hazirlik()` ile yapılır; ardından `ornekSozlesme` ile bir sözleşme ve onun bir `taksit` satırı (`prisma.taksit.create`) oluşturulur.
- Yardımcı `paket(durum)` önce satırı `TASLAK` olarak açar, sonra istenen duruma `update` ile geçirir. `KESINLESTI` için `hesapTarihi` ve `kesinlesmeZamani` de verilir.
- Her kısıt ihlali, hata iletisinde kısıt adının geçtiği bir istisna olarak doğrulanır (`kisitIhlaliMi(e, '<ad>')`).

```ts
it('dagilim_denklem: brüt + KDV − kesintiler ≠ net reddedilir')           // brut 100, stopaj 20, net 79
it('dagilim_net: net < 0 reddedilir')                                     // brut 10, stopaj 2, haciz 9, net -1
it('paket_taksit_aktif_tekil: aynı taksit iki aktif pakette olamaz; ilki aktif=false olunca eklenir') // ilki P2002
it('dagilim_degismez: KESINLESTI paketin dağılımı güncellenemez/silinemez; HESAPLANDI iken güncellenebilir')
it('dagilim_degismez: KESINLESTI pakete kesinti satırı eklenemez')
it('kesinti_kaynak: HACIZ türü haciz_id olmadan reddedilir')
it('haciz_tutar: kalan > toplam reddedilir')
it('damga_payi_kalan: kalan > tutar reddedilir')
it('damga_ilk_tekil: ikinci ILK reddedilir; ilki iptal=true ise eklenir')
it('borc_sorgu_tutar: borç yokken tutar > 0 reddedilir')
it('taksit_sistem_disi: sistem dışı ödeme yalnız ODENDI taksitte')
it('paket_kesinlesme: KESINLESTI paket kesinleşme zamanı olmadan reddedilir')
it('paket_taksit_kilitli: KESINLESTI pakete taksit eklenemez, paketten taksit silinemez')
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- kisitlar-f2`
Expected: FAIL. Hata: yeni Prisma modelleri yok (`prisma.odemePaketi` undefined) ya da tip hatası.

- [ ] **Step 4: Migrasyonun Prisma kısmını üret**

Run:
- `pnpm prisma migrate deploy` (geliştirme veritabanı `kbbkira` son migrasyonda olmalı);
- `mkdir -p prisma/migrations/20261017090000_odeme_paketi`;
- `pnpm prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261017090000_odeme_paketi/migration.sql`.

Expected: Dosyada yalnızca yeni `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE taksit ADD COLUMN` ve yeni yabancı anahtar ifadeleri bulunur.
- Mevcut nesnelere dokunan hiçbir `DROP` ya da `ALTER` satırı olmamalıdır. F1'in elle eklediği kısmi dizinleri ve kısıtları Prisma bilmez; bunları düşürmeye çalışan satırlar (ör. `DROP INDEX taksit_donem_tekil`, `artis_donem_tekil`) silinir.
- Bu bayrak kurulu Prisma'da yoksa ifadeler şemadan elle yazılır.

- [ ] **Step 5: Elle yazılan kısıtları migrasyonun sonuna ekle**

```sql
-- Dağılım denklemi ve sınırlar (spec §5.1)
ALTER TABLE taksit_dagilim ADD CONSTRAINT dagilim_net CHECK (net >= 0);
ALTER TABLE taksit_dagilim ADD CONSTRAINT dagilim_tutarlar CHECK (brut >= 0 AND kdv >= 0 AND stopaj >= 0
  AND damga_kesintisi >= 0 AND haciz_kesintisi >= 0 AND kesinti_22a >= 0);
ALTER TABLE taksit_dagilim ADD CONSTRAINT dagilim_denklem
  CHECK (brut + kdv - stopaj - damga_kesintisi - haciz_kesintisi - kesinti_22a = net);
ALTER TABLE taksit_dagilim ADD CONSTRAINT dagilim_hisse CHECK (pay > 0 AND payda > 0 AND pay <= payda);
ALTER TABLE taksit_dagilim ADD CONSTRAINT dagilim_parca CHECK (parca_bitis >= parca_baslangic);
ALTER TABLE dagilim_kesinti ADD CONSTRAINT kesinti_pozitif CHECK (tutar > 0);
ALTER TABLE dagilim_kesinti ADD CONSTRAINT kesinti_kaynak CHECK (
  (tur = 'HACIZ') = (haciz_id IS NOT NULL) AND (tur = 'KESINTI_22A') = (borc_sorgu_id IS NOT NULL)
  AND (tur = 'DAMGA') = (damga_payi_id IS NOT NULL));
ALTER TABLE borc_sorgu ADD CONSTRAINT borc_sorgu_tutar CHECK (borc_tutari >= 0 AND (borc_var OR borc_tutari = 0));
ALTER TABLE borc_sorgu ADD CONSTRAINT borc_sorgu_tarih CHECK (gecerlilik_bitis >= sorgu_tarihi);
ALTER TABLE haciz ADD CONSTRAINT haciz_tutar CHECK (toplam_tutar > 0 AND kalan_tutar >= 0 AND kalan_tutar <= toplam_tutar);
ALTER TABLE damga_kaydi ADD CONSTRAINT damga_tutar CHECK (matrah >= 0 AND tutar >= 0 AND tutar <= azami);
ALTER TABLE damga_payi ADD CONSTRAINT damga_payi_kalan CHECK (tutar >= 0 AND kalan >= 0 AND kalan <= tutar);
ALTER TABLE taksit ADD CONSTRAINT taksit_sistem_disi CHECK (NOT sistem_disi_odeme OR durum = 'ODENDI');
ALTER TABLE odeme_paketi ADD CONSTRAINT paket_vade CHECK (vade_bitis >= vade_baslangic);
ALTER TABLE odeme_paketi ADD CONSTRAINT paket_kesinlesme CHECK (durum IN ('TASLAK', 'HESAPLANDI', 'IPTAL')
  OR (kesinlesme_zamani IS NOT NULL AND hesap_tarihi IS NOT NULL));
ALTER TABLE odeme_paketi ADD CONSTRAINT paket_odeme_emri CHECK (durum NOT IN ('ODEME_EMRINDE', 'ODENDI')
  OR (muhasebe_odeme_emri_no IS NOT NULL AND muhasebe_odeme_emri_tarihi IS NOT NULL));
ALTER TABLE odeme_paketi ADD CONSTRAINT paket_odeme CHECK (durum <> 'ODENDI' OR odeme_tarihi IS NOT NULL);
ALTER TABLE odeme_paketi ADD CONSTRAINT paket_iptal CHECK (durum <> 'IPTAL' OR iptal_nedeni IS NOT NULL);

-- Bir taksit en çok bir aktif pakette (spec §5.2)
CREATE UNIQUE INDEX paket_taksit_aktif_tekil ON paket_taksit (taksit_id) WHERE aktif;
-- Sözleşme başına tek aktif ILK damga kaydı
CREATE UNIQUE INDEX damga_ilk_tekil ON damga_kaydi (sozlesme_id) WHERE olay = 'ILK' AND NOT iptal;

-- Kesinleşmiş paketin dağılımı ve kesintileri değişmez; taksit listesi de kilitlenir (spec §10.1-4)
CREATE FUNCTION paket_kilitli_mi(p integer) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT durum NOT IN ('TASLAK', 'HESAPLANDI') FROM odeme_paketi WHERE id = p $$;
CREATE FUNCTION dagilim_degismez() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF paket_kilitli_mi(CASE WHEN TG_OP = 'INSERT' THEN NEW.paket_id ELSE OLD.paket_id END) THEN
    RAISE EXCEPTION 'dagilim_degismez: kesinleşmiş paketin dağılımı değiştirilemez';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER taksit_dagilim_degismez BEFORE INSERT OR UPDATE OR DELETE ON taksit_dagilim
  FOR EACH ROW EXECUTE FUNCTION dagilim_degismez();
CREATE TRIGGER dagilim_kesinti_degismez BEFORE INSERT OR UPDATE OR DELETE ON dagilim_kesinti
  FOR EACH ROW EXECUTE FUNCTION dagilim_degismez();
CREATE FUNCTION paket_taksit_kilidi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF paket_kilitli_mi(CASE WHEN TG_OP = 'INSERT' THEN NEW.paket_id ELSE OLD.paket_id END) THEN
    RAISE EXCEPTION 'paket_taksit_kilitli: kesinleşmiş pakete taksit eklenemez ya da çıkarılamaz';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER paket_taksit_kilitli BEFORE INSERT OR DELETE ON paket_taksit
  FOR EACH ROW EXECUTE FUNCTION paket_taksit_kilidi();
```

- [ ] **Step 6: Uygula ve testleri çalıştır**

Run: `pnpm prisma migrate deploy && pnpm prisma generate && pnpm typecheck && pnpm test:integration -- kisitlar-f2`
Expected: PASS (13 test). Ardından tüm paketi çalıştır: `pnpm test:integration`. Expected: F1'in 508 testi de geçer.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261017090000_odeme_paketi tests/integration/kisitlar-f2.test.ts
git commit -m "feat(db): ödeme paketi, dağılım, 22/A, haciz ve damga tabloları"
```

---

### Task 2: K3+K4 taksit dağılımı (`src/core/hesap/dagilim.ts`)

**Files:**
- Create: `src/core/hesap/dagilim.ts`
- Test: `tests/unit/core/dagilim.test.ts`

**Interfaces:**
- Consumes:
  - `hisseyeDagit(toplamKurus: bigint, hisseler: readonly Hisse[]): Sonuc<HissePayi[]>` (`@/core/hisse`);
  - `malikTutari(g: MalikTutariGirdi): MalikTutari` (`@/core/hesap/vergi`);
  - `kurusaCevir`, `kurustanPara` (`@/core/para`); `gunFarki`, `karsilastir` (`@/core/tarih`).
- Produces:

```ts
export interface DagilimMaligi extends Hisse {          // Hisse: { kisiId: string; pay: number; payda: number }
  sozlesmeMalikId: string
  odemeKisiId: string
  ibanId: string | null
  stopajOrani: Para                                       // yüzde (20 = %20)
  kdvOrani: Para
}
export interface DagilimParcasi { baslangic: Tarih; bitis: Tarih; malikler: readonly DagilimMaligi[] }
export interface TaksitDagilimGirdisi { tutar: Para; bedelTuru: BedelTuru; parcalar: readonly DagilimParcasi[] }
export interface DagilimSatiri {
  parca: number; parcaBaslangic: Tarih; parcaBitis: Tarih
  kisiId: string; sozlesmeMalikId: string; odemeKisiId: string; ibanId: string | null
  pay: number; payda: number
  payTutari: Para        // taksit tutarından bu malike düşen pay (BRUT'ta brüt, NET'te net)
  brut: Para; kdv: Para; stopaj: Para; stopajOrani: Para; kdvOrani: Para
  odenecek: Para         // brut + kdv − stopaj (kesinti öncesi)
  satirlar: HesapSatiri[]
}
export function taksitDagilimi(g: TaksitDagilimGirdisi): Sonuc<DagilimSatiri[]>
```

**Algoritma:**
1. **Doğrulama:** `tutar` negatif ya da kuruştan küçük kesirli olamaz. Parça listesi boş olamaz. Parçalar sıralı, çakışmasız ve her biri `bitis >= baslangic` olmalıdır. Aksi halde `GECERSIZ_GIRDI` döner.
2. **Parçalara bölme:** Tek parça varsa tutarın tamamı o parçaya gider. Birden çok parça varsa kuruş tutarı parçaların gün sayılarıyla (`gunFarki + 1`) Hamilton yöntemiyle bölünür. Bunun için `hisseyeDagit` çağrılır; her parça bir `Hisse` olur: `kisiId = String(sira + 1)`, `pay = gün`, `payda = toplam gün`.
3. **Malik paylarına bölme:** Her parçanın tutarı, parçanın malik setine `hisseyeDagit` ile dağıtılır. Bu adımın hatası (`HISSE_TOPLAMI_HATALI` vb.) aynen döndürülür.
4. **Vergiler:** Her pay için `malikTutari({ tutar: payTutari, bedelTuru, stopajOrani, kdvOrani })` çağrılır. Sonucun `net` alanı `odenecek` olarak kullanılır.
5. **Hesap izi:** `satirlar` = K3 satırları ("Parça payı (gün oranı)" yalnızca parça > 1 ise; "Hisse payı (en büyük kalan)") + `malikTutari` satırları.
6. **Çıktı sırası:** önce parça (artan), sonra `kisiId` (sayısal, artan).

- [ ] **Step 1: Başarısız testleri yaz**

`tests/unit/core/dagilim.test.ts`. Ortak varsayımlar:
- Yardımcı `m(kisiId, pay, payda, stopaj, kdv='0')`.
- Para değerleri `para('…')` ile kurulur; karşılaştırmalar `.toFixed(2)` ile yapılır.

```ts
it('tek malik GMSİ brüt 10.000,00 → stopaj 2.000,00, ödenecek 8.000,00')
it('üç eşit hisse 100,00 → 33,34 / 33,33 / 33,33; artık kuruş en küçük kişi kimliğine')
  // stopaj 6,67 / 6,67 / 6,67; ödenecek 26,67 / 26,66 / 26,66
it('NET sözleşme 7/24 + 17/24, 1.000,00 → net payı 291,67 / 708,33; brüt 364,59 / 885,41; stopaj 72,92 / 177,08')
it('şirket KDV %20: 10.000,00 → KDV 2.000,00, stopaj 0, ödenecek 12.000,00')
it('iki parça (10 + 21 gün), 3.100,00 → 1.000,00 (A) ve 2.100,00 (B); satırlar parça sırasıyla')
it('iki parça (10 + 21 gün), 1.000,00 → 322,58 / 677,42 (artık büyük kalanlı parçaya)')
it('boş parça listesi, çakışan parçalar, negatif tutar ve 3 ondalıklı tutar GECERSIZ_GIRDI')
it('hisse toplamı 1 değilse HISSE_TOPLAMI_HATALI')
it('özellik: Σ payTutari = tutar; BRUT ise Σ brut = tutar; NET ise Σ (brut − stopaj) = tutar')
it('özellik: her satırda odenecek = brut + kdv − stopaj ve odenecek ≥ 0; aynı girdi aynı çıktı')
```

Özellik testleri `fast-check` ile yazılır. Üreteçler:
- tutar: 0–10.000.000 kuruş;
- malik sayısı: 1–6, paydalar ortak bölünmüş;
- parça sayısı: 1–3, gün sayısı 1–31;
- stopaj: {0, 20}, KDV: {0, 20}.

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/dagilim.test.ts`
Expected: FAIL. Hata: `Cannot find module '@/core/hesap/dagilim'`.

- [ ] **Step 3: `taksitDagilimi` fonksiyonunu yaz**

Algoritma yukarıdadır. `Number` ve `Math` kullanılmaz; gün sayıları `BigInt(gunFarki(...) + 1)` ile bigint'e çevrilir.

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm vitest run tests/unit/core/dagilim.test.ts && pnpm exec stryker run --mutate src/core/hesap/dagilim.ts`
Expected: PASS; mutasyon skoru ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/hesap/dagilim.ts tests/unit/core/dagilim.test.ts
git commit -m "feat(hesap): K3+K4 taksit dağılımı (parçalı, NET brütleştirme)"
```

---

### Task 3: K5 damga vergisi (`src/core/hesap/damga.ts`)

**Files:**
- Create: `src/core/hesap/damga.ts`
- Test: `tests/unit/core/damga.test.ts`

**Interfaces:**
- Consumes: `odemeDonemleri` (`@/core/takvim`), `taksitTutari` (`@/core/hesap/taksit-tutari`), `hisseyeDagit`, `malikTutari`.
- Produces:

```ts
export interface DamgaTutariGirdisi { matrah: Para; oranBinde: Para; azami: Para }
export interface DamgaTutari { tutar: Para; azamiUygulandi: boolean; satirlar: HesapSatiri[] }
/** tutar = min(ROUND_HALF_UP(matrah × oranBinde / 1000), azami) — spec §6.7 */
export function damgaTutari(g: DamgaTutariGirdisi): DamgaTutari

export interface IlkDamgaMatrahiGirdisi {
  baslangic: Tarih; bitis: Tarih | null; suresizAy: number
  periyotAy: OdemePeriyodu; kist: KistYontemi
  bedel: Para; taban: BedelTabani; bedelTuru: BedelTuru
  malikler: readonly (Hisse & { stopajOrani: Para })[]    // yalnız NET sözleşmede brütleştirme için
}
/**
 * Sözleşme süresince ilk bedelle hesaplanan toplam BRÜT kira (KDV hariç). Süresizde [baslangic, ayEkle(baslangic, suresizAy) − 1].
 * Dönemler `odemeDonemleri`, tutarlar tek kira dönemli `taksitTutari` (kıst kuralı dahil).
 * NET'te her dönem tutarı `hisseyeDagit` ile bölünür; her payın brütü `malikTutari` ile bulunur ve toplanır.
 */
export function ilkDamgaMatrahi(g: IlkDamgaMatrahiGirdisi): Sonuc<{ matrah: Para; donemSayisi: number; satirlar: HesapSatiri[] }>
export function damgaPaylari(tutar: Para, malikler: readonly Hisse[]): Sonuc<{ kisiId: string; pay: number; payda: number; tutar: Para }[]>
```

- [ ] **Step 1: Başarısız testleri yaz**

```ts
it('120.000,00 × binde 1,89 = 226,80')
it('2.645,50 × binde 1,89 = 4,999995 → 5,00 (yarım yukarı; aşağı yuvarlama 4,99 verirdi)')
it('azami: 20.000.000.000,00 matrah → 29.115.961,10, azamiUygulandi true')
it('ILK aylık 10.000 brüt, 2026-01-01–2026-12-31, aylık → matrah 120.000,00, 12 dönem')
it('ILK kıst: 2026-01-15–2026-12-31 aylık 10.000 → 115.483,87 (11 tam ay + 17/31)')
it('ILK süresiz (bitis null, 12 ay) → 120.000,00')
it('ILK yıllık 120.000, üç aylık ödeme → 120.000,00')
it('ILK NET aylık 8.000, tek malik %20 → matrah 120.000,00 (brüt); stopajsız malikte 96.000,00')
it('damgaPaylari 226,80 → 1/3 × 3 = 75,60; 100,01 → 1/2 + 1/2 = 50,01 (kişi 1) / 50,00')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/damga.test.ts`
Expected: FAIL, modül yok.

- [ ] **Step 3: `damgaTutari`, `ilkDamgaMatrahi` ve `damgaPaylari` fonksiyonlarını yaz**

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm vitest run tests/unit/core/damga.test.ts && pnpm exec stryker run --mutate src/core/hesap/damga.ts`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/hesap/damga.ts tests/unit/core/damga.test.ts
git commit -m "feat(hesap): K5 damga vergisi (ILK matrahı, azami, malik payları)"
```

---

### Task 4: Kesintiler — damga, haciz, 22/A (`src/core/hesap/kesinti.ts`)

**Files:**
- Create: `src/core/hesap/kesinti.ts`
- Test: `tests/unit/core/kesinti.test.ts`

**Interfaces:**
- Produces:

```ts
export type KesintiTuru = 'DAMGA' | 'HACIZ' | 'KESINTI_22A'
export interface KesintiSatiri { anahtar: string; sozlesmeId: string; kisiId: string; vade: Tarih; odenecek: Para }
export interface DamgaKalani { damgaPayiId: string; sozlesmeId: string; kisiId: string; olayTarihi: Tarih; kalan: Para }
export interface HacizKalani { hacizId: string; kisiId: string; tebligTarihi: Tarih; kalan: Para }
/** Sunucu kişi başına en çok bir geçerli sorgu verir; kalanBorc = borcTutari − kesinleşmiş paketlerdeki kullanım. */
export interface GecerliSorgu { borcSorguId: string; kisiId: string; borcVar: boolean; borcTutari: Para; kalanBorc: Para }
export interface KesintiGirdisi {
  satirlar: readonly KesintiSatiri[]
  damgalar: readonly DamgaKalani[]; hacizler: readonly HacizKalani[]; sorgular: readonly GecerliSorgu[]
  esik22aOdeme: Para; esik22aBorc: Para
}
export interface UygulananKesinti { satirAnahtari: string; tur: KesintiTuru; tutar: Para; kaynakId: string }
export interface SatirKesintisi { anahtar: string; damga: Para; haciz: Para; kesinti22a: Para; net: Para; satirlar: HesapSatiri[] }
export interface Alici22a { kisiId: string; odenecek: Para; sorguGerekli: boolean; borcSorguId: string | null; kesinti: Para }
export interface KesintiHesabi { kesintiler: UygulananKesinti[]; satirlar: SatirKesintisi[]; alicilar: Alici22a[] }
export function kesintiHesabi(g: KesintiGirdisi): KesintiHesabi
```

**Algoritma** (spec §6.5, §6.5.1, §6.5.2). Girdinin sırası sonucu değiştirmez; her şey içeride sıralanır.
1. Satırlar `(vade, anahtar)` sırasıyla işlenir.
2. **Damga:** Satırın `(sozlesmeId, kisiId)` damga payları `(olayTarihi, damgaPayiId sayısal)` sırasıyla alınır. Her biri kendi kalanı ve satırın kullanılabilir tutarı kadar kesilir. Kalanlar satırlar arasında taşınır (spec §6.7 devir).
3. **Haciz:** Kişinin hacizleri `(tebligTarihi, hacizId)` sırasıyla, damgadan sonra kalan tutardan, her haczin kalanına kadar kesilir.
4. **22/A ödenecek tutarı:** Kişi başına `odenecek22 = Σ (odenecek − damga − haciz)`. `sorguGerekli = odenecek22 > esik22aOdeme` (kesin büyük).
5. **22/A kesintisi:** `sorguGerekli` ise ve kişinin geçerli sorgusu varsa, `borcVar` ve `borcTutari > esik22aBorc` koşullarında `kesinti = min(kalanBorc, odenecek22)` uygulanır. Kesinti kişinin satırlarına aynı sırayla, her satırın kalanına kadar dağıtılır. Eşik altında sorgu ve borç olsa da kesinti yapılmaz.
6. **Kayıt:** Tutarı 0 olan kesinti kaydı yazılmaz. `alicilar` listesi satırlardaki her kişiyi içerir ve `kisiId` sayısal artan sıradadır.
7. **Hesap izi:** `satirlar[*].satirlar`, kesinti başına bir `HesapSatiri` taşır: kural `'K4'`, açıklama `'Damga kesintisi (istihkaktan)'`, `'Haciz kesintisi'` ya da `'6183 md. 22/A kesintisi'`.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
it('damga: ödenecek 8.000,00, kalan 226,80 → damga 226,80, net 7.773,20')
it('damga devri: ödenecek 100,00, kalan 226,80 → damga 100,00, net 0,00')
it('damga yalnız aynı sözleşmenin satırından kesilir')
it('haciz tebliğ sırası: kalanlar 3.000 ve 10.000, ödenecek 8.000 → 3.000 + 5.000, net 0')
it('22/A eşiği: kişi toplamı 5.000,00 → sorgu gerekmez; 5.000,01 → gerekir')
it('22/A: ödenecek 8.000, borç 6.000 → kesinti 6.000, net 2.000')
it('22/A borç eşiği: borç 5.000,00 → kesinti yok')
it('22/A kalan borç: borç 8.000, kalan 3.000 → kesinti 3.000')
it('22/A iki satır (vade 10-01 ve 11-01, 4.000 + 4.000), borç 6.000 → 4.000 ve 2.000')
it('22/A sorgu yok → sorguGerekli true, borcSorguId null, kesinti yok')
it('22/A eşik altı: sorgu ve borç olsa da kesinti yok')
it('22/A eşiği damga ve hacizden sonra: ödenecek 6.000, haciz 1.500 → 4.500 → gerekmez')
it('özellik: satır başına damga + haciz + 22A ≤ odenecek, net = odenecek − kesintiler ≥ 0')
it('özellik: damga payı ve haciz başına Σ kesinti ≤ kalan; kişi başına 22A ≤ min(kalanBorc, odenecek22)')
it('özellik: girdi sırası karıştırılınca sonuç aynı')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/kesinti.test.ts`
Expected: FAIL, modül yok.

- [ ] **Step 3: `kesintiHesabi` fonksiyonunu yaz**

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm vitest run tests/unit/core/kesinti.test.ts && pnpm exec stryker run --mutate src/core/hesap/kesinti.ts`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/hesap/kesinti.ts tests/unit/core/kesinti.test.ts
git commit -m "feat(hesap): damga, haciz ve 22/A kesintileri"
```

---

### Task 5: Paket hesabı ve ön kontrol (`src/core/paket/hesap.ts`, `on-kontrol.ts`)

**Files:**
- Create: `src/core/paket/on-kontrol.ts`, `src/core/paket/hesap.ts`
- Modify: `eslint.config.mjs` (hesap kuralı dosya listesine `src/core/paket/**/*.ts` ve `src/core/rapor/**/*.ts`)
- Test: `tests/unit/core/paket-hesap.test.ts`

**Interfaces:**
- Consumes: `taksitDagilimi` (Task 2), `kesintiHesabi` ve türleri (Task 4), `UyumUyarisi` (`@/core/uyum`).
- Produces:

```ts
// on-kontrol.ts
export type HataKoduPaket = 'BOS_PAKET' | 'TAKSIT_DURUMU' | 'MALIK_YOK' | 'HISSE_TOPLAMI' | 'HESAP_HATASI'
  | 'IBAN_YOK' | 'ARTIS_BEKLIYOR' | 'FATURA_YOK' | 'SORGU_22A_YOK'
export type UyariKoduPaket = 'MALIK_DEGISIKLIGI' | 'STATU_TEYIT' | 'MUHSGK_KODU_YOK' | 'ODENEK_YETERSIZ' | 'UYUM' | 'IDARE_VKN_YOK'
  | 'DAMGA_KESINTISI'
export interface Bulgu { kod: HataKoduPaket | UyariKoduPaket; mesaj: string; taksitId?: string; kisiId?: string; sozlesmeId?: string }
export interface OnKontrolSonucu { hatalar: Bulgu[]; uyarilar: Bulgu[] }

// hesap.ts
export interface MalikDonemi {
  sozlesmeMalikId: string; kisiId: string; kisiAdi: string; pay: number; payda: number
  odemeKisiId: string; ibanId: string | null; ibanUygun: boolean
  gecerlilikBaslangic: Tarih; gecerlilikBitis: Tarih | null
  stopajOrani: Para; kdvOrani: Para; kdvli: boolean; stopajli: boolean; muhsgkKodu: string | null
  teyitGerekli: boolean; statuTeyitli: boolean
}
export interface PaketTaksitGirdisi {
  taksitId: string; sozlesmeId: string; sozlesmeNo: string; durum: string
  donemBaslangic: Tarih; donemBitis: Tarih; vade: Tarih; tutar: Para; bedelTuru: BedelTuru
  artisBekliyor: boolean; bolunsun: boolean
  malikDonemleri: readonly MalikDonemi[]
  uyumUyarilari: readonly UyumUyarisi[]
}
export interface PaketHesapGirdisi {
  taksitler: readonly PaketTaksitGirdisi[]
  damgalar: readonly DamgaKalani[]; hacizler: readonly HacizKalani[]; sorgular: readonly GecerliSorgu[]
  esik22aOdeme: Para; esik22aBorc: Para
  faturalar: ReadonlySet<string>          // `${taksitId}:${kisiId}`
  kalanOdenek: Para | null
  idareVknVar: boolean
}
export interface MalikParcasi { baslangic: Tarih; bitis: Tarih; malikler: readonly MalikDonemi[] }
export function malikParcalari(t: Pick<PaketTaksitGirdisi, 'donemBaslangic' | 'donemBitis' | 'vade' | 'bolunsun' | 'malikDonemleri'>):
  { parcalar: MalikParcasi[]; degisiklikVar: boolean }
export interface PaketSatiri extends DagilimSatiri {
  anahtar: string                          // `${taksitId}:${parca}:${kisiId}`
  taksitId: string; sozlesmeId: string; vade: Tarih
  damga: Para; haciz: Para; kesinti22a: Para; net: Para
  muhsgkKodu: string | null
}
export interface PaketToplami { brut: Para; kdv: Para; stopaj: Para; damga: Para; haciz: Para; kesinti22a: Para; net: Para; gider: Para }
export interface PaketHesabi {
  satirlar: PaketSatiri[]; kesintiler: UygulananKesinti[]; alicilar: Alici22a[]
  toplam: PaketToplami; onKontrol: OnKontrolSonucu
}
export function paketHesabi(g: PaketHesapGirdisi): PaketHesabi
```

**`malikParcalari` kuralları:**
- **`degisiklikVar`:** `[donemBaslangic, max(donemBitis, vade)]` aralığında geçerli malik kayıtlarının kümesi (`sozlesmeMalikId` kümesi) herhangi bir günde değişiyorsa `true`.
- **Bölünmemiş taksit:** Tek parça `[donemBaslangic, donemBitis]` oluşur. Malikleri bakış gününde geçerli olan kayıtlardır.
  - Bakış günü `enBuyukTarih(vade, donemBaslangic)`'tır.
  - Peşin `AYIN_GUNU` vadesi dönem başından önce düşebilir (ay ortası başlangıç). Bu durumda sözleşme başlamadan önceki gün malik bulunamaz; alt sınır bu yüzden konur.
- **Bölünmüş taksit (`bolunsun`):** `[donemBaslangic, donemBitis]` aralığı şu günlerde kesilir:
  - aralık içindeki her `gecerlilikBaslangic`;
  - aralık içindeki her `gecerlilikBitis + 1`.
- Her kesimde o parçanın ilk gününde geçerli kayıtlar kullanılır. Aynı kümeye sahip ardışık parçalar birleştirilir.

**`paketHesabi` kuralları.** Mesajlar Türkçe ve eyleme dönüktür; sözleşme numarasını ve kişi adını içerir.
- **Paket ve taksit düzeyi:**
  - Taksit yoksa `BOS_PAKET` hatası verilir.
  - `durum !== 'PLANLANDI'` olan taksit için `TAKSIT_DURUMU` hatası verilir ve taksit atlanır.
  - Bir parçada malik yoksa `MALIK_YOK` hatası verilir ve taksit atlanır.
  - `taksitDagilimi` hata dönerse kod `HISSE_TOPLAMI_HATALI` ise `HISSE_TOPLAMI`, diğer kodlarda `HESAP_HATASI` hatası verilir ve taksit atlanır.
  - `artisBekliyor` ise `ARTIS_BEKLIYOR` hatası verilir, ama satırlar yine hesaplanır (önizleme için).
- **Malik düzeyi** (kullanılan her parça malikinde):
  - `!ibanUygun` → `IBAN_YOK` hatası.
  - `kdvli` olup `faturalar` içinde o taksit ve kişi için kayıt yoksa → `FATURA_YOK` hatası.
  - `teyitGerekli && !statuTeyitli` → `STATU_TEYIT` uyarısı (kişi başına bir kez).
  - `stopajli && muhsgkKodu === null` → `MUHSGK_KODU_YOK` uyarısı (kişi başına bir kez).
- **Diğer uyarılar:**
  - `degisiklikVar && !bolunsun` → `MALIK_DEGISIKLIGI` uyarısı (taksit başına).
  - Her `uyumUyarilari` öğesi `UYUM` uyarısı olur; sözleşme ve uyum kodu başına bir kez.
  - `kalanOdenek !== null && toplam.gider > kalanOdenek` → `ODENEK_YETERSIZ` uyarısı.
  - `!idareVknVar` → `IDARE_VKN_YOK` uyarısı.
  - DAMGA türü kesinti uygulanan her sözleşme için `DAMGA_KESINTISI` uyarısı (sözleşme başına bir kez). Metin: "<no>: damga vergisi <tutar> istihkaktan kesiliyor. Damga sistem dışında ödendiyse Damga sekmesinden kaydı iptal edip yeniden hesaplayın."
- **22/A:** Kesintiler, başarılı satırlardan kurulan `KesintiSatiri` listesiyle hesaplanır. `alicilar` içinde `sorguGerekli && borcSorguId === null` olan her kişi için `SORGU_22A_YOK` hatası verilir (`kisiId` ile).
- **Toplam ve sıra:** `toplam.gider = Σ (brut + kdv)`. Satırlar şu sırayla dizilir: vade, sözleşme no, taksit kimliği (sayısal), parça, kişi kimliği (sayısal).

- [ ] **Step 1: Başarısız testleri yaz**

`tests/unit/core/paket-hesap.test.ts`. Yardımcılar:
- `md(kisiId, pay, payda, ek?)`: `MalikDonemi`. Varsayılanlar: GMSİ, %20 stopaj, `ibanUygun: true`, `gecerlilikBaslangic` 2026-01-01.
- `tk(id, ek?)`: Mart 2026 taksiti. Değerler: dönem 2026-03-01–31, vade 03-01, tutar 3.100,00.

```ts
it('vade günü malik seti: A 03-10 bitiyor, B 03-11 başlıyor, vade 03-01 → tek parça A, MALIK_DEGISIKLIGI uyarısı')
it('böl: aynı senaryo bolunsun=true → A 1.000,00 (03-01–10) + B 2.100,00 (03-11–31), uyarı yok')
it('IBAN_YOK hata; KDVli malik (SIRKET) faturasız FATURA_YOK, faturalı hatasız')
it('ARTIS_BEKLIYOR hata ama satırlar hesaplanır')
it('TAKSIT_DURUMU: PAKETTE taksit atlanır, diğer taksit hesaplanır')
it('HISSE_TOPLAMI: tek malik 1/2 → taksit atlanır')
it('SORGU_22A_YOK: GMSİ 10.000 (ödenecek 8.000) sorgusuz hata; 6.000 (ödenecek 4.800) hatasız')
it('aynı kişinin iki sözleşmeden satırları 22/A için toplanır: 4.000 + 4.000 > 5.000 → hata')
it('ODENEK_YETERSIZ: gider 10.000,00, kalan 9.999,99 uyarı; 10.000,00 uyarı yok')
it('STATU_TEYIT ve MUHSGK_KODU_YOK (VAKIF_DERNEK) kişi başına bir kez; UYUM sözleşme başına')
it('IDARE_VKN_YOK uyarısı; BOS_PAKET hatası')
it('DAMGA_KESINTISI: damga payı kesilen sözleşme için bir uyarı; damga yoksa uyarı yok')
it('bakış günü: dönem 2026-01-15–02-14, vade 2026-01-10 (AYIN_GUNU), malik 01-15 te başlıyor → MALIK_YOK değil, malik bulunur')
it('toplamlar ve satır sırası: vade, sözleşme no, taksit, parça, kişi; anahtarlar benzersiz')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/paket-hesap.test.ts`
Expected: FAIL, modül yok.

- [ ] **Step 3: `malikParcalari` ve `paketHesabi` fonksiyonlarını yaz; ESLint listesini genişlet**

- [ ] **Step 4: Testleri, lint'i ve mutasyonu çalıştır**

Run: `pnpm vitest run tests/unit/core/paket-hesap.test.ts && pnpm lint && pnpm exec stryker run --mutate "src/core/paket/**/*.ts"`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/paket/on-kontrol.ts src/core/paket/hesap.ts eslint.config.mjs tests/unit/core/paket-hesap.test.ts
git commit -m "feat(paket): paket hesabı, malik parçaları ve ön kontrol"
```

---

### Task 6: 22/A borç sorgusu ve haciz kayıtları

**Files:**
- Create: `src/server/kesinti/sema.ts`, `src/server/kesinti/servis.ts`, `src/app/(uygulama)/kisiler/[id]/kesinti-formlari.tsx`
- Modify: `src/app/(uygulama)/kisiler/[id]/page.tsx`, `src/app/(uygulama)/kisiler/actions.ts`, `src/server/parametre/servis.ts` (`TAMSAYI_PARAMETRELERI` += `SURE_22A_GECERLILIK_GUN`)
- Test: `tests/integration/kesinti.test.ts`

**Interfaces:**
- Consumes: `tatilKumesi(bas, bit, db)`, `parametreTamsayi`, `denetimKaydi`, `BelgeYukle` (`tamam(id)` geri çağrısı, `belgeTuru` sabit).
- Produces:

```ts
// sema.ts
export const borcSorguSemasi: z.ZodType<BorcSorguGirdisi>
export interface BorcSorguGirdisi {
  kisiId: number; sorguTarihi: Tarih; borcVar: boolean; borcTutari: Para | null
  vergiDairesi: string | null; belgeNo: string | null; belgeId: number | null
}
export const hacizSemasi: z.ZodType<HacizGirdisi>
export interface HacizGirdisi { kisiId: number; alacakli: string; dosyaNo: string; tebligTarihi: Tarih; toplamTutar: Para }
// servis.ts
export async function borcSorguEkle(g: BorcSorguGirdisi, baglam: IslemBaglami, bugun?: Tarih): Promise<number>
export async function borcSorguSil(id: number, baglam: IslemBaglami): Promise<void>
/** sorguTarihi ≤ gun ≤ gecerlilikBitis; en son sorguTarihi, eşitse en büyük id. */
export async function gecerliSorgu(db: Tx, kisiId: number, gun: Tarih): Promise<BorcSorgu | null>
/** KESINLESTI / ODEME_EMRINDE / ODENDI paketlerdeki KESINTI_22A toplamı (sorgu kimliği → tutar); haricPaketId hariç. */
export async function sorguKullanimi(db: Tx, borcSorguIdleri: readonly number[], haricPaketId?: number): Promise<Map<number, Para>>
export async function hacizEkle(g: HacizGirdisi, baglam: IslemBaglami, bugun?: Tarih): Promise<number>
export async function hacizKapat(id: number, version: number, neden: string, baglam: IslemBaglami): Promise<void>
export interface SorguGorunumu { id: number; sorguTarihi: Tarih; gecerlilikBitis: Tarih; gecerli: boolean; borcVar: boolean; borcTutari: string; vergiDairesi: string | null; belgeNo: string | null; belgeId: number | null; kullanildi: boolean }
export interface HacizGorunumu { id: number; version: number; alacakli: string; dosyaNo: string; tebligTarihi: Tarih; toplamTutar: string; kalanTutar: string; durum: 'AKTIF' | 'KAPANDI'; kapanisNedeni: string | null }
export async function kisiKesintileri(kisiId: number, bugun: Tarih): Promise<{ sorgular: SorguGorunumu[]; hacizler: HacizGorunumu[] }>
```

**Kurallar:**
- **Geçerlilik bitişi:** `sonrakiIsGunu(gunEkle(sorguTarihi, SURE_22A_GECERLILIK_GUN), tatiller)`. Yasal son gün tatile denk gelirse sonraki iş gününe kayar (spec §7.2).
- **Sorgu tarihi:** `sorguTarihi > bugün` reddedilir (`IsKuraliHatasi`, alan `sorguTarihi`).
- **Borç tutarı:** `borcVar` false ise `borcTutari` 0 kaydedilir; true ise `> 0` zorunludur (alan `borcTutari`).
- **Bağlı belge:** `belgeId` verilmişse belge kaydı `sahipTur='kisi'`, `sahipId=kisiId` ve `belgeTuru='BORC_YAZISI'` olmalıdır; değilse alan `belgeId` için hata verilir.
- **Sorgu silme:** `borcSorguSil` iki koşul birlikte sağlanıyorsa çalışır:
  - hiçbir `dagilim_kesinti` satırı sorguya bağlı değildir (iptal edilmiş paketler dahil; yabancı anahtar da korur);
  - sorgunun kimliği iptal edilmemiş hiçbir paketin `hesapParmakIzi.sorgular` ya da `onKontrol.alicilar22a[].borcSorguId` alanında geçmez.
  - İkinci koşulun nedeni: borç yok sorgusu hiç kesinti satırı taşımaz, ama ödeme emri denetimi ve ek listesi ona dayanır.
  - Arama JSON alanları üzerinde yapılır (jsonb operatörüyle ya da paketleri okuyup uygulamada).
  - Aksi halde ileti: "Bu sorgu bir ödeme paketinde kullanıldı; silinemez."
  - `SorguGorunumu.kullanildi` aynı kurala göre hesaplanır.
- **Haciz kaydı:** `toplamTutar > 0` olmalıdır ve `kalanTutar = toplamTutar` ile başlar. `tebligTarihi ≤ bugün` olmalıdır. Formda `alacakli` alanının etiketi "Kesintinin gönderileceği daire (icra/vergi dairesi)"dir; föyde kesinti kurumu olarak bu alan yazılır.
- **Haciz kapatma:**
  - `hacizKapat` yalnızca AKTIF hacizde çalışır; neden 1–500 karakterdir.
  - Sürüm koşullu güncelleme yapılır; uyuşmazlıkta `CakismaHatasi`.
  - Kapalı haciz yeni hesaplarda kullanılmaz.
- **Denetim:**
  - Satırlar `varlik: 'borc_sorgu' | 'haciz'` ile yazılır.
  - Sonra alanına kimlikler, tarihler, tutarlar ve `borcVar` yazılır.
  - Kişi adı, kimlik numarası ve vergi dairesi metni yazılmaz.
- **Arayüz** (kişi detay sayfasında iki yeni kart):
  - **"22/A borç sorguları":**
    - Tablo sütunları: sorgu tarihi, geçerlilik bitişi (`geçerli` ya da `süresi doldu` rozeti), borç var/yok, tutar, vergi dairesi, belge no, belge bağlantısı.
    - Ekleme formu `BelgeYukle sahipTur="kisi" belgeTuru="BORC_YAZISI"` bileşenini içerir; yüklenen belgenin kimliği gizli `belgeId` alanına yazılır.
    - Kullanılmamış sorgu için "Sil" düğmesi bulunur.
  - **"Hacizler":** tablo, ekleme formu ve satır başına "Kapat" formu (neden alanıyla).
  - Action'lar F1 kalıbını izler: `kullaniciGerekli`, zod ayrıştırma, servis çağrısı, `revalidatePath`, `eylemSonrasiHatirlatmalariTazele`.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/integration/kesinti.test.ts`. Kurulum `hazirlik()` ile yapılır. Tohum tatil listesinde 2026-10-29 Cumhuriyet Bayramı bulunur.

```ts
it('geçerlilik bitişi: 2026-10-01 + 15 = 2026-10-16 (cuma)')
it('geçerlilik bitişi tatile denk gelirse sonraki iş günü: 2026-10-14 → 2026-10-29 tatil → 2026-10-30')
it('borç yok → tutar 0; borç var ve tutar boş → IsKuraliHatasi (alan borcTutari); ileri tarihli sorgu reddedilir')
it('gecerliSorgu: aynı gün iki sorgu → son eklenen; süresi dolmuş sorgu dönmez; sorgu tarihinden önceki gün dönmez')
it('belge başka kişiye aitse ya da türü BORC_YAZISI değilse reddedilir')
it('sorguKullanimi yalnız KESINLESTI/ODEME_EMRINDE/ODENDI paketleri sayar; haricPaketId hariç tutulur')
it('borcSorguSil: kesinti satırına bağlı sorgu silinmez; HESAPLANDI paketin alicilar22a sında geçen borç yok sorgusu silinmez; bağsız sorgu silinir')
it('hacizEkle: kalan = toplam; hacizKapat sürüm çakışmasında CakismaHatasi; kapalı haciz ikinci kez kapatılamaz')
it('denetim satırlarında ad, TCKN ve vergi dairesi metni yok')
```

Paket ve kesinti satırı gereken testler satırları doğrudan `prisma` ile kurar. Önce paket `HESAPLANDI` iken dağılım ve kesinti satırı eklenir. Sonra paket durumu, `hesapTarihi` ve `kesinlesmeZamani` ile birlikte güncellenir. Bunun için `paket-yardimci.ts` Task 8'de gelir; bu testte kendi küçük yardımcısını kullanın.

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- kesinti`
Expected: FAIL, modül yok.

- [ ] **Step 3: Şemaları, servisi, kişi sayfası kartlarını ve action'ları yaz**

- [ ] **Step 4: Testleri ve tüm kontrolleri çalıştır**

Run: `pnpm test:integration -- kesinti && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kesinti src/server/parametre/servis.ts "src/app/(uygulama)/kisiler" tests/integration/kesinti.test.ts
git commit -m "feat(kesinti): 22/A borç sorgusu ve haciz kayıtları"
```

---

### Task 7: Damga kayıtları

**Files:**
- Create: `src/server/damga/sema.ts`, `src/server/damga/servis.ts`, `src/app/(uygulama)/sozlesmeler/[id]/sekmeler/damga.tsx`
- Modify:
  - `src/server/sozlesme/servis.ts` (`sozlesmeAktiflestir`);
  - `src/server/parametre/servis.ts` (`TAMSAYI_PARAMETRELERI` += `DAMGA_SURESIZ_AY`);
  - `src/app/(uygulama)/sozlesmeler/[id]/page.tsx` (yeni "Damga" sekmesi);
  - `src/app/(uygulama)/sozlesmeler/actions.ts`;
  - `src/components/hatirlatma-satiri.tsx` (`KURAL_SEKMESI`: `DAMGA_HATA` → `damga`);
  - `src/components/belge-yukle.tsx` (`TURLER` += `BORC_YAZISI` "Borç yazısı (22/A)", `FATURA` "Fatura", `DAMGA_MAKBUZU` "Damga makbuzu").
- Test: `tests/integration/damga.test.ts`

**Interfaces:**
- Consumes: `damgaTutari`, `ilkDamgaMatrahi`, `damgaPaylari` (Task 3); `parametreOran`, `parametreTamsayi`, `vergiOranlari`, `ParametreYokHatasi`.
- Produces:

```ts
export interface DamgaKaydiGirdisi {
  sozlesmeId: number; olay: 'ILK' | 'YAZILI_ARTIS' | 'YAZILI_UZATMA'; olayTarihi: Tarih
  matrah: Para | null                     // ILK'ta yok sayılır (otomatik), diğerlerinde zorunlu > 0
  tahsil: 'ISTIHKAKTAN' | 'MALIK_BEYAN'
}
/** Aktifleştirme işleminin içinden çağrılır. Göç sözleşmesinde (gecisTarihi ya da odenmisSayilanSonTarih dolu) kayıt açmaz, null döner. */
export async function damgaIlkKaydiOlustur(tx: Tx, sozlesmeId: number, baglam: IslemBaglami, bugun: Tarih): Promise<number | null>
export async function damgaKaydiEkle(g: DamgaKaydiGirdisi, baglam: IslemBaglami): Promise<number>
export async function damgaMakbuzBagla(id: number, version: number, belgeId: number, baglam: IslemBaglami): Promise<void>
export async function damgaKaydiIptal(id: number, version: number, neden: string, baglam: IslemBaglami): Promise<void>
export interface DamgaKaydiGorunumu {
  id: number; version: number; olay: string; olayTarihi: Tarih; matrah: string; oranBinde: string; tutar: string
  tahsil: string; kalan: string; makbuzBelgeId: number | null; iptal: boolean; satirlar: HesapSatiri[]
  paylar: { kisiId: number; ad: string; tutar: string; kalan: string }[]
}
export async function sozlesmeDamgaKayitlari(sozlesmeId: number): Promise<DamgaKaydiGorunumu[]>
/** Hesap için: tahsili ISTIHKAKTAN, iptal edilmemiş, kalanı > 0 olan paylar. */
export async function damgaKalanlari(db: Tx, ciftler: readonly { sozlesmeId: number; kisiId: number }[]): Promise<DamgaKalani[]>
```

**Kurallar:**
- **ILK kaydının girdileri:**
  - Olay tarihi: `imzaTarihi ?? baslangic`.
  - Oran: olay tarihindeki `DAMGA_KIRA_BINDE`. Azami: olay tarihindeki `DAMGA_AZAMI`. Süresiz sözleşme için `DAMGA_SURESIZ_AY`.
  - Matrah `ilkDamgaMatrahi` ile, sözleşmenin ilk bedeli ve ödeme düzeniyle hesaplanır. Malikler sözleşme başlangıcında geçerli kayıtlardır; NET sözleşmede stopaj oranları olay tarihindeki statü kuralından alınır.
  - `gerekce` alanı, hesap izi satırları ve kullanılan parametre değerlerini taşır.
- **Paylar:** `damgaPaylari` ile kurulur. Kalan: ISTIHKAKTAN tahsilde payın tutarı; MALIK_BEYAN tahsilde 0.
- **Parametre eksikse** (`ParametreYokHatasi`, örneğin 2027 için `DAMGA_AZAMI` girilmemiş):
  - `damgaIlkKaydiOlustur` aktifleştirmeyi durdurmaz.
  - Kalıcı, karar gerektiren KRITIK bir hatırlatma açar: anahtar `DAMGA_HATA:sozlesme:<id>`, kural `DAMGA_HATA`, `iliskiliTur 'sozlesme'`. Açıklama: "Damga vergisi hesaplanamadı: <parametre iletisi>. Parametreyi girip Damga sekmesinden ILK kaydını ekleyin."
  - `null` döner. Diğer hatalar fırlatılır.
- **Aktifleştirme bağlantısı:** `sozlesmeAktiflestir`, `taksitPlaniniGuncelle`'den sonra `damgaIlkKaydiOlustur(tx, id, baglam, bugun)` çağırır. Dönen kimlik `AKTIFLESTIR` denetim satırına `damgaKaydiId` olarak eklenir.
- **`damgaKaydiEkle`:**
  - Sözleşme TASLAK olamaz.
  - Aktif bir ILK varken ikinci ILK reddedilir (`IsKuraliHatasi`; `damga_ilk_tekil` dizini de korur).
  - ILK olayında matrah otomatik hesaplanır.
  - Paylar olay tarihinde geçerli maliklere göre kurulur; ILK'ta sözleşme başlangıcındaki maliklere göre.
- **`damgaKaydiIptal`:**
  - Neden zorunludur.
  - **Engel yalnızca kesinleşmiş kullanımdır.** Kayıt, hiçbir payı kesinleşmiş (KESINLESTI, ODEME_EMRINDE, ODENDI) bir paketteki kesintide kullanılmamışsa iptal edilebilir; bu, tüm payların kalanının tutarına eşit olmasıyla aynıdır. Aksi halde ileti: "Bu damga kaydından kesinti yapıldı; önce ilgili paketi iptal edin."
  - TASLAK ya da HESAPLANDI paketteki kullanım iptali engellemez. Böylece Task 5'in `DAMGA_KESINTISI` uyarısındaki öneri ("kaydı iptal edip yeniden hesaplayın") uygulanabilir.
  - O paket, iptal edilen kaydı kesinleştirmede yakalar: `damgaKalanlari` iptal edilmiş kaydı dışarıda bırakır ve parmak izi değişir.
- **`damgaMakbuzBagla`:** Belge kaydı `sahipTur='sozlesme'`, `sahipId=sozlesmeId` ve `belgeTuru='DAMGA_MAKBUZU'` olmalıdır. Kayıt MALIK_BEYAN da ISTIHKAKTAN da olabilir.
- **Arayüz (Damga sekmesi):**
  - Kayıt tablosu: olay, tarih, matrah, oran (binde), tutar, tahsil, kalan, makbuz bağlantısı, durum ve hesap izi (`HesapIzi`).
  - Malik payları alt tablosu.
  - "Damga kaydı ekle" formu: olay, olay tarihi, matrah (ILK'ta gizli), tahsil.
  - "Makbuz bağla" formu: sözleşmenin `DAMGA_MAKBUZU` belgelerinden seçim. Sekme ayrıca `<BelgeYukle sahipTur="sozlesme" sahipId={id} belgeTuru="DAMGA_MAKBUZU" tamam={…}>` içerir; yüklenen belge seçime eklenir.
  - "İptal et" formu: neden alanıyla.
- **Mevcut testler:** F1 entegrasyon testlerinden aktifleştirme sonrası tablo, hatırlatma veya denetim satırı sayan varsa ILK kaydı yüzünden kırılabilir. Tüm paket çalıştırılır; beklenen sayılar damga kaydını içerecek biçimde güncellenir. Davranış değiştirilmez.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/integration/damga.test.ts`. Sözleşmeler `sozlesmeTaslakKaydet` ve ardından `sozlesmeAktiflestir(id, 0, TEST_BAGLAMI, t('2026-01-01'))` ile kurulur.

```ts
it('aktifleştirme ILK kaydı: 2026 aylık 10.000 brüt → olay 2025-12-20, matrah 120.000,00, tutar 226,80, tek pay kalan 226,80')
it('iki malik 1/2 + 1/2 → paylar 113,40 / 113,40')
it('göç sözleşmesinde (gecisTarihi dolu) ve odenmisSayilanSonTarih dolu sözleşmede ILK kaydı açılmaz')
it('MALIK_BEYAN sözleşme → payların kalanı 0')
it('süresiz sözleşme → matrah 12 aylık kira (120.000,00)')
it('imza 2027-01-05 ve DAMGA_AZAMI 2027 yok → sözleşme AKTIF olur, kayıt yok, DAMGA_HATA hatırlatması KRITIK')
it('ikinci ILK reddedilir; iptal edilen ILK sonrası ILK eklenebilir')
it('YAZILI_ARTIS matrah 24.000,00 → tutar 45,36; matrahsız YAZILI_ARTIS reddedilir')
it('kalanı tutarından az olan kayıt iptal edilemez; yalnız HESAPLANDI paketteki kesintide görünen kayıt iptal edilebilir')
it('makbuz: DAMGA_MAKBUZU olmayan ya da başka sözleşmenin belgesi reddedilir')
it('damgaKalanlari yalnız ISTIHKAKTAN, iptal edilmemiş ve kalanı > 0 payları döndürür')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- damga`
Expected: FAIL.

- [ ] **Step 3: Servisi, aktifleştirme bağlantısını, sekmeyi ve action'ları yaz**

- [ ] **Step 4: Tüm entegrasyon paketini çalıştır**

Run: `pnpm test:integration && pnpm typecheck && pnpm lint`
Expected: PASS. Kırılan F1 testleri yalnızca ILK kaydının yan etkisini (sayılar) yansıtacak şekilde güncellenmiş olmalı.

- [ ] **Step 5: Commit**

```bash
git add src/server/damga src/server/sozlesme/servis.ts src/server/parametre/servis.ts src/components/hatirlatma-satiri.tsx src/components/belge-yukle.tsx "src/app/(uygulama)/sozlesmeler" tests/integration
git commit -m "feat(damga): ILK damga kaydı, yazılı artış/uzatma, makbuz ve iptal"
```

---

### Task 8: Ödeme paketi taslağı (oluştur, taksit ekle/çıkar, böl, fatura) ve ekranlar

**Files:**
- Create:
  - `src/server/paket/sema.ts`, `src/server/paket/servis.ts`, `src/server/paket/sorgu.ts`;
  - `src/app/(uygulama)/odeme-paketleri/page.tsx`, `actions.ts`, `paket-formu.tsx`;
  - `src/app/(uygulama)/odeme-paketleri/[id]/page.tsx`, `[id]/bolumler/taksitler.tsx`, `[id]/bolumler/faturalar.tsx`;
  - `tests/integration/paket-yardimci.ts`.
- Modify:
  - `src/components/ana-menu.tsx` ("Ödeme paketleri", Sözleşmeler'den sonra);
  - `src/app/(uygulama)/sozlesmeler/[id]/sekmeler/taksitler.tsx` ve `src/server/sozlesme/sorgu.ts`: aktif paketteki taksitte paket bağlantısı gösterilir.
- Test: `tests/integration/paket.test.ts`

**Interfaces:**
- Produces:

```ts
// sema.ts
export interface PaketGirdisi { birimId: number; ad: string; vadeBaslangic: Tarih; vadeBitis: Tarih; kalanOdenek: Para | null }
export const paketGirdisiSemasi: z.ZodType<PaketGirdisi>       // ad 1–120 karakter; vadeBitis ≥ vadeBaslangic
export interface FaturaGirdisi { taksitId: number; kisiId: number; faturaNo: string; faturaTarihi: Tarih }
// servis.ts
export const DUZENLENEBILIR_DURUMLAR = ['TASLAK', 'HESAPLANDI'] as const
/** TASLAK paket açar ve önerilen taksitleri ekler (aşağıdaki kurala göre). */
export async function paketOlustur(g: PaketGirdisi, baglam: IslemBaglami): Promise<number>
export async function paketeTaksitEkle(paketId: number, version: number, taksitIdleri: readonly number[], baglam: IslemBaglami): Promise<void>
export async function pakettenTaksitCikar(paketId: number, version: number, taksitId: number, baglam: IslemBaglami): Promise<void>
export async function paketTaksitiBol(paketId: number, version: number, taksitId: number, bolunsun: boolean, baglam: IslemBaglami): Promise<void>
export async function paketFaturasiKaydet(paketId: number, version: number, g: FaturaGirdisi, baglam: IslemBaglami, bugun?: Tarih): Promise<void>
/** İç yardımcı (testler için export): HESAPLANDI paketi TASLAK'a döndürür; dağılım ve kesinti satırları silinir, onKontrol/hesapParmakIzi/hesapTarihi boşalır. */
export async function taslagaDondur(tx: Tx, paketId: number): Promise<void>
// sorgu.ts
export interface PaketListeSatiri { id: number; ad: string; birim: string; vadeBaslangic: Tarih; vadeBitis: Tarih; durum: PaketDurumu; taksitSayisi: number; net: string | null }
export async function paketListesi(f: { durum?: PaketDurumu }): Promise<PaketListeSatiri[]>
export async function paketDetayi(id: number, bugun: Tarih): Promise<PaketDetayi>   // düz değerli; Date/Decimal yok
export interface OneriSatiri { taksitId: number; sozlesmeId: number; sozlesmeNo: string; kisaAd: string; tur: string; donemBaslangic: Tarih; donemBitis: Tarih; vade: Tarih; tutar: string; gecikmis: boolean }
export async function paketOnerileri(paketId: number, bugun: Tarih): Promise<OneriSatiri[]>
// paket-yardimci.ts (testler)
export async function aktifSozlesme(h: Hazirlik, ek?: Record<string, unknown>, bugun?: Tarih): Promise<number>   // varsayılan bugün 2026-01-01
export async function sozlesmeTaksitleri(sozlesmeId: number): Promise<Taksit[]>                           // NORMAL/KIST, dönem sırasıyla
export async function paketKur(h: Hazirlik, ek?: Partial<PaketGirdisi>): Promise<number>                  // varsayılan Şubat 2026 vade aralığı
```

`PaketDetayi`; Task 9 ve 11 bu yapıya yeni alanlar ekler:

```ts
{
  id; version; ad; durum; birim: { id; ad }; vadeBaslangic; vadeBitis; kalanOdenek: string | null
  hesapTarihi: Tarih | null; muhasebeOdemeEmriNo; muhasebeOdemeEmriTarihi; odemeTarihi; iptalNedeni
  taksitler: {
    taksitId; sozlesmeId; sozlesmeNo; kisaAd; tur; donemBaslangic; donemBitis; vade; tutar: string
    durum; bolunsun: boolean; gecikmis: boolean
  }[]
  faturaGereken: { taksitId; kisiId; kisiAdi; faturaNo: string | null; faturaTarihi: Tarih | null }[]
  // Task 5'in malikParcalari ile bulunan parçalardaki (böl işaretine göre) şu malikler:
  //   - KDV'li malikler: FATURA_YOK ile aynı küme;
  //   - KDV'siz tüzel kişiler: yalnız ek listesi içindir, ön kontrolü engellemez.
}
```

**Kurallar:**
- **Önerilen taksitler:** `paketOlustur` şu taksitleri ekler:
  - durumu PLANLANDI;
  - sözleşmesinin `birimId`'si paketinkiyle aynı ve sözleşme TASLAK değil;
  - `vadeTarihi` `[vadeBaslangic, vadeBitis]` aralığında;
  - aktif bir pakette olmayan (`paket_taksit.aktif`).
  - Vadesi aralıktan önce olan gecikmiş taksitler otomatik eklenmez; `paketOnerileri` bunları `gecikmis: true` ile listeler.
- **`paketeTaksitEkle`:** Her taksit PLANLANDI olmalı, aynı birimden olmalı ve aktif pakette olmamalıdır. Kısmi tekil dizin ihlalinde (eşzamanlı ekleme) `IsKuraliHatasi('PAKETTE', 'Taksitlerden biri başka bir pakette; listeyi yenileyin.')` fırlatılır.
- **Her düzenleme:**
  - Paket `DUZENLENEBILIR_DURUMLAR` içinde olmalı ve sürüm eşleşmeli; aksi halde `IsKuraliHatasi('DURUM')` ya da `CakismaHatasi`.
  - HESAPLANDI pakette önce `taslagaDondur` çalışır, ardından sürüm artar.
- **Çıkarma ve bölme:** `pakettenTaksitCikar` `paket_taksit` satırını siler (TASLAK/HESAPLANDI'da tetikleyici izin verir). `paketTaksitiBol` `bolunsun` alanını yazar.
- **Fatura:**
  - Kişi, taksitin sözleşmesinde malik kaydı olan biri olmalıdır.
  - Fatura no (trim) 1–50 karakter, `faturaTarihi ≤ bugün`.
  - Aynı taksit ve kişi için kayıt varsa güncellenir (upsert).
- **Denetim:** `varlik: 'odeme_paketi'`, eylemler `OLUSTUR`, `TAKSIT_EKLE`, `TAKSIT_CIKAR`, `BOL`, `FATURA`. Sonra alanına kimlikler, tarihler ve fatura no yazılır; kişi adı yazılmaz.
- **Arayüz:**
  - **`/odeme-paketleri`:**
    - Liste: ad, birim, vade aralığı, durum rozeti, taksit sayısı, net toplam (hesaplanmışsa); durum filtresi (GET).
    - "Yeni paket" formu: birim (aktif birimler), ad (yer tutucu "Şubat 2026 kira ödemeleri"), vade başlangıcı ve bitişi, kalan ödenek (opsiyonel, `ondalik`).
    - Başarılı kayıtta paket detayına yönlendirilir.
  - **`/odeme-paketleri/[id]`:**
    - Başlık şeridi: ad, durum, birim, vade aralığı.
    - TASLAK/HESAPLANDI iken: taksit tablosu (sözleşme bağlantısı, dönem, vade + `gecikmiş` rozeti, tutar, "böl" onay kutusu formu, "Çıkar" düğmesi).
    - "Eklenebilir taksitler" listesi (onay kutularıyla çoklu ekleme formu).
    - "Faturalar" bölümü: `faturaGereken` satırı başına no + tarih formu.
  - **Sözleşme Taksitler sekmesi:** Aktif paketteki taksitin durum hücresine `/odeme-paketleri/<id>` bağlantısı eklenir.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/integration/paket.test.ts`. Bugün 2026-01-25'tir. İki birim ve her birinde bir sözleşme kurulur.

```ts
it('paketOlustur Şubat vadeli PLANLANDI taksitleri ekler; başka birimin ve aralık dışının taksitlerini eklemez')
it('aktif paketteki taksit ikinci pakete eklenemez (kod PAKETTE); ilk paket iptal benzetimi (aktif=false) sonrası eklenir')
it('HESAPLANDI pakette taksit çıkarılınca TASLAK olur ve dağılım satırları silinir')   // durum ve dağılım satırı doğrudan prisma ile
it('böl işareti yazılır; HESAPLANDI pakette TASLAK a döndürür')
it('sürüm uyuşmazlığı CakismaHatasi; KESINLESTI pakette düzenleme IsKuraliHatasi (DURUM)')
it('fatura: malik olmayan kişi reddedilir; ikinci kayıt günceller; gelecek tarih reddedilir')
it('faturaGereken: böl işaretli taksitte vadeden sonra başlayan SIRKET malik listelenir; bölünmemişte vade günündeki malik')
it('öneriler: Ocak vadeli taksit gecikmiş işaretli; başka aktif paketteki taksit listelenmez')
it('denetim: OLUSTUR satırında taksit kimlikleri var, kişi adı yok')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- paket.test`
Expected: FAIL.

- [ ] **Step 3: Servisi, sorguları, yardımcıyı ve ekranları yaz**

- [ ] **Step 4: Testleri ve kontrolleri çalıştır**

Run: `pnpm test:integration -- paket.test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/paket "src/app/(uygulama)/odeme-paketleri" src/components/ana-menu.tsx "src/app/(uygulama)/sozlesmeler/[id]/sekmeler/taksitler.tsx" src/server/sozlesme/sorgu.ts tests/integration/paket-yardimci.ts tests/integration/paket.test.ts
git commit -m "feat(paket): ödeme paketi taslağı, taksit seçimi, bölme ve fatura"
```

---

### Task 9: Paket hesaplama (dağılım yazımı, ön kontrol, hesap izi)

**Files:**
- Create: `src/server/paket/hesapla.ts`, `src/app/(uygulama)/odeme-paketleri/[id]/bolumler/{on-kontrol,dagilim}.tsx`
- Modify:
  - `src/core/hesap/goruntu.ts` (dağılım görüntüsü);
  - `prisma/seed-veri/parametreler.ts` (`IDARE_ADI`, `IDARE_VKN`);
  - `src/server/parametre/servis.ts` (`degerDogrula`: `IDARE_VKN` ya `GIRILMEDI` ya da `vknGecerliMi`);
  - `src/server/artis/servis.ts` (`onaylanmamisArtisTarihi` export edilir; davranışı değişmez);
  - `src/server/paket/sorgu.ts` (`PaketDetayi` += `onKontrol`, `dagilim`, `toplam`);
  - `src/app/(uygulama)/odeme-paketleri/actions.ts`.
- Test: `tests/integration/paket-hesapla.test.ts`

**Interfaces:**
- Consumes:
  - `paketHesabi` (Task 5), `damgaKalanlari` (Task 7), `gecerliSorgu` ve `sorguKullanimi` (Task 6);
  - `vergiOranlari(statu, tarih, db)`, `statuKurallari`, `ibanUygunMu`, `kisiGorunenAd`, `uyumUyarilari`, `parametreOran`, `parametreGetir`.
- Produces:

```ts
// goruntu.ts
export const DAGILIM_SURUMU = 'F2-1'
export interface DagilimGoruntusu {
  surum: string; hesapTarihi: Tarih
  taksit: { id: string; donem: { baslangic: Tarih; bitis: Tarih }; vade: Tarih; tutar: string; bedelTuru: BedelTuru }
  parca: { sira: number; baslangic: Tarih; bitis: Tarih }
  hisse: { pay: number; payda: number }
  oranlar: { stopaj: { anahtar: string | null; deger: string }; kdv: { anahtar: string | null; deger: string } }
  muhsgkKodu: string | null
  kesintiler: { tur: 'DAMGA' | 'HACIZ' | 'KESINTI_22A'; tutar: string; kaynakId: string }[]
  satirlar: HesapSatiri[]
}
// hesapla.ts
export interface HesapParmakIzi {
  sozlesmeler: Record<string, number>; kisiler: Record<string, number>; taksitler: Record<string, number>
  hacizler: string[]; damgaPaylari: string[]; sorgular: string[]      // değerlendirilen kaynak kimlikleri, sıralı
}
export interface PaketOnKontrolKaydi extends OnKontrolSonucu {
  alicilar22a: { kisiId: string; sorguGerekli: boolean; borcSorguId: string | null }[]
  toplam: Record<keyof PaketToplami, string>
}
export async function paketHesapGirdisiYukle(tx: Tx, paketId: number, bugun: Tarih):
  Promise<{ girdi: PaketHesapGirdisi; parmakIzi: HesapParmakIzi; oranAnahtarlari: Map<string, { stopaj: string | null; kdv: string | null }> }>
export async function paketHesapla(paketId: number, version: number, baglam: IslemBaglami, bugun: Tarih): Promise<PaketOnKontrolKaydi>
```

**Veri yükleme kuralları (`paketHesapGirdisiYukle`):**
- **Taksitler:** Aktif `paket_taksit` satırlarıdır. `artisBekliyor` canlı olarak hesaplanır:

  ```ts
  artisKurali !== 'YOK' && sonKiraDonemi !== undefined &&
    (await onaylanmamisArtisTarihi(tx, sozlesme, sonKiraDonemi, gunEkle(taksit.donemBitis, 1))) !== undefined
  ```

  Bu, F1'in I4 denetimiyle aynı mantıktır: son kira döneminden sonra, taksit dönemi bitene kadar başlayan ve ONAYLANDI artış hesabı olmayan bir artış tarihi var mı?
  - `hesapGoruntusu.artisBekleniyor` bayrağı **kullanılmaz.** Vadesi geçmiş satır dondurulduğu için bayrak, artış onaylandıktan sonra da `true` kalır.
  - Bu en yaygın durumdur: vade ayın 1'i, TÜFE ayın 3'ünde yayımlanır. Bayrak kullanılsaydı o ayın taksiti hiç ödenemezdi.
- **Malik dönemleri:**
  - Seçilen malik kayıtları: `gecerlilikBaslangic ≤ max(donemBitis, vade)` ve (`gecerlilikBitis` boş ya da `≥ donemBaslangic`).
  - `ibanUygun` alanı `ibanUygunMu(m, m.iban)` ile hesaplanır.
  - Oranlar `vergiOranlari(kisi.vergiStatusu, bugun)` ile alınır (statü başına önbellek).
  - `stopajli`: kuralın `stopaj !== null` olması; `muhsgkKodu` statü kuralından gelir.
  - `oranAnahtarlari` kuralın stopaj anahtarını ve `kdvli` ise `KDV_GENEL`'i taşır.
- **Uyum uyarıları:** `uyumUyarilari({ ...sözleşme, kullanimAmaci: tasinmaz.kullanimAmaci, taslak: false, tasarrufGenelgesiYururlukte: false })`.
- **Kesinti kaynakları:**
  - Damga: `damgaKalanlari` (sözleşme ve kişi çiftleri).
  - Haciz: AKTIF ve `kalanTutar > 0` olanlar.
  - 22/A: Her kişi için `gecerliSorgu(kisi, bugun)`. `kalanBorc = borcTutari − sorguKullanimi(…, paketId)`, en az 0.
- **Eşikler:** `ESIK_22A_ODEME` ve `ESIK_22A_BORC`. `idareVknVar` değeri `parametreGetir('IDARE_VKN', bugun) !== 'GIRILMEDI'` ile bulunur.
- **Parmak izi:** Sözleşme, kişi (malik ve vekil) ve taksit sürümleri. Ayrıca değerlendirilen haciz, damga payı ve sorgu kimlikleri.

**Yazma (tek transaction):**
- **Paket satırı:** Sürüm koşulu ve `durum IN (TASLAK, HESAPLANDI)` sağlanmalıdır; aksi halde `CakismaHatasi` ya da `IsKuraliHatasi('DURUM')`.
- **Dağılım satırları:** Paketin eski `dagilim_kesinti` ve `taksit_dagilim` satırları silinir. `PaketHesabi.satirlar` sırasıyla yeni `taksit_dagilim` satırları yazılır (`sira` = index).
  - `hesapGoruntusu` alanına `DagilimGoruntusu` yazılır.
  - Hesap izi satırları: dağılım satırları + kesinti satırları.
- **Kesinti satırları:** Her `UygulananKesinti` için `dagilim_kesinti` satırı yazılır. Kaynak kimliği türe göre `hacizId`, `borcSorguId` ya da `damgaPayiId` alanına gider.
- **Sürüm kaydı:** Her aktif `paket_taksit.hesaplananTaksitSurumu` = taksit sürümü.
- **Paket güncellemesi:** `durum = HESAPLANDI`, `hesapTarihi = bugün`, `onKontrol = PaketOnKontrolKaydi`, `hesapParmakIzi`, sürüm +1.
- **Denetim:** `HESAPLA` satırı. Sonra alanı: `{ hataSayisi, uyariSayisi, toplam }`.

**Parametre:** Tohum verisine eklenir. Yönetim > Parametreler'den kurulumda girilmesi gerekir. `IDARE_VKN` değeri yalnızca `GIRILMEDI` ya da geçerli bir VKN olabilir.

| Anahtar | Değer | Yürürlük | Açıklama |
|---|---|---|---|
| `IDARE_ADI` | `Konya Büyükşehir Belediyesi` | 2020-01-01 | Föy başlığı |
| `IDARE_VKN` | `GIRILMEDI` | 2020-01-01 | Kurumun VKN'si; kurulumda girilir |

**Arayüz:**
- Detay sayfasına "Hesapla" düğmesi eklenir (TASLAK/HESAPLANDI).
- "Ön kontrol" kartı: hatalar kırmızı, uyarılar sarı `Uyari` ile listelenir.
- "Dağılım" tablosu satırları alıcıya göre gruplar. Sütunlar: sözleşme no, dönem/parça, malik, hisse, brüt, KDV, stopaj, damga, haciz, 22/A, net, hesap izi (`HesapIzi`). IBAN maskelidir (`maskele(ibanNormalize(iban))`; `ibanBicimle` boşluklarıyla maskelenirse son dört hane bozulur).
- Altta toplamlar satırı bulunur.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/integration/paket-hesapla.test.ts`. Bugün 2026-01-25, paket Şubat 2026'dır. Sözleşme `aktifSozlesme(h)` ile kurulur; ILK damga 226,80 otomatik açılır.

```ts
it('sorgusuz: brüt 10.000, stopaj 2.000, damga 226,80, net 7.773,20; SORGU_22A_YOK hatası; durum HESAPLANDI')
it('borç yok sorgusuyla: hata yok; DAMGA kesinti satırı 226,80, damga payına bağlı')
it('borçlu sorgu 6.000: KESINTI_22A 6.000; net 1.773,20')
it('haciz 2.000 + borç 6.000: sıra damga → haciz → 22/A; haciz 2.000, 22/A eşiği 5.773,20 > 5.000 → 22/A 5.773,20, net 0')
it('haciz 3.000 + borç 6.000: damga ve hacizden sonra 4.773,20 ≤ 5.000 → 22/A gerekmez, kesinti yok, net 4.773,20')
it('kesinleşmiş başka paketteki 5.000 kullanım düşülür: borç 8.000 → bu pakette 3.000')
it('yeniden hesap eski satırları siler, sürüm artar; aynı girdiyle tutarlar aynı (spec §6.8)')
it('dağılım görüntüsü: DAGILIM_SURUMU, oran anahtarı STOPAJ_94_5A = 20, muhsgkKodu 041, kesinti listesi')
it('artış bekleyen taksit: sözleşme 2025-03-01–2027-02-28, Mart 2026 paketi, bugün 2026-02-20, artış onaylanmamış → ARTIS_BEKLIYOR')
it('vade geçtikten sonra onaylanan artış: bugün 2026-03-05 artış onaylanır (ana taksit dondurulmuş, FARK açılır); ana + FARK aynı pakette → ARTIS_BEKLIYOR yok, toplam yeni bedel')
it('IDARE_VKN GIRILMEDI → IDARE_VKN_YOK uyarısı')
it('parmak izi sözleşme, kişi ve taksit sürümlerini; haciz, damga payı ve sorgu kimliklerini içerir')
```

Kesinleşmiş başka paket verisi doğrudan `prisma` ile kurulur:
1. Paket HESAPLANDI durumunda açılır.
2. Dağılım ve kesinti satırları eklenir.
3. Paket durumu KESINLESTI'ye güncellenir.

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- paket-hesapla`
Expected: FAIL.

- [ ] **Step 3: Yükleme, yazma, tohum, doğrulama ve arayüz bölümlerini yaz**

- [ ] **Step 4: Testleri ve kontrolleri çalıştır**

Run: `pnpm test:integration -- paket && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/paket src/server/artis/servis.ts src/core/hesap/goruntu.ts prisma/seed-veri/parametreler.ts src/server/parametre/servis.ts "src/app/(uygulama)/odeme-paketleri" tests/integration/paket-hesapla.test.ts
git commit -m "feat(paket): dağılım ve kesinti hesabı, ön kontrol ve hesap izi"
```

---

### Task 10: Ödeme süreciyle taksit planı uyumu ve sistem dışı ödeme

**Files:**
- Modify:
  - `src/server/taksit/servis.ts` (`taksitPlaniniGuncelle`, yeni yardımcılar);
  - `src/server/artis/servis.ts` (`farklariIsle` aday sorgusu);
  - `src/server/sozlesme/servis.ts` (`yenilemeyeDevret`: yalnızca madde 1'deki "FARK'ı ödeme sürecinde olan devredilen satır" bildirimi);
  - `src/app/(uygulama)/sozlesmeler/[id]/sekmeler/taksitler.tsx`;
  - `src/app/(uygulama)/sozlesmeler/actions.ts`.
- Test: `tests/unit/server/taksit-tahakkuk.test.ts`, `tests/integration/taksit-odeme.test.ts`

**Interfaces:**
- Produces:

```ts
export const ODEME_SURECI = ['PAKETTE', 'ODEME_EMRINDE', 'ODENDI'] as const
/**
 * Tahakkuk etmiş (dondurulmuş) taksit: ödeme sürecinde, vadesi geçmiş PLANLANDI, ya da tahakkuk etmiş bir FARK'ı olan PLANLANDI.
 * FARK tahakkuk etmiş sayılır: ödeme sürecindeyse ya da PLANLANDI ve vadesi geçmişse.
 * Böyle satır yeniden fiyatlanmaz, NORMAL↔KIST çevrilmez, iptal edilmez; değişiklik FARK ya da fazla ödeme hatırlatması olur.
 */
export function tahakkukEtmisMi(t: { durum: TaksitDurumu; vadeTarihi: Date; tahakkukEtmisFarkVar: boolean }, bugun: Tarih): boolean
export function farkTahakkukEtmisMi(f: { durum: TaksitDurumu; vadeTarihi: Date }, bugun: Tarih): boolean
export async function taksitSistemDisiOdendi(taksitId: number, version: number, g: { odemeTarihi: Tarih; not: string }, baglam: IslemBaglami, bugun?: Tarih): Promise<void>
export async function taksitSistemDisiOdemeGeriAl(taksitId: number, version: number, baglam: IslemBaglami, bugun?: Tarih): Promise<void>
```

**Değişiklikler:**
1. **`taksitPlaniniGuncelle`** (C1 kuralının genellemesi):
   - **Yüklenen veri:** Mevcut satırlar `farkTaksitleri: { where: { durum: { not: 'IPTAL' } }, select: { id, durum, vadeTarihi } }` ile yüklenir. Sözleşme `sonrakiSozlesme: { select: { sozlesmeNo, baslangic } }` ile yüklenir.
   - **Donmuş satırlar:** Bugünkü `vadesiGecmisMi` dalı `tahakkukEtmisMi` ile değiştirilir. Ödeme sürecindeki satırlar ve tahakkuk etmiş FARK'ı olan PLANLANDI satırlar artık yeniden fiyatlanmaz, kısaltılmaz ve iptal edilmez.
   - **`gecmisDokunulmadi` sayacı:** F1'deki gibi yalnızca PLANLANDI donmuş satırları sayar. Ödeme sürecindeki satırlar sayılmaz.
   - **Dönem değişikliği bildirimi:** Herhangi bir donmuş satırın dönemi kısalıyor ya da satır sözleşme dışında kalıyorsa (fesih, yenileme kesimi) `gecmisDegisikligiBildir` çağrılır. Ödeme sürecindeki satırlar da buna dahildir; eski `if (m.durum !== 'PLANLANDI') continue` sessiz atlamaları kaldırılır.
     - **Ödeme sürecindeki satır** için metin: "… taksiti ödeme sürecinde (<durum>); paket kesinleşmemişse iptal edin, ödendiyse mahsup veya iade takibi yapın."
     - **Yenileme devri:** Satır sözleşme dışında kalmışsa ve DEVIR koşulu sağlanıyorsa hatırlatma eki `DEVIR`'dir (anahtar `H5_FAZLA:taksit:<id>:DEVIR`).
       - DEVIR koşulu: sözleşmenin `sonrakiSozlesme`'si vardır, o sözleşmenin durumu TASLAK değildir ve `donemBaslangic ≥ sonraki.baslangic`.
       - Metin: "Önceki sözleşmenin <dönem> taksiti ödeme sürecinde (<durum>); yeni sözleşmenin (<no>) aynı dönem taksitinden mahsup edin ya da paket kesinleşmediyse iptal edin."
       - Böylece her satır için tek hatırlatma açılır. `yenilemeyeDevret` yalnızca PLANLANDI satırları devretmeye ve bildirmeye devam eder; tek eki aşağıdaki FARK bildirimidir.
     - **Yalnızca FARK'ı yüzünden donmuş satır** (kendisi PLANLANDI ve vadesi gelmemiş; FARK'ı tahakkuk etmiş):
       - **Dönemi kısalırsa:** satır olduğu gibi kalır. Bildirim metni: "… taksitinin fark taksiti ödeme sürecinde olduğu için taksit değiştirilmedi; ödendiyse mahsup veya iade takibi yapın."
       - **Sözleşme dışında kalırsa:** ana satır iptal edilir; kendisi tahakkuk etmemiştir ve sözleşme sonrası kira ödenmesin. Tahakkuk etmiş her FARK için o FARK taksitinin kimliğiyle fazla ödeme hatırlatması açılır (ek: DEVIR koşulunda `DEVIR`, değilse `IPTAL`).
       - **`yenilemeyeDevret` aynı durumda:** Devrettiği (iptal ettiği) PLANLANDI ana satırın ödeme sürecindeki FARK'ları için aynı bildirimi `DEVIR` ekiyle açar. FARK satırları `taksitPlaniniGuncelle`'nin kapsamında değildir (`tur <> FARK`); başka hiçbir yer bildirmez.
   - **Tahakkuk etmemiş FARK:** Donmamış her PLANLANDI ana satırın tahakkuk etmemiş FARK'ları, satır işlenmeden önce **koşulsuz** iptal edilir. Satır yeniden fiyatlansa da fiyatı değişmese de (`continue` dalı) bu yapılır.
     - Yazma korumalıdır: `updateMany({ id, durum: 'PLANLANDI' })` ve sayı denetimi.
     - Böylece ana satırın tutarı FARK'la çift sayılmaz; FARK'ın ödemesi henüz başlamamıştır.
2. **`farklariIsle`:** Aday satır filtresi `{ durum: 'PLANLANDI', farkTaksitleri: { some: { OR: [{ durum: { in: ODEME_SURECI } }, { durum: 'PLANLANDI', vadeTarihi: { lt: bugün } }] } } }` dalıyla genişler. Böylece tahakkuk etmiş FARK'ı olan dondurulmuş satırın farkı, bir sonraki bedel değişikliğinde yeniden hesaplanır.
3. **Değişen F1 testleri:** Değişiklik bu iki testin beklentisini değiştirir. Beklentiler aşağıdaki gibi güncellenir; davranış bunlara uydurulmaz.
   - `tests/integration/yasam-dongusu.test.ts` › "vadesi geçmiş devredilen taksit için mahsup hatırlatması açılır; vadesi gelmemiş ve ödeme sürecindeki taksit için açılmaz":
     - Test adı "… ödeme sürecindeki taksit için ödeme sürecinde metniyle açılır" olur.
     - Beklenen hatırlatma listesine üçüncü satır eklenir: `[H5_FAZLA:taksit:<2027-01 PAKETTE satırı>:DEVIR, 'taksit', 'KRITIK', true, 'ACIK']`.
     - O satırın açıklaması yukarıdaki "Yenileme devri" metnidir.
   - `tests/integration/sozlesme.test.ts` › "kira bedeli değişince yalnızca PLANLANDI taksitler güncellenir; ödeme sürecine girenlere dokunulmaz": **değişmez.** `gecmisDokunulmadi: 0` kalır, çünkü ödeme sürecindeki satır sayılmaz. Bu test regresyon bekçisidir.
4. **`taksitSistemDisiOdendi`:**
   - İşlemin ilk ifadesi sözleşme satır kilididir.
   - Taksit PLANLANDI olmalı ve aktif bir pakette bulunmamalıdır. Aksi halde iletisi: "Taksit bir ödeme paketinde; önce paketten çıkarın."
   - `odemeTarihi ≤ bugün`; not 1–500 karakter.
   - Yazılan alanlar: `durum ODENDI`, `sistemDisiOdeme true`, `odemeTarihi`, `odemeNotu`, sürüm +1.
   - Denetim `SISTEM_DISI_ODENDI`; not metni yazılmaz, yalnızca `notGirildi`.
5. **`taksitSistemDisiOdemeGeriAl`:**
   - Yalnızca `sistemDisiOdeme` olan ODENDI satırda çalışır. Satır PLANLANDI'ya döner; `sistemDisiOdeme`, `odemeTarihi` ve `odemeNotu` sıfırlanır.
   - Ardından `taksitPlaniniGuncelle(tx, sozlesmeId, bugun)` çalışır.
   - Paketle ödenmiş satırda iletisi: "Paketle ödenen taksit buradan geri alınamaz."
6. **Arayüz:** Taksitler sekmesinde:
   - Pakette olmayan PLANLANDI satırda `<details>` içinde "Sistem dışında ödendi" formu (ödeme tarihi, not).
   - Sistem dışı ODENDI satırda "sistem dışı" rozeti ve "Geri al" düğmesi.
   - `vadesiGecmisMi` yorumundaki "F2'ye kadar" ifadesi yeni akışı anlatacak şekilde güncellenir.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/unit/server/taksit-tahakkuk.test.ts`:

```ts
it.each([
  ['PLANLANDI', '2026-03-01', false, false], ['PLANLANDI', '2026-01-01', false, true], ['PLANLANDI', '2026-03-01', true, true],
  ['PAKETTE', '2026-03-01', false, true], ['ODEME_EMRINDE', '2026-03-01', false, true], ['ODENDI', '2026-03-01', false, true],
  ['IPTAL', '2026-03-01', false, false],
])('tahakkukEtmisMi(%s, vade %s, tahakkukEtmisFark %s) = %s (bugün 2026-02-20)')
it.each([
  ['PLANLANDI', '2026-03-02', false], ['PLANLANDI', '2026-02-19', true], ['PAKETTE', '2026-03-02', true], ['ODENDI', '2026-03-02', true], ['IPTAL', '2026-02-19', false],
])('farkTahakkukEtmisMi(%s, vade %s) = %s (bugün 2026-02-20)')
```

`tests/integration/taksit-odeme.test.ts`. Sözleşme 2025-03-01–2027-02-28 (ilk kira 2025-03-01), aylık 10.000; tohum TÜFE değerleri onaylıdır. Mart 2026 artışı `artislariHesapla` ve `artisOnayla` ile, bugün 2026-02-20 verilerek onaylanır. Mart taksitinin vadesi (03-01) bugünden sonradır.

```ts
it('paket iptali benzetimi, FARK tahakkuk etmemiş: Mart taksiti PAKETTE iken artış onaylanır → FARK (vade 03-02); taksit PLANLANDI a döndürülüp plan çalışınca FARK IPTAL, ana tutar yeni bedel; aktif toplam = yeni bedel')
it('paket iptali benzetimi, FARK ödeme sürecinde: FARK PAKETTE iken ana PLANLANDI a döner → ana 10.000 kalır, FARK sürer; aktif toplam = yeni bedel')
it('fesih sonrası dönemi dışında kalan PAKETTE taksit iptal edilmez; "ödeme sürecinde" metniyle H5_FAZLA_ODEME açılır; gecmisDokunulmadi saymaz')
it('fesih sonrası, FARK ı tahakkuk etmemiş vadesi gelmemiş PLANLANDI satır: FARK ve ana satır iptal edilir (dondurulmaz)')
it('yenilemede önceki sözleşmenin ODENDI taksiti (dönemi yeni başlangıçtan sonra) devredilmez; tek bir DEVIR hatırlatması açılır, IPTAL ekli ikinci hatırlatma açılmaz')
it('TASLAK yenileme varken (aktifleştirilmemiş) fesih: hatırlatma eki IPTAL, DEVIR değil')
it('fesih sonrası sözleşme dışında kalan, FARK ı PAKETTE olan vadesi gelmemiş ana satır: ana IPTAL, FARK için fazla ödeme hatırlatması (FARK kimliğiyle)')
it('yenileme devrinde iptal edilen ana satırın ODENDI FARK ı için DEVIR hatırlatması')
it('fiyatı değişmeyen donmamış ana satırın tahakkuk etmemiş FARK ı da iptal edilir')
it('sistem dışı ödendi: PLANLANDI → ODENDI, odemeTarihi ve not yazılır; denetimde not metni yok')
it('sistem dışı ödendi: aktif paketteki taksit ve ileri tarih reddedilir')
it('geri al: ODENDI (sistem dışı) → PLANLANDI ve plan yeniden fiyatlar; sistem dışı olmayan ODENDI reddedilir')
```

"PAKETTE" ve "paket iptali" benzetimi, taksit durumunu doğrudan `prisma.taksit.update` ile değiştirir. Paket servisi Task 11'de gelir.

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/server/taksit-tahakkuk.test.ts && pnpm test:integration -- taksit-odeme`
Expected: FAIL.

- [ ] **Step 3: Değişiklikleri yaz**

- [ ] **Step 4: Tüm testleri çalıştır**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint`
Expected: PASS.
- `yasam-dongusu` testindeki değişiklik "Değişen F1 testleri" maddesinde tanımlıdır.
- Diğer F1 plan, artış ve yaşam döngüsü testleri değişmeden geçer. F1'de tahakkuk etmiş FARK'ı olan ve vadesi gelmemiş PLANLANDI satır oluşmaz; F1'in FARK'ları vadesi geçmiş satırlara açılır.

- [ ] **Step 5: Commit**

```bash
git add src/server/taksit/servis.ts src/server/artis/servis.ts src/server/sozlesme/servis.ts "src/app/(uygulama)/sozlesmeler" tests/unit/server/taksit-tahakkuk.test.ts tests/integration/taksit-odeme.test.ts
git commit -m "feat(taksit): ödeme sürecindeki ve FARK'lı taksitler dondurulur; sistem dışı ödeme"
```

---

### Task 11: Kesinleştirme, ödeme emri, ödendi ve iptal

**Files:**
- Create: `src/server/paket/durum.ts`, `src/app/(uygulama)/odeme-paketleri/[id]/bolumler/durum-eylemleri.tsx`
- Modify: `src/app/(uygulama)/odeme-paketleri/actions.ts`, `[id]/page.tsx`
- Test: `tests/integration/paket-durum.test.ts`

**Interfaces:**
- Consumes: `paketHesapGirdisiYukle` ve `HesapParmakIzi` (Task 9); `taksitPlaniniGuncelle`; `gecerliSorgu`, `sorguKullanimi`; `ibanUygunMu`.
- Produces:

```ts
export async function paketKesinlestir(paketId: number, version: number, baglam: IslemBaglami, bugun: Tarih): Promise<void>
export async function paketOdemeEmriGir(paketId: number, version: number, g: { no: string; tarih: Tarih }, baglam: IslemBaglami, bugun: Tarih): Promise<void>
/** Engellemeyen uyarıları döndürür (ör. 22/A belgesi ödeme tarihinde geçersizdi). */
export async function paketOdendi(paketId: number, version: number, odemeTarihi: Tarih, baglam: IslemBaglami, bugun: Tarih): Promise<string[]>
export async function paketIptal(paketId: number, version: number, neden: string, baglam: IslemBaglami, bugun: Tarih): Promise<void>
/** Yanlış "ödendi" kaydı ya da bankadan dönen ödeme: ODENDI → ODEME_EMRINDE, taksitler ODEME_EMRINDE, odemeTarihi silinir. */
export async function paketOdemeGeriAl(paketId: number, version: number, neden: string, baglam: IslemBaglami): Promise<void>
```

**`paketKesinlestir`** (tek transaction; zaman aşımı 60 sn). Herhangi bir denetim başarısız olursa `IsKuraliHatasi('YENIDEN_HESAPLA', '<neden>; paketi yeniden hesaplayın.')` fırlatılır; neden ilgili adımda yazılıdır.
1. Paketin aktif taksitlerinin sözleşme kimlikleri okunur. Sözleşme satırları `ORDER BY id DESC FOR UPDATE` ile kilitlenir (Global Constraints). Ardından paket satırı `FOR UPDATE` ile kilitlenir.
2. **Durum ve sürüm:** Paket HESAPLANDI değilse `IsKuraliHatasi('DURUM')`. Sürüm uyuşmazsa `CakismaHatasi`.
3. **Hesap tarihi:** `hesapTarihi === bugün` olmalıdır. Neden: "Hesap <tarih> tarihinde yapıldı".
4. **Hatasız ön kontrol:** `onKontrol.hatalar` boş olmalıdır; değilse `IsKuraliHatasi('ON_KONTROL', 'Ön kontrolde hata var: …')`.
5. **Taksitler:** Taksit satırları `ORDER BY id FOR UPDATE` ile kilitlenir. Hepsi PLANLANDI olmalı ve sürümü `hesaplananTaksitSurumu`'na eşit olmalıdır. Neden: "Taksit tutarı ya da durumu değişti".
6. **Kaynakları kilitle:** Saklanan parmak izindeki haciz, damga payı ve borç sorgusu kimlikleri her tür için `ORDER BY id FOR UPDATE` ile kilitlenir. Yeniden yükleme bu kilitlerden **sonra** yapılır; böylece okuma ile denetim arasında başka bir paket kalanı değiştiremez.
7. **Yeniden hesapla ve karşılaştır:**
   - Kilit altında `paketHesapGirdisiYukle` ve `paketHesabi` yeniden çalıştırılır.
   - **Parmak izi:** Yeni parmak izi saklananla aynı olmalıdır (sürümler ve kaynak kümeleri; ör. yeni haciz, kapanan haciz, yeni sorgu).
   - **Satırlar:** Her dağılım satırının `brut`, `kdv`, `stopaj`, `damga`, `haciz`, `kesinti22a` ve `net` değerleri saklanan satırlarla aynı olmalıdır. Bu, aynı gün değişen oran ve eşik parametrelerini, başka pakette kullanılan haciz, damga ve 22/A kalanlarını kendiliğinden yakalar.
   - **Ön kontrol:** Yeniden hesabın ön kontrolünde hata olmamalıdır (ör. IBAN pasifleşti).
   - Neden: "Sözleşme, malik, oran ya da kesinti kaynakları değişti".
   - **Ek kalan denetimi** (savunma amaçlı): Her haciz AKTIF olmalı ve bu paketin kesintisi kalanından küçük ya da eşit olmalı. Her damga payı kesintisi kalanından küçük ya da eşit olmalı. Her sorgu için `gecerlilikBitis ≥ bugün` ve `sorguKullanimi(…, paketId) + bu paketin toplamı ≤ borcTutari` olmalı.
8. **Yazma:**
   - Taksitler `updateMany({ id in, durum PLANLANDI })` ile PAKETTE olur, sürüm +1; etkilenen satır sayısı beklenene eşit olmalıdır.
   - Haciz `kalanTutar −= toplam`; kalan 0 olursa `durum KAPANDI` (otomatik kapanışta `kapanisNedeni` boş kalır).
   - Damga payı `kalan −= toplam`.
   - Paket: `durum KESINLESTI`, `kesinlestirenId`, `kesinlesmeZamani = now()`, sürüm +1.
   - Denetim: `KESINLESTIR`.

**`paketOdemeEmriGir`:**
- Paket KESINLESTI olmalıdır.
- Ödeme emri no (trim) 1–50 karakterdir.
- `tarih`, `hesapTarihi`nden (kesinleşme günüyle aynıdır) önce ya da `bugun`den sonra olamaz. Gerçek saat (`kesinlesmeZamani`) kullanılmaz; testler geçmiş tarihli `bugun` ile çalışır.
- **22/A geçerliliği** (spec §6.5.2): `onKontrol.alicilar22a` içinde `sorguGerekli` olan her alıcı için `s = gecerliSorgu(kisi, tarih)` aranır.
  - **Kabul:** `s` hesapta kullanılan sorgunun kendisidir. Ya da `s` yenilenmiş bir sorgudur ve iki koşul birlikte sağlanır:
    - alıcıdan bu pakette 22/A kesintisi yapılmamıştır;
    - `s` eşik üstü borç göstermez (`!s.borcVar || s.borcTutari ≤ ESIK_22A_BORC`).
  - **Ret — geçerli sorgu yok:** "<ad> için <tarih> tarihinde geçerli 22/A borç sorgusu yok; kişi sayfasından yeni sorgu girin."
  - **Ret — yeni sorgu borç gösteriyor ya da kesinti yapılmış alıcının sorgusu yenilenmiş:** "<ad> için yeni 22/A sorgusu kesintiyi değiştiriyor; paketi iptal edip yeniden hesaplayın."
  - Kabul edilen sorgu kimlikleri `onKontrol.alicilar22a[].borcSorguId` alanına yazılır; hesaptaki kimlik `hesapParmakIzi.sorgular` içinde kalır. Kimlikler denetim satırına da (`sonra.sorgular`) yazılır.
  - Ödendi uyarısı ve Task 12'nin ek listesi bu güncel alanı kullanır.
- Sözleşme kilitleri alınır; taksitler PAKETTE → ODEME_EMRINDE olur.

**`paketOdendi`:**
- Paket ODEME_EMRINDE olmalıdır.
- `odemeTarihi` ödeme emri tarihinden önce ya da bugünden sonra olamaz.
- Taksitler ODENDI olur ve `odemeTarihi` yazılır.
- **Uyarılar:** `onKontrol.alicilar22a` içinde `sorguGerekli` olan her alıcının kullanılan sorgusunun `gecerlilikBitis` değeri ödeme tarihinden önceyse şu uyarı döner: "<ad> için 22/A belgesi ödeme tarihinde geçerli değildi (<bitiş>); muhasebe birimine bildirin."

**`paketIptal`:**
- Neden 1–500 karakter zorunludur.
- **Paket ODENDI ise** iptal reddedilir: `IsKuraliHatasi('ODENDI', 'Ödenmiş paket iptal edilemez. Tutar hatalıysa kira dönemi bedelini düzeltin; fark taksiti ya da fazla ödeme hatırlatması kendiliğinden oluşur.')`.
- **Paket IPTAL ise:** `IsKuraliHatasi('DURUM')`.
- **TASLAK ya da HESAPLANDI paket:** `paket_taksit.aktif = false` yapılır, paket IPTAL olur. Dağılım satırları geçmiş için kalır.
- **KESINLESTI ya da ODEME_EMRINDE paket:**
  - Kilitler 1. adımdaki sırayla alınır (sözleşmeler, paket).
  - Taksitler PAKETTE/ODEME_EMRINDE → PLANLANDI olur (sürüm +1).
  - Haciz `kalanTutar += toplam`; `kapanisNedeni` boşsa durum AKTIF olur.
  - Damga payı `kalan += toplam`.
  - `paket_taksit.aktif = false`; paket IPTAL olur ve `iptalNedeni` yazılır.
  - Ardından her sözleşme için `taksitPlaniniGuncelle(tx, id, bugun)` çalışır.
- Denetim: `IPTAL`; neden metni yazılmaz, yalnızca `nedenGirildi`.

**`paketOdemeGeriAl`:**
- Paket ODENDI olmalıdır; neden 1–500 karakter zorunludur.
- Sözleşme kilitleri alınır.
- Taksitler ODENDI → ODEME_EMRINDE olur, `odemeTarihi` null yapılır, sürüm +1. Paket ODEME_EMRINDE olur, `odemeTarihi` null yapılır.
- Kesinti kalanlarına dokunulmaz; paket hâlâ kesinleşmiş ve ödeme emrindedir.
- Denetim: `ODEME_GERI_AL`, `nedenGirildi`.
- Arayüz: ODENDI paketinde "Ödemeyi geri al" formu (neden alanı, onay metniyle).

**Arayüz:** Durum eylemleri (`durum-eylemleri.tsx`) duruma göre gösterilir:
- **HESAPLANDI** (hata yoksa): "Kesinleştir" düğmesi. Onay metni: "N uyarı var. Paket kesinleşince dağılım değiştirilemez. Devam edilsin mi?"
- **KESINLESTI:** ödeme emri formu (no, tarih) ve "İptal et" formu (neden).
- **ODEME_EMRINDE:** ödendi formu (ödeme tarihi) ve "İptal et".
- **Her durum:** durum zaman çizelgesi (kesinleşme, ödeme emri, ödeme ve iptal bilgileri).
- Action'lar `eylemSonrasiHatirlatmalariTazele` çağırır ve servisten dönen uyarıları `uyariIle` ile gösterir.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/integration/paket-durum.test.ts`. Bugün 2026-01-25. Her senaryo `paketKur`, borç yok sorgusu ve `paketHesapla` ile başlar.

```ts
it('kesinleştir: taksitler PAKETTE, damga payı kalanı 0, haciz kalanı düşer, paket KESINLESTI; dağılım güncellemesi dagilim_degismez ile reddedilir')
it('ön kontrol hatası olan paket kesinleşmez (ON_KONTROL)')
it('hesap dünden kaldıysa (bugün 2026-01-26) YENIDEN_HESAPLA')
it('hesaptan sonra taksit yeniden fiyatlandıysa (tutar + sürüm doğrudan güncellenir) YENIDEN_HESAPLA')
it('hesaptan sonra kişiye yeni haciz eklendiyse YENIDEN_HESAPLA')
it('hesaptan sonra malik değiştiyse (sözleşme sürümü) YENIDEN_HESAPLA')
it('aynı haciz iki pakette: ilki kesinleşir, ikincisi YENIDEN_HESAPLA; yeniden hesapta kalan kadar keser')
it('aynı 22/A sorgusu iki pakette (borç 6.000): ilki 6.000 keser ve kesinleşir; ikincisi yeniden hesapta 0 keser')
it('eşzamanlı kesinleştirme: iki ayrı işlem aynı paketi kesinleştirir → biri başarılı, diğeri CakismaHatasi ya da DURUM')
it('ödeme emri ve ödendi: PAKETTE → ODEME_EMRINDE → ODENDI, odemeTarihi; tarih kuralları ihlali reddedilir')
it('ödendi: 22/A belgesi ödeme tarihinden önce bittiyse uyarı döner')
it('ödeme emri: sorgu 2026-01-25 (bitiş 2026-02-09); ödeme emri tarihi 2026-02-10 → reddedilir, 2026-02-09 → kabul')
it('ödeme emri: süresi dolan sorgu yerine 2026-02-10 tarihli borç yok sorgusu girilince 2026-02-10 ödeme emri kabul; yeni sorgu 6.000 borç gösterirse reddedilir (yeniden hesap)')
it('ödeme emri tarihi hesap tarihinden önce ya da bugünden sonra reddedilir (bugün parametresiyle, gerçek saat kullanılmadan)')
it('ödemeyi geri al: ODENDI → ODEME_EMRINDE, taksitler ODEME_EMRINDE ve odemeTarihi null; nedensiz reddedilir')
it('kesinleştirme aynı gün değişen stopaj oranını (yeni yürürlük kaydı) satır karşılaştırmasıyla yakalar → YENIDEN_HESAPLA')
it('iptal (KESINLESTI): taksitler PLANLANDI, damga ve haciz kalanları geri gelir, otomatik kapanan haciz AKTIF olur, taksitler yeni pakete eklenebilir')
it('iptal (HESAPLANDI): paket IPTAL, taksit aktif paketten çıkar, dağılım satırları kalır')
it('ODENDI paket iptal edilemez')
it('iptal sonrası plan: fesihten sonraki dönemin taksiti PLANLANDI a dönünce iptal edilir (vadesi gelmemiş)')
```

Eşzamanlılık testi iki ayrı `paketKesinlestir` çağrısını `Promise.allSettled` ile başlatır. Testin bekleneni: tam olarak biri başarılıdır ve son durum KESINLESTI'dir.

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- paket-durum`
Expected: FAIL.

- [ ] **Step 3: Durum servisini ve arayüzü yaz**

- [ ] **Step 4: Testleri ve kontrolleri çalıştır**

Run: `pnpm test:integration && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/paket/durum.ts "src/app/(uygulama)/odeme-paketleri" tests/integration/paket-durum.test.ts
git commit -m "feat(paket): kesinleştirme, ödeme emri, ödendi ve iptal"
```

---

### Task 12: PDF altyapısı, ödeme emri hazırlık föyü ve ek belge listesi

**Files:**
- Modify:
  - `package.json`: `pdfmake@0.3.11`; dev: `pdfjs-dist@6.3.289`, gerekirse `@types/pdfmake@0.3.3`;
  - `next.config.ts` (`serverExternalPackages` += `'pdfmake'`);
  - `src/server/denetim.ts`.
- Create:
  - `src/server/cikti/pdf.ts`, `src/core/paket/ek-belge.ts`, `src/server/paket/cikti-verisi.ts`, `src/server/paket/cikti.ts`;
  - `src/server/cikti/belgeler/foy.ts`, `src/server/cikti/belgeler/ek-liste.ts`;
  - `src/app/api/_lib/indirme.ts`, `src/app/api/odeme-paketleri/[id]/belgeler/route.ts`;
  - `src/app/(uygulama)/odeme-paketleri/[id]/bolumler/ciktilar.tsx`;
  - `tests/pdf-metni.ts`.
- Test: `tests/unit/core/ek-belge.test.ts`, `tests/unit/server/pdf.test.ts`, `tests/integration/paket-cikti.test.ts`

**Interfaces:**
- Produces:

```ts
// src/server/cikti/pdf.ts
import type { Content } from 'pdfmake/interfaces'
export interface PdfBelgesi { baslik: string; bolumler: readonly Content[][]; yatay?: boolean; filigran?: string | null }
/** Bölümler arasında sayfa sonu; altbilgi "Sayfa x / y — KBB Kira Takip, <üretim anı>". */
export async function pdfUret(b: PdfBelgesi): Promise<Buffer>
export type Hucre = string | { metin: string; sag?: boolean; kalin?: boolean }
export function tablo(basliklar: readonly string[], satirlar: readonly (readonly Hucre[])[], genislikler?: readonly (number | '*' | 'auto')[]): Content
export function bolumBasligi(metin: string): Content
// src/server/denetim.ts
export async function disaAktarimKaydi(db: Tx, baglam: IslemBaglami, g: { varlik: string; varlikId: string | number; belge: string; kayitSayisi: number }): Promise<void>
// src/core/paket/ek-belge.ts
export type EkBelgeTuru = 'ONAY_BELGESI' | 'PIYASA_ARASTIRMA' | 'SOZLESME' | 'FATURA' | 'HARCAMA_PUSULASI' | 'ARTIS_TABLOSU' | 'BORC_YAZISI' | 'HACIZ_YAZISI'
export interface EkBelge { tur: EkBelgeTuru; aciklama: string; tarih: Tarih | null; numara: string | null; eksik: boolean }
export interface EkBelgeGirdisi {
  sozlesmeler: readonly { sozlesmeNo: string; ilkOdeme: boolean; onayBelgesiNo: string | null; onayBelgesiTarihi: Tarih | null; piyasaArastirmaTarihi: Tarih | null; imzaTarihi: Tarih | null; artisVar: boolean }[]
  alicilar: readonly { ad: string; tip: 'GERCEK' | 'TUZEL'; kdvli: boolean; faturalar: readonly { no: string; tarih: Tarih }[] }[]
  sorgular: readonly { belgeNo: string | null; sorguTarihi: Tarih; vergiDairesi: string | null }[]
  hacizler: readonly { dosyaNo: string; tebligTarihi: Tarih; alacakli: string }[]
}
export function ekBelgeler(g: EkBelgeGirdisi): EkBelge[]
// src/server/paket/cikti-verisi.ts
export interface PaketCiktiVerisi {
  paket: { id: number; ad: string; durum: PaketDurumu; hesapTarihi: Tarih; odemeEmriNo: string | null; odemeEmriTarihi: Tarih | null; odemeTarihi: Tarih | null }
  kesinlesmemis: boolean                      // durum HESAPLANDI
  idare: { ad: string; vkn: string | null }  // IDARE_VKN = 'GIRILMEDI' → null
  birim: { ad: string; kurumsalKod: string; fonksiyonelKod: string; finansKodu: string; gerceklestirmeGorevlisi: string | null; harcamaYetkilisi: string | null }
  butceYili: number                           // hesapTarihi yılı
  alicilar: AliciCiktisi[]                    // anahtar (kisiId, odemeKisiId, ibanId); sıra kişi adı (tr), sonra kimlik
  kalemler: { sozlesmeNo: string; donem: string; tertip: string; ekonomikKod: string; gider: string }[]
  kesintiler: KesintiCiktisi[]
  toplam: { gider: string; kesinti: string; net: string }
  ekBelgeler: EkBelge[]
}
export interface AliciCiktisi {
  sira: number; kisiId: number; ad: string; kimlikNo: string; tip: 'GERCEK' | 'TUZEL'; adres: string | null
  odemeKisiAdi: string; iban: string | null
  brut: string; kdv: string; stopaj: string; damga: string; haciz: string; kesinti22a: string; net: string
  kdvli: boolean; faturalar: { no: string; tarih: Tarih }[]
  satirlar: { sozlesmeNo: string; donem: string; brut: string; kdv: string; stopaj: string; stopajOrani: string; damga: string; haciz: string; kesinti22a: string; net: string }[]
}
export interface KesintiCiktisi {
  tur: 'GV_STOPAJI' | 'DAMGA' | 'HACIZ' | 'KESINTI_22A'; altTur: string; kurum: string; dosyaNo: string | null
  kisiAdi: string; kimlikNo: string; hesabaEsas: string; oran: string | null; tutar: string
}
export async function paketCiktiVerisi(paketId: number): Promise<PaketCiktiVerisi>
// src/server/paket/cikti.ts
export async function paketBelgeleriPdf(paketId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }>
// src/server/cikti/belgeler/foy.ts, ek-liste.ts
export function foyBolumu(v: PaketCiktiVerisi): Content[]
export function ekListeBolumu(v: PaketCiktiVerisi): Content[]
// src/app/api/_lib/indirme.ts
export type IndirmeTuru = 'pdf' | 'xlsx' | 'csv'
export function indirmeYaniti(icerik: Uint8Array | string, dosyaAdi: string, tur: IndirmeTuru): Response
// tests/pdf-metni.ts
export async function pdfMetni(pdf: Uint8Array): Promise<string>   // pdfjs-dist legacy build; sayfa metinleri boşlukla birleşik
```

**Kurallar:**
- **`pdfUret`:**
  - Yazı tipi pdfmake paketinin içindeki Roboto TTF dosyalarıdır. Yol `createRequire(import.meta.url).resolve('pdfmake/package.json')` dizinine göre bulunur; dosyaların paket içindeki yeri kurulumdan sonra kontrol edilip sabitlenir.
  - `setLocalAccessPolicy` yalnızca o font dizinine izin verir; `setUrlAccessPolicy` her URL'yi reddeder.
  - Filigran varsa her sayfaya yazılır.
- **`ekBelgeler`** (spec §10.2; HBY md. 5, 35/a, 49/4):
  - İlk ödemesi bu pakette olan sözleşmeler için onay belgesi, piyasa fiyat araştırma tutanağı ve sözleşme (taahhüt dosyası) eklenir. Numara ya da tarih yoksa `eksik: true`.
  - Her alıcı için:
    - KDV'li ise fatura (no ve tarih);
    - gerçek kişi ve KDV'siz ise harcama pusulası;
    - tüzel kişi ve KDV'siz ise (kamu, vakıf/dernek, kooperatif) "fatura ya da alındı belgesi". Bu belge pakette kayıtlı değilse `eksik: true`.
  - `EkBelgeGirdisi.alicilar` öğesine `tip: 'GERCEK' | 'TUZEL'` alanı eklenir.
  - Artış varsa kira artış hesap tablosu eklenir.
  - Girdideki her 22/A sorgusu için borç yazısı (belge no, vergi dairesi) eklenir.
  - Kesinti yapılan her haciz için haciz yazısı (dosya no, alacaklı) eklenir.
  - Sıra: sözleşme belgeleri, alıcı belgeleri, kesinti belgeleri.
- **`paketCiktiVerisi`:**
  - **İzinli durumlar:** HESAPLANDI, KESINLESTI, ODEME_EMRINDE, ODENDI; aksi halde `IsKuraliHatasi('DURUM', 'Paket henüz hesaplanmadı.')`.
  - **Tertip:** `<kurumsalKod>.<fonksiyonelKod>.<finansKodu>.<ekonomikKod>`.
  - **İlk ödeme:** Aşağıdaki iki koşul birlikte sağlanıyorsa ödeme ilktir. Böylece eski bir föy sonradan yeniden basıldığında ek listesi değişmez.
    - Sözleşmenin taksiti, bu paketten **önce kesinleşmiş** (`kesinlesmeZamani` daha eski) ve iptal edilmemiş başka bir pakette yoktur. Bu paket henüz kesinleşmemişse, kesinleşmiş tüm diğer paketlere bakılır.
    - Sözleşmenin sistem dışı ödenmiş ya da göçte ödenmiş sayılmış (ODENDI, paketsiz) taksiti yoktur.
  - **22/A belgeleri:** `onKontrol.alicilar22a` içinde `sorguGerekli` olan her alıcının sorgusu ek listesine girer. Borç yok yazısı da dahildir; yalnızca kesinti yapılan sorgular değil.
  - **Kesinti satırları:**
    - Stopaj: alıcı başına; hesaba esas brüt, oran stopaj oranı, kurum "Vergi dairesi (muhtasar)".
    - Damga: damga kaydı başına; hesaba esas kaydın matrahı, oran binde değeri, kurum "Vergi dairesi (muhtasar)".
    - Haciz: haciz başına; hesaba esas kesinti öncesi ödenecek tutar, kurum alacaklı, dosya no.
    - 22/A: sorgu başına; kurum vergi dairesi, dosya no belge no.
- **Föy** (MİBMY yeni Örnek 32 alan sırası):
  - Başlık: "ÖDEME EMRİ HAZIRLIK FÖYÜ". Altında kamu idaresi, VKN, harcama birimi, kurumsal kod, bütçe yılı, kayıt adedi, paket no ve tarih.
  - Ödeme yapılacak kişiler: sıra, adı soyadı/unvanı, VKN/TCKN, IBAN (`ibanBicimle`), net.
  - Ödeme kalemleri: kalem, bütçe tertibi, brüt (KDV dahil).
  - Kesintiler: tür, alt tür, kurum, dosya no, hesaba esas tutar, oran, tutar.
  - Toplamlar: brüt, kesinti toplamı, net, ödenmesi gereken.
  - Ek belgeler: tür, tarih, numara, açıklama.
  - İmza alanları: gerçekleştirme görevlisi, harcama yetkilisi.
  - Kesinleşmemiş pakette filigran "TASLAK — KESİNLEŞMEMİŞ".
- **Ek belge kontrol listesi:** Ayrı bir sayfadır. Her belge için onay kutusu (☐), belge adı, tarih/no ve "EKSİK" işareti bulunur.
- **`paketBelgeleriPdf`:**
  - Bölümler: föy ve ek listesi. Task 13 pusula, fiş ve artış tablosunu ekler.
  - Dosya adı `odeme-paketi-<id>.pdf`.
  - `disaAktarimKaydi({ varlik: 'odeme_paketi', varlikId, belge: 'PAKET_BELGELERI', kayitSayisi: alıcı sayısı })` yazılır; PDF üretimiyle aynı işlemde değil, ondan sonra.
- **Route:** `GET /api/odeme-paketleri/[id]/belgeler` (`dynamic = 'force-dynamic'`):
  - Oturum yoksa 401; geçersiz kimlikte 404; `BulunamadiHatasi` → 404; `IsKuraliHatasi` → 409 (düz metin ileti).
  - Başarılıysa `indirmeYaniti(…, 'pdf')`.
- **`indirmeYaniti`:** Başlıklar: `Content-Disposition: attachment; filename*=UTF-8''…`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- **Arayüz:** Detay sayfasında HESAPLANDI ve sonrası için "Çıktılar" kartı: "Paket belgeleri (PDF)" bağlantısı. Task 14 Excel'i ekler.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/unit/core/ek-belge.test.ts`:

```ts
it('ilk ödemede onay belgesi, piyasa araştırması ve sözleşme; sonraki ödemede yok')
it('KDVli alıcıya fatura (no/tarih); KDVsiz gerçek kişiye harcama pusulası; KDVsiz tüzel kişiye "fatura ya da alındı belgesi" (kayıt yoksa eksik)')
it('onay belgesi no yoksa eksik = true')
it('22/A borç yazısı ve haciz yazısı listelenir; artış varsa artış tablosu')
it('sıra: sözleşme belgeleri, alıcı belgeleri, kesinti belgeleri')
```

`tests/unit/server/pdf.test.ts`:

```ts
it('pdfUret %PDF- ile başlar; metin "ğüşıöç ĞÜŞİÖÇ 1.234,56 ₺" aynen çıkar (pdfMetni)')
it('iki bölüm iki sayfa; altbilgide "Sayfa 2 / 2"')
it('filigran metni her sayfada')
```

`tests/integration/paket-cikti.test.ts` (Task 11 senaryosu: borç yok sorgulu, hesaplanmış paket):

```ts
it('föy: "ÖDEME EMRİ HAZIRLIK FÖYÜ", birim adı, kurumsal kod, alıcının TCKN si, biçimli IBAN, "7.773,20", tertip 03.5.5.05')
it('föy: GV stopajı 2.000,00 (oran %20) ve damga 226,80 kesinti satırları')
it('HESAPLANDI pakette filigran "KESİNLEŞMEMİŞ"; TASLAK pakette IsKuraliHatasi (DURUM)')
it('ek listesi: ilk ödeme → onay belgesi OB-1, piyasa araştırması EKSİK (tarih yok)')
it('DISA_AKTAR denetim satırı: belge PAKET_BELGELERI; satır JSON unda TCKN, IBAN ve ad yok')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/ek-belge.test.ts tests/unit/server/pdf.test.ts && pnpm test:integration -- paket-cikti`
Expected: FAIL.

- [ ] **Step 3: Bağımlılıkları kur, altyapıyı, föyü, listeyi, route'u ve kartı yaz**

Run: `pnpm add pdfmake@0.3.11 && pnpm add -D pdfjs-dist@6.3.289`
pdfmake tip taşımıyorsa ayrıca: `pnpm add -D @types/pdfmake@0.3.3`.

- [ ] **Step 4: Testleri ve derlemeyi çalıştır**

Run: `pnpm test && pnpm test:integration -- paket-cikti && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. `pnpm build` pdfmake'i paketlemeye çalışmaz (`serverExternalPackages`).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts src/server/cikti src/core/paket/ek-belge.ts src/server/paket/cikti-verisi.ts src/server/paket/cikti.ts src/server/denetim.ts src/app/api "src/app/(uygulama)/odeme-paketleri" tests/pdf-metni.ts tests/unit tests/integration/paket-cikti.test.ts
git commit -m "feat(cikti): PDF altyapısı, ödeme emri hazırlık föyü ve ek belge listesi"
```

---

### Task 13: Harcama pusulası, muhasebe işlem fişi önerisi ve kira artış tablosu

**Files:**
- Create:
  - `src/core/paket/muhasebe.ts`;
  - `src/server/cikti/belgeler/pusula.ts`, `src/server/cikti/belgeler/fis.ts`, `src/server/cikti/belgeler/artis-tablosu.ts`.
- Modify:
  - `src/server/paket/cikti-verisi.ts` (`fis` ve `artislar` alanları), `src/server/paket/cikti.ts` (bölüm sırası);
  - `prisma/seed-veri/parametreler.ts` (`MUHASEBE_FIS_HESAPLARI`);
  - `src/server/parametre/servis.ts`: `fisHesaplariSemasi` (zod) ve `degerDogrula` içinde bu anahtar için JSON doğrulaması (`STATU_KURALI_*` kalıbı).
- Test: `tests/unit/core/muhasebe.test.ts`, `tests/integration/paket-cikti.test.ts` (genişler)

**Interfaces:**
- Produces:

```ts
// src/core/paket/muhasebe.ts
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
export function fisOnerisi(g: FisGirdisi): { satirlar: FisSatiri[]; notlar: string[] }
// src/server/parametre/servis.ts
export async function fisHesaplari(tarih: Tarih, db?: Tx): Promise<FisHesaplari>
// cikti-verisi.ts ek alanlar
fis: { satirlar: { kayit: number; hesap: string; aciklama: string; borc: string; alacak: string }[]; notlar: string[] }
artislar: {
  sozlesmeNo: string; donemBaslangic: Tarih; referans: string; eskiBedel: string; tavan: string | null; sozlesmeOrani: string | null
  uygulananOran: string; yeniBedel: string; onaylayan: string | null; onayZamani: string | null; satirlar: HesapSatiri[]
}[]
export function pusulaBolumu(v: PaketCiktiVerisi, a: AliciCiktisi): Content[]
export function fisBolumu(v: PaketCiktiVerisi): Content[]
export function artisTablosuBolumu(v: PaketCiktiVerisi): Content[]
```

**`fisOnerisi` kuralları:** Tutarı 0 olan satır yazılmaz.
- **Kayıt 1:**
  - Borç: her tertip için `<gider>.<ekonomikKod>` hesabı ("Kira gideri — <tertip>") ile tertibin gider tutarı.
  - Alacak:
    - `<vergi>` "Gelir vergisi stopajı" (stopaj);
    - `<vergi>` "Damga vergisi" (damga);
    - `<emanet22a>` "6183 md. 22/A kesintisi";
    - `<emanetHaciz>` "Haciz kesintisi";
    - `<banka>` "Hak sahiplerine ödenecek" (net).
- **Kayıt 2:** `<butceGider>` borç / `<giderYansitma>` alacak, Σ gider.
- **Kayıt 3:** `<odenekliGider>` borç / `<gonderilecekOdenek>` alacak, Σ gider.
- **Notlar:** Her ilk ödeme için bir not: "İlk ödeme — <no>: sözleşme taahhüdü 920/921 hesaplarına kaydedilmiş olmalı (sözleşme bedeli, KDV hariç: <tutar>)." Tutar yoksa parantez yazılmaz. `taahhut`, sözleşmenin iptal edilmemiş ILK damga kaydının matrahıdır; KDV'li sözleşmede taahhüdün KDV'yi de içermesi gerektiği muhasebe birimine bırakılır.

**Parametre:** Tohum verisine eklenir. Yürürlük 2020-01-01. Dayanak: MİBMY + 31.03.2026 değişikliği; 333 ve 135 kullanımı müşavir teyidi bekler (spec §21-8, §21-9).

| Anahtar | Değer |
|---|---|
| `MUHASEBE_FIS_HESAPLARI` | `{"gider":"630","vergi":"360","emanet22a":"333","emanetHaciz":"333","banka":"103","butceGider":"830","giderYansitma":"835","odenekliGider":"905","gonderilecekOdenek":"900"}` |

**Pusula, artış tablosu ve dosya düzeni:**
- **Harcama pusulası** (Örnek 1): KDV'li olmayan her **gerçek kişi** alıcı için ayrı sayfa (spec §10.2: fatura vermeyen gerçek kişiler).
  - Üst bilgi: idare, harcama birimi, tarih (hesap tarihi), paket no.
  - Satırlar: "Taşınmaz kirası — <sözleşme no> — <dönem>", brüt, stopaj (oranıyla), damga, haciz, 22/A, net.
  - Alıcı: ad soyad, TCKN, adres.
  - İmza alanları: düzenleyen (gerçekleştirme görevlisi) ve alan.
- **Artış tablosu:** İlgili artışlar, paketteki sözleşmelerin `donemBaslangic` değeri paketteki taksit dönemlerinin [en erken başlangıç, en geç bitiş] aralığında olan ONAYLANDI artış hesaplarıdır. Paketteki FARK taksitlerinin `artisHesabiId` kayıtları da eklenir. `satirlar` alanı `artis_hesabi.gerekce.satirlar`'dan gelir.
- **PDF bölüm sırası:** föy, ek listesi, pusulalar, fiş önerisi, artış tabloları (yoksa atlanır).

- [ ] **Step 1: Başarısız testleri yaz**

`tests/unit/core/muhasebe.test.ts`:

```ts
it('araştırma yevmiyesi (altın): gider 10.000, stopaj 2.000, damga 18,90, net 7.981,10 → 630.03.5.5.05 B 10.000 / 360 A 2.000 + 18,90 / 103 A 7.981,10; 830/835 ve 905/900 10.000')
it('22/A ve haciz 333 e yazılır; sıfır tutarlı satır yazılmaz')
it('iki tertip iki ayrı 630 borç satırı')
it('özellik: her kayıtta Σ borç = Σ alacak')
it('ilk ödeme notu taahhüt tutarıyla; tutar yoksa parantezsiz')
```

`tests/integration/paket-cikti.test.ts` eklemeleri:

```ts
it('GMSİ alıcı için harcama pusulası; SIRKET alıcı (faturalı) için pusula yok, ek listesinde fatura no')
it('fiş önerisi metninde 630.03.5.5.05, 360, 103 ve tutarlar; ilk ödeme notu')
it('artış onaylı sözleşmenin FARK taksiti pakette → artış tablosu: eski bedel, uygulanan oran, yeni bedel')
it('MUHASEBE_FIS_HESAPLARI şemaya uymayan JSON parametre olarak eklenemez')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/muhasebe.test.ts && pnpm test:integration -- paket-cikti`
Expected: FAIL.

- [ ] **Step 3: Fiş çekirdeğini, parametreyi ve üç bölümü yaz**

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm test && pnpm test:integration -- paket-cikti && pnpm exec stryker run --mutate src/core/paket/muhasebe.ts && pnpm typecheck && pnpm lint`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/paket/muhasebe.ts src/server/cikti/belgeler src/server/paket prisma/seed-veri/parametreler.ts src/server/parametre/servis.ts tests/unit/core/muhasebe.test.ts tests/integration/paket-cikti.test.ts
git commit -m "feat(cikti): harcama pusulası, muhasebe fişi önerisi ve artış tablosu"
```

---

### Task 14: Banka aktarım Excel'i, Excel ve CSV yardımcıları

**Files:**
- Modify: `package.json` (`exceljs@4.4.0`), `next.config.ts` (`serverExternalPackages` += `'exceljs'`), `src/server/paket/cikti.ts`, `[id]/bolumler/ciktilar.tsx`
- Create: `src/core/paket/banka.ts`, `src/server/cikti/excel.ts`, `src/server/cikti/csv.ts`, `src/app/api/odeme-paketleri/[id]/banka/route.ts`
- Test: `tests/unit/core/banka.test.ts`, `tests/unit/server/csv.test.ts`, `tests/unit/server/excel.test.ts`, `tests/integration/paket-cikti.test.ts` (genişler)

**Interfaces:**
- Produces:

```ts
// src/core/paket/banka.ts
export interface BankaGirdiSatiri {
  kisiId: string; kimlikNo: string; odemeKisiId: string; odemeKisiAdi: string; ibanId: string; iban: string
  net: Para; sozlesmeNo: string; donemBaslangic: Tarih
}
export interface BankaSatiri { sira: number; ad: string; iban: string; tutar: Para; aciklama: string; kisiId: string; odemeKisiId: string }
/** Anahtar (kisiId, odemeKisiId, ibanId); net toplamı 0 olan grup atlanır; sıra ad (tr), sonra kisiId. */
export function bankaSatirlari(satirlar: readonly BankaGirdiSatiri[]): BankaSatiri[]
/** "<kimlikNo> – kira ödemesi – <AA/YYYY ya da AA/YYYY–AA/YYYY> – <no[, no…]>" (328 Seri No'lu GVGT). */
export function bankaAciklamasi(kimlikNo: string, aylar: readonly Ay[], sozlesmeNolari: readonly string[]): string
// src/server/cikti/excel.ts
export type HucreTuru = 'metin' | 'para' | 'tarih' | 'tamsayi'
export interface ExcelSutunu { baslik: string; tur: HucreTuru; genislik?: number }
export type ExcelDegeri = string | Para | Tarih | number | null
export interface ExcelSayfasi { ad: string; sutunlar: readonly ExcelSutunu[]; satirlar: readonly (readonly ExcelDegeri[])[]; dipnot?: string }
export async function excelUret(sayfalar: readonly ExcelSayfasi[]): Promise<Buffer>
// src/server/cikti/csv.ts
export function csvUret(basliklar: readonly string[], satirlar: readonly (readonly string[])[]): string
// src/server/paket/cikti.ts
export async function paketBankaDosyasi(paketId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }>
```

**Kurallar:**
- **`excelUret`:**
  - `metin` hücresi string olarak, `numFmt '@'` ile yazılır. TCKN, VKN ve IBAN her zaman `metin`'dir.
  - `para` hücresi yalnızca bu sınırda `Number(p.toFixed(2))` ile sayıya çevrilir ve `numFmt '#,##0.00'` alır.
  - `tarih` hücresi `gg.aa.yyyy` metnidir (saat dilimi kayması olmasın diye Date yazılmaz).
  - Başlık satırı kalındır ve dondurulur.
- **`csvUret`:**
  - Dosya `﻿` ile başlar; ayraç `;`, satır sonu CRLF'dir.
  - `;`, `"`, CR ya da LF içeren alan tırnaklanır ve içindeki `"` ikilenir.
  - `=`, `+`, `-`, `@`, TAB ya da CR ile başlayan alanın başına `'` eklenir (formül enjeksiyonu). Para alanları negatif olmadığından etkilenmez.
- **Banka dosyası:**
  - Tek sayfa "Banka aktarımı". Sütunlar: Sıra, Alıcı (ödeme kişisi), IBAN, Tutar, Açıklama.
  - Dosya adı `banka-aktarimi-<paketId>.xlsx`.
  - İzinli durumlar: KESINLESTI, ODEME_EMRINDE, ODENDI. HESAPLANDI'da reddedilir: banka dosyası kesinleşmemiş tutarla üretilmez.
  - `disaAktarimKaydi(belge: 'BANKA_AKTARIMI')` yazılır.
- **Route:** `GET /api/odeme-paketleri/[id]/banka` (Task 12 route kalıbı).
- **Arayüz:** Çıktılar kartına "Banka aktarım dosyası (Excel)" bağlantısı eklenir; yalnızca kesinleşmiş pakette görünür.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
// banka.test.ts
it('vekilsiz tek malik tek taksit: tek satır, açıklama "12345678901 – kira ödemesi – 02/2026 – T-1"')
it('aynı malik iki taksit: tek satır, tutar toplam, "02/2026–03/2026"')
it('vekil iki malik: aynı IBAN a iki satır, her biri kendi malikinin kimlik no su ile')
it('iki sözleşme: "T-1, T-2"; net 0 grup atlanır; sıra ada göre (Çelik < Demir, Türkçe sıralama)')
// csv.test.ts
it('BOM, ; ayracı ve CRLF')
it('"=HYPERLINK(\\"x\\")" → "\'=HYPERLINK(""x"")" tırnaklı; ";" içeren alan tırnaklı')
// excel.test.ts (exceljs ile geri okunur)
it('VKN "0123456789" ve IBAN metin olarak aynen geri okunur; hücre türü string')
it('para 1234,56 sayı olarak, numFmt #,##0.00; tarih "05.02.2026" metin')
```

`paket-cikti.test.ts` eklemesi:

```ts
it('banka dosyası: kesinleşmiş pakette tek satır, tutar 7773.2, IBAN metin; HESAPLANDI pakette IsKuraliHatasi; DISA_AKTAR BANKA_AKTARIMI')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/banka.test.ts tests/unit/server && pnpm test:integration -- paket-cikti`
Expected: FAIL.

- [ ] **Step 3: Bağımlılığı kur ve kodu yaz**

Run: `pnpm add exceljs@4.4.0`

- [ ] **Step 4: Testleri, mutasyonu ve derlemeyi çalıştır**

Run: `pnpm test && pnpm test:integration -- paket-cikti && pnpm exec stryker run --mutate src/core/paket/banka.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts src/core/paket/banka.ts src/server/cikti/excel.ts src/server/cikti/csv.ts src/server/paket/cikti.ts src/app/api/odeme-paketleri "src/app/(uygulama)/odeme-paketleri" tests/unit tests/integration/paket-cikti.test.ts
git commit -m "feat(cikti): banka aktarım Excel'i, Excel ve CSV yardımcıları"
```

---

### Task 15: F2 hatırlatmaları (H1 ödeme sürecinde, H3, H9, H10) ve bağlantılar

**Files:**
- Modify:
  - `src/core/hatirlatma.ts`, `src/server/hatirlatma/servis.ts`;
  - `src/server/parametre/servis.ts` (`hatirlatmaAyarlari`, `TAMSAYI_PARAMETRELERI`), `prisma/seed-veri/parametreler.ts`;
  - `src/components/hatirlatma-satiri.tsx`, `src/server/takvim/servis.ts`.
- Test: `tests/unit/core/hatirlatma.test.ts` (genişler), `tests/unit/core/ics.test.ts` ya da takvim testi, `tests/integration/hatirlatma-f2.test.ts`

**Interfaces:**
- Produces (`src/core/hatirlatma.ts` değişiklikleri):

```ts
export type HatirlatmaKurali = /* F1 */ | 'H3' | 'H9' | 'H10'
export const OTOMATIK_KURALLAR  // F1 listesi + 'H3', 'H10' (H9 kullanıcı tamamlayana kadar açık kalır, H13 gibi)
export type IliskiliTur = /* F1 */ | 'paket' | 'damga'
export interface TaksitOzeti { /* F1 */; odemeSurecinde: boolean }          // PAKETTE / ODEME_EMRINDE
export interface HatirlatmaAyarlari { /* F1 */; sorguOnceGun: number; muhtasarGorunurGun: number; muhtasarSonGun: number; damgaBeyanGun: number }
export interface Paket22aOzeti { paketId: string; paketAdi: string; eksikSorguSayisi: number; enYakinBitis: Tarih | null }
export interface MuhtasarOzeti { donem: Ay; stopajVar: boolean; damgaVar: boolean }
export interface DamgaBeyanOzeti { damgaKaydiId: string; sozlesmeId: string; sozlesmeNo: string; kisaAd: string; olayTarihi: Tarih }
export interface HatirlatmaVerisi {
  /* F1 alanları; planliTaksitler → taksitler olarak yeniden adlandırılır */
  taksitler: readonly TaksitOzeti[]
  paketler22a: readonly Paket22aOzeti[]
  muhtasar: MuhtasarOzeti | null
  damgaBeyanlari: readonly DamgaBeyanOzeti[]
}
// src/server/hatirlatma/servis.ts
export interface PanoSatiri { /* F1 */; iliskiliId: string }
```

**Kurallar:**
- **H1 ve H2:** `odemeSurecinde` taksitte H1 aynı anahtarla sürer; açıklamaya " Ödeme sürecinde (paket kesinleşti)." eklenir. H2 üretilmez.
- **H3 — sorgu eksik:** `eksikSorguSayisi > 0` ise:
  - Anahtar `H3:paket:<id>:SORGU_YOK`; başlık `22/A borç sorgusu gerekli — <paketAdi>`.
  - Açıklama: `<n> alıcı için bugün geçerli 22/A borç sorgusu yok (6183 md. 22/A). Sorguyu kişi sayfasından girin. Borç çıkmazsa ödeme emri yeni sorguyla girilebilir; borç çıkarsa paketi (kesinleşmişse iptal edip) yeniden hesaplayın.`
  - Hedef ve görünür tarih bugündür; öncelik YUKSEK.
- **H3 — geçerlilik bitiyor:** `enYakinBitis` bugün ya da sonrasıysa:
  - Anahtar `H3:paket:<id>:<bitis>`; hedef `bitis`, görünür `bitis − sorguOnceGun`, öncelik YUKSEK.
  - Açıklama: `22/A borç sorgusunun geçerliliği <gg.aa.yyyy> tarihinde bitiyor; ödeme o güne kadar yapılmayacaksa sorguyu yenileyin.`
- **H9 — muhtasar:** `muhtasar` dolu ve `stopajVar || damgaVar` ise:
  - Hedef `sonrakiIsGunu(birlestir(bugünün yılı, bugünün ayı, muhtasarSonGun))`; görünür `birlestir(yıl, ay, muhtasarGorunurGun)`.
  - Anahtar `H9:sistem:muhtasar:<ayAnahtari(donem)>`, öncelik YUKSEK; `iliskiliTur 'sistem'`, `iliskiliId 'muhtasar'`.
  - Başlık `Muhtasar beyanı — <ayAdi(donem)> ödemeleri`.
  - Açıklama `<"Gelir vergisi stopajı" | "İstihkaktan kesilen damga vergisi" | ikisi " ve " ile> muhtasar ve prim hizmet beyannamesiyle bildirilmeli. Listeyi Raporlar ekranından alın.`
- **H10 — damga makbuzu:** Her `damgaBeyanlari` öğesi için:
  - Hedef `sonrakiIsGunu(gunEkle(olayTarihi, damgaBeyanGun))`, görünür `olayTarihi`.
  - Öncelik hedef geçtiyse KRITIK, değilse YUKSEK.
  - Anahtar `H10:damga:<id>:<hedef>`; başlık `Damga vergisi makbuzu bekleniyor — <sozlesmeNo>`.
  - Açıklama `<kisaAd>: malik damga vergisini <gg.aa.yyyy> tarihine kadar beyan edip ödemeli (DVK 22); makbuzu sözleşmenin Damga sekmesine yükleyin.`
- **Veri yükleme (`hatirlatmaVerisiYukle`):**
  - **Taksitler:** Durum PLANLANDI, PAKETTE ya da ODEME_EMRINDE olanlar (önceki ufuk ve sözleşme koşullarıyla).
  - **`paketler22a`:** Durumu HESAPLANDI, KESINLESTI ya da ODEME_EMRINDE olan paketlerin `onKontrol.alicilar22a` listesindeki `sorguGerekli` kişileri alınır. Her biri için `gecerliSorgu(kisi, bugun)` çağrılır. Sorgusu olmayanlar sayılır; bulunanların en erken `gecerlilikBitis` değeri `enYakinBitis` olur.
  - **`muhtasar`:** Dönem `ayKaydir(tarihinAyi(bugun), −1)`. O ay `odemeTarihi` olan ODENDI paketlerde Σ stopaj > 0 ise `stopajVar`, DAMGA kesinti satırı varsa `damgaVar`.
  - **`damgaBeyanlari`:** Tahsili MALIK_BEYAN, makbuzu yok, iptal edilmemiş ve sözleşmesi TASLAK olmayan damga kayıtları.
- **Parametreler** (`TAMSAYI_PARAMETRELERI`'ne eklenir; yürürlük 2020-01-01):

| Anahtar | Değer | Dayanak |
|---|---|---|
| `HATIRLATMA_22A_ONCE_GUN` | 3 | spec §9 H3 |
| `HATIRLATMA_MUHTASAR_GORUNUR_GUN` | 20 | spec §9 H9 |
| `MUHTASAR_SON_GUN` | 26 | GVK 98 |
| `DAMGA_MALIK_BEYAN_GUN` | 15 | DVK 22/b |

- **Bağlantılar (`hatirlatma-satiri.tsx`):**
  - `KURAL_SEKMESI` += `['H10', 'damga']`, `['DAMGA_HATA', 'damga']` (Task 7'de eklendiyse olduğu gibi kalır).
  - `iliskiliTur === 'paket'` ise `/odeme-paketleri/<iliskiliId>`.
  - `kural === 'H9'` ise `/raporlar`.
- **`.ics` (`takvim/servis.ts`):**
  - `MOTOR_KURALLARI` = `OTOMATIK_KURALLAR` − {H1, H3} + {H13, H9}. Bugün dosya içi bir sabittir; test içe aktarabilsin diye `export` edilir. Bu kümenin dışındaki kurallarda (H3 dahil) akışa F1'deki gibi yalnızca başlık ve genel açıklama girer.
  - H3'ün başlığı paket adını (serbest metin) taşıdığından akışta başlık da sabitlenir: `22/A borç sorgusu gerekli`.
- **F1 testleri:** `HatirlatmaVerisi.planliTaksitler` alanı `taksitler` olarak yeniden adlandırıldığından, F1 birim testlerindeki veri kurucuları da yeni ada ve `odemeSurecinde: false` alanına göre güncellenir.

- [ ] **Step 1: Başarısız testleri yaz**

Birim testleri (`hatirlatma.test.ts`):

```ts
it('H1 ödeme sürecindeki taksitte sürer ve "Ödeme sürecinde" der; H2 üretilmez')
it('H3: eksik sorgu → SORGU_YOK anahtarı; bitiş 2026-02-09 → 2026-02-06 da görünür, 2026-02-05 te görünmez')
it('H9: bugün 2026-10-20, Eylül stopajı var → hedef 2026-10-26; 2026-10-19 da görünmez')
it('H9: 26 sı cumartesi (2026-09) → hedef 2026-09-28; stopaj ve damga yoksa üretilmez')
it('H10: olay 2026-10-01 → hedef 2026-10-16; 2026-10-17 de KRITIK')
```

Takvim testi:

```ts
it('MOTOR_KURALLARI H3 ü içermez; H9 ve H10 u içerir')
```

Entegrasyon testleri (`hatirlatma-f2.test.ts`):

```ts
it('paket kesinleşince H2 kapanır (OTOMATIK_KAPANDI), H1 açık kalır; ödendi olunca H1 kapanır')
it('ödendi paketin Eylül stopajı → 2026-10-20 üretiminde H9; Kasım üretiminde kendiliğinden kapanmaz')
it('MALIK_BEYAN damga kaydı → H10; makbuz bağlanınca OTOMATIK_KAPANDI')
it('sorgusuz HESAPLANDI paket → H3 SORGU_YOK; sorgu eklenince sonraki üretimde kapanır')
it('pano satırı iliskiliId taşır; H3 bağlantısı /odeme-paketleri/<id>')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/hatirlatma.test.ts && pnpm test:integration -- hatirlatma`
Expected: FAIL.

- [ ] **Step 3: Kuralları, yükleyiciyi, parametreleri ve bağlantıları yaz**

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm test && pnpm test:integration && pnpm exec stryker run --mutate src/core/hatirlatma.ts && pnpm typecheck && pnpm lint`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/hatirlatma.ts src/server/hatirlatma/servis.ts src/server/parametre/servis.ts prisma/seed-veri/parametreler.ts src/components/hatirlatma-satiri.tsx src/server/takvim/servis.ts tests/unit tests/integration/hatirlatma-f2.test.ts
git commit -m "feat(hatirlatma): H3 22/A, H9 muhtasar, H10 damga makbuzu; ödeme sürecinde H1"
```

---

### Task 16: Vergi listeleri (muhtasar, damga, 22/A) ve Raporlar ekranı

**Files:**
- Create:
  - `src/core/rapor/vergi.ts`, `src/server/rapor/vergi.ts`, `src/server/rapor/indir.ts`;
  - `src/app/api/raporlar/[rapor]/route.ts`, `src/app/(uygulama)/raporlar/page.tsx`.
- Modify: `src/components/ana-menu.tsx` ("Raporlar", Ödeme paketleri'nden sonra)
- Test: `tests/unit/core/rapor-vergi.test.ts`, `tests/integration/rapor.test.ts`

**Interfaces:**
- Consumes: `excelUret`, `csvUret`, `disaAktarimKaydi`, `indirmeYaniti`.
- Produces:

```ts
// src/core/rapor/vergi.ts
export interface MuhtasarGirdisi { kisiId: string; turKodu: string | null; kimlikNo: string; soyadUnvan: string; ad: string; brut: Para; stopaj: Para }
/** (kisiId, turKodu) başına toplar; stopajı 0 olanları atar; sıra turKodu (null sonda), soyadUnvan (tr), kisiId. */
export function muhtasarSatirlari(g: readonly MuhtasarGirdisi[]): MuhtasarGirdisi[]
// src/server/rapor/vergi.ts
export interface RaporTablosu { baslik: string; sutunlar: readonly ExcelSutunu[]; satirlar: readonly (readonly ExcelDegeri[])[]; uyarilar: string[] }
export async function muhtasarListesi(ay: Ay): Promise<RaporTablosu>
export async function damgaBeyanListesi(ay: Ay): Promise<RaporTablosu>
export async function kesinti22aListesi(ay: Ay): Promise<RaporTablosu>
// src/server/rapor/indir.ts
export type RaporAdi = 'muhtasar' | 'damga' | 'kesinti-22a'                  // Task 17: | 'odenek' | 'gecikmis' | 'sozlesme-durum'
/** Bilinmeyen rapor adı → null (404). Hatalı sorgu parametresi → IsKuraliHatasi (400). */
export async function raporIndir(rapor: string, q: URLSearchParams, baglam: IslemBaglami, bugun: Tarih):
  Promise<{ dosyaAdi: string; icerik: Buffer | string; tur: 'xlsx' | 'csv' } | null>
```

**Kurallar:**
- **Veri kaynağı:** Yalnızca ODENDI paketler alınır; `odemeTarihi` istenen ayın içinde olmalıdır. Spec §11 "ödendi tarihine göre"dir; KESINLESTI ve ODEME_EMRINDE paketler dahil edilmez.
- **Muhtasar listesi:**
  - Sütunlar: Tür kodu, TCKN/VKN, Soyadı/Unvanı, Adı, Gayrisafi tutar, Kesilen vergi.
  - `turKodu` dağılım görüntüsündeki `muhsgkKodu`'dur. Gerçek kişide soyad ve ad, tüzel kişide unvan ve boş ad yazılır.
  - Kodu boş olan satırda "—" yazılır ve şu uyarı eklenir: "Muhtasar ödeme türü kodu belirlenmemiş statü var (ör. vakıf/dernek); müşavire danışın."
- **Damga listesi:** Sütunlar: Sözleşme no, Malik, TCKN/VKN, Damga olayı, Olay tarihi, Kesilen damga. Kaynak DAMGA türü `dagilim_kesinti` satırlarıdır (damga payı → damga kaydı).
- **22/A listesi:**
  - Sütunlar: Vergi dairesi, Belge no, Sorgu tarihi, Borçlu, TCKN/VKN, Kesinti, Paket, Ödeme tarihi.
  - Sıra: vergi dairesi, borçlu.
  - Excel'de ikinci sayfa "Özet": vergi dairesi başına toplam.
- **Route:** `GET /api/raporlar/[rapor]?ay=YYYY-MM&bicim=xlsx|csv`.
  - `ay` `/^\d{4}-(0[1-9]|1[0-2])$/` biçiminde olmalıdır; `bicim` varsayılanı `xlsx`'tir.
  - Dosya adı `<rapor>-<YYYY-MM>.<uzantı>`.
  - `disaAktarimKaydi({ varlik: 'rapor', varlikId: rapor, belge: '<rapor>:<YYYY-MM>', kayitSayisi })` yazılır.
  - Oturum yoksa 401; bilinmeyen rapor 404; parametre hatası 400.
- **Raporlar ekranı (`/raporlar`):**
  - Her vergi listesi için bir kart: ay seçimi (`<input type="month">`, varsayılan önceki ay) ve biçim seçimi.
  - Formlar GET ile route'a gider; ekran tablo göstermez.

- [ ] **Step 1: Başarısız testleri yaz**

`rapor-vergi.test.ts`:

```ts
it('aynı kişinin iki dağılımı tek satırda toplanır')
it('041 ve 042 ayrı satır; kodsuz satır sonda')
it('stopajsız satır listelenmez')
it('Türkçe sıralama: Çelik, Demir, Şahin, Yılmaz')
```

`rapor.test.ts`. Kurulum: Eylül 2026'da ödenmiş bir paket ve Ekim'de kesinleşmiş bir paket; Task 11 servisleriyle `bugun` parametresi verilerek kurulur.

```ts
it('muhtasar 2026-09: yalnız ödeme tarihi Eylül olan ODENDI paketin satırı; brüt 10.000,00, stopaj 2.000,00, kod 041')
it('damga 2026-09: 226,80, olay ILK')
it('22/A 2026-09: vergi dairesine göre sıralı; Özet sayfasında toplam')
it('CSV: BOM ile başlar, ; ayraçlı, para "2000,00"')
it('raporIndir: bilinmeyen rapor null; ay "2026-13" IsKuraliHatasi; DISA_AKTAR yazılır')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run tests/unit/core/rapor-vergi.test.ts && pnpm test:integration -- rapor`
Expected: FAIL.

- [ ] **Step 3: Çekirdeği, servisleri, route'u ve ekranı yaz**

- [ ] **Step 4: Testleri ve mutasyonu çalıştır**

Run: `pnpm test && pnpm test:integration -- rapor && pnpm exec stryker run --mutate src/core/rapor/vergi.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS; mutasyon ≥ %90.

- [ ] **Step 5: Commit**

```bash
git add src/core/rapor src/server/rapor src/app/api/raporlar "src/app/(uygulama)/raporlar" src/components/ana-menu.tsx tests/unit/core/rapor-vergi.test.ts tests/integration/rapor.test.ts
git commit -m "feat(rapor): muhtasar, damga ve 22/A listeleri; Raporlar ekranı"
```

---

### Task 17: Ödenek/taahhüt, gecikmiş ödemeler ve sözleşme durum raporları

**Files:**
- Create: `src/server/rapor/yonetim.ts`
- Modify: `src/server/rapor/indir.ts` (`RaporAdi` += `'odenek' | 'gecikmis' | 'sozlesme-durum'`), `src/app/(uygulama)/raporlar/page.tsx`
- Test: `tests/integration/rapor-yonetim.test.ts`

**Interfaces:**
- Consumes: `taksitDagilimi` (Task 2; tahmin için), `vergiOranlari`, `artisTarihleri`, `artisIcinYururluk`.
- Produces:

```ts
export interface OdenekSatiri { ekonomikKod: string; birim: string; yuk: Para; odenen: Para; kalan: Para; tahmini: boolean }
export async function odenekRaporu(yil: number, bugun: Tarih): Promise<OdenekSatiri[]>
export interface GecikmisSatir {
  taksitId: number; sozlesmeId: number; sozlesmeNo: string; kisaAd: string; birim: string
  vade: Tarih; gecikmeGun: number; tutar: Para; durum: 'PLANLANDI' | 'PAKETTE' | 'ODEME_EMRINDE'; paketId: number | null
}
export async function gecikmisOdemeler(bugun: Tarih): Promise<GecikmisSatir[]>
export interface DurumSatiri {
  sozlesmeId: number; sozlesmeNo: string; kisaAd: string; birim: string; durum: SozlesmeDurumu
  baslangic: Tarih; bitisEtkin: Tarih | null; kalanGun: number | null
  guncelBedel: Para; bedelTabani: BedelTabani; sonrakiArtis: Tarih | null; acikHatirlatma: number
}
export async function sozlesmeDurumRaporu(bugun: Tarih): Promise<DurumSatiri[]>
```

**Kurallar:**
- **Ödenek:**
  - **Kapsam:** Vadesi `yil` içinde olan, IPTAL olmayan ve sözleşmesi TASLAK olmayan taksitler.
  - **Gider:**
    - Kesinleşmiş (KESINLESTI, ODEME_EMRINDE, ODENDI) bir aktif pakette olan taksitte gider, o paketteki dağılımın Σ (brut + kdv) toplamıdır.
    - Diğer taksitlerde gider tahminidir. Malik parçası Task 5'in `malikParcalari`'yla `bolunsun: false` verilerek bulunur; bakış günü kuralı aynıdır. `bugun` oranlarıyla `taksitDagilimi` çalıştırılır ve Σ (brut + kdv) alınır.
    - Tahmin hata verirse (hisse) taksit tutarı kullanılır ve satır `tahmini` olarak işaretlenir.
  - **Ödenen:** ODENDI taksitlerin gideri (sistem dışı ödenen ve göç dahil; bunlar için tahmin).
  - **Gruplama:** (sözleşme ekonomik kodu, birim adı); sıra ekonomik kod, sonra birim.
- **Gecikmiş ödemeler:**
  - Kapsam: `vade < bugün` ve durumu PLANLANDI, PAKETTE ya da ODEME_EMRINDE olan taksitler (sözleşme TASLAK değil).
  - Gecikme günü `gunFarki(vade, bugun)`; sıra vade, sonra sözleşme no.
- **Sözleşme durumu:**
  - Kapsam: TASLAK olmayan sözleşmeler.
  - `bitisEtkin` `artisIcinYururluk` ile bulunur; yürürlükte değilse fesih ya da bitiş tarihi kullanılır.
  - Güncel bedel: bugünü içeren kira dönemi, yoksa son dönem.
  - Sonraki artış: `artisTarihleri` içinde bugünden sonraki ilk tarih (kural YOK ise null).
  - Açık hatırlatma: ACIK ya da ERTELENDI satırların sayısı.
- **Ekran ve dışa aktarım:**
  - Raporlar ekranı ödenek kartında yıl girişi ve Excel bağlantısı bulunur.
  - Gecikmiş ödemeler ve sözleşme durumu tablo olarak ekranda gösterilir (en çok 500 satır; aşarsa "Excel'i indirin" notu). Her biri Excel bağlantısı da taşır.
  - Excel'ler `raporIndir` üzerinden üretilir: ödenek `?yil=YYYY`; diğer ikisi parametresizdir ve bugünü kullanır. Hepsi `DISA_AKTAR` yazar.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
it('ödenek 2026: ödenmiş Şubat taksiti dağılımdan (10.000), planlı aylar tahminî; GMSİ brüt = tutar, yük 120.000,00, ödenen 10.000,00')
it('ödenek: SIRKET malikli sözleşmede gider brüt + KDV (12.000/ay); NET sözleşmede brütleştirilmiş (8.000 net → 10.000)')
it('ödenek: ekonomik kod × birim gruplaması')
it('gecikmiş: PAKETTE taksit paket kimliğiyle listelenir; ODENDI ve vadesi gelmemiş listelenmez')
it('sözleşme durumu: artış onayı sonrası güncel bedel yeni bedel; sonraki artış tarihi; açık hatırlatma sayısı')
it('raporIndir("odenek", yil=abc) IsKuraliHatasi; geçerli yılda xlsx ve DISA_AKTAR')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- rapor-yonetim`
Expected: FAIL.

- [ ] **Step 3: Servisleri ve ekran bölümlerini yaz**

- [ ] **Step 4: Testleri çalıştır**

Run: `pnpm test:integration -- rapor && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/rapor "src/app/(uygulama)/raporlar" tests/integration/rapor-yonetim.test.ts
git commit -m "feat(rapor): ödenek/taahhüt, gecikmiş ödemeler ve sözleşme durum raporları"
```

---

### Task 18: Denetim dosyası (sözleşme bazında PDF)

**Files:**
- Create: `src/server/rapor/denetim-dosyasi.ts`, `src/server/cikti/belgeler/denetim-dosyasi.ts`, `src/app/api/sozlesmeler/[id]/denetim-dosyasi/route.ts`
- Modify: `src/app/(uygulama)/sozlesmeler/[id]/page.tsx` (başlık şeridine "Denetim dosyası (PDF)" bağlantısı)
- Test: `tests/integration/denetim-dosyasi.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DenetimDosyasiVerisi {
  kunye: { sozlesmeNo; durum; tasinmaz; birim; ekonomikKod; imzaTarihi; baslangic; bitis; ilkKiraBaslangici; bedel; bedelTabani; bedelTuru
           odemePeriyoduAy; artisKurali; ihaleDayanagi; onayBelgesiNo; onayBelgesiTarihi; oncekiSozlesmeNo: string | null }
  malikler: { ad; kimlikNo; pay; payda; gecerlilikBaslangic; gecerlilikBitis; iban: string | null; vekil: string | null }[]
  kiraDonemleri: { baslangic; bitis; bedel; taban; kaynak; aciklama }[]
  artislar: { donemBaslangic; referans; tavan; sozlesmeOrani; uygulanan; eskiBedel; yeniBedel; durum; onaylayan; onayZamani
              endeksOnayi: { deger: string; kaynak: string; onaylayan: string | null; onayZamani: string | null } | null; satirlar: HesapSatiri[] }[]
  taksitler: { donem; vade; tur; tutar; durum; odemeTarihi; paket: string | null; sistemDisi: boolean; satirlar: HesapSatiri[] }[]
  dagilimlar: { paket: string; donem; malik; brut; kdv; stopaj; damga; haciz; kesinti22a; net; satirlar: HesapSatiri[] }[]   // yalnız kesinleşmiş paketler
  damga: { olay; olayTarihi; matrah; tutar; tahsil; kalan; makbuz: boolean; iptal: boolean }[]
  olaylar: { zaman: string; kullanici: string | null; varlik: string; eylem: string }[]          // en yeni 500
}
export async function denetimDosyasiVerisi(sozlesmeId: number): Promise<DenetimDosyasiVerisi>
export function denetimDosyasiBolumleri(v: DenetimDosyasiVerisi): Content[][]
export async function denetimDosyasiPdf(sozlesmeId: number, baglam: IslemBaglami): Promise<{ dosyaAdi: string; icerik: Buffer }>
```

**Kurallar:**
- **Endeks onayı:** Artışın referans ayındaki onaylı `TUFE_12AY_ORT` satırıdır (onaylayan kullanıcı adı ve zamanı).
- **Olaylar:** Olay günlüğünün yalnızca zaman, kullanıcı, varlık ve eylem alanları alınır; `once` ve `sonra` alanları **yazılmaz** (KVKK).
- **Olay kapsamı:**
  - `varlik='sozlesme'` ve bu kimlik;
  - bu sözleşmenin `damga_kaydi` ve `taksit` kimlikleri;
  - taksitlerinden birini içeren `odeme_paketi` kimlikleri.
- **Yatay sayfa;** bölümler: künye, malikler, kira dönemleri, artışlar, taksitler, dağılımlar, damga, olay özeti.
- **Hesap izleri** (spec §11): Taksit ve dağılım satırlarının `satirlar` alanları (taksit ve dağılım `hesapGoruntusu`'ndan) her satırın altında küçük puntolu bir alt tabloda basılır. Sütunlar: kural, açıklama, formül, sonuç.
- **Dosya ve denetim:** Dosya adı `denetim-dosyasi-<sozlesmeNo yalnız [A-Za-z0-9-]>.pdf`. `disaAktarimKaydi({ varlik: 'sozlesme', varlikId, belge: 'DENETIM_DOSYASI', kayitSayisi: taksit sayısı })` yazılır.
- **Route:** `GET /api/sozlesmeler/[id]/denetim-dosyasi`; TASLAK sözleşmede 409.

- [ ] **Step 1: Başarısız testleri yaz**

```ts
it('PDF metni: sözleşme no, malik adı, kira dönemleri, artış oranı ve endeks onayı, taksit tablosu, paket adı, damga 226,80')
it('hesap izi: dağılım satırının "Stopaj" satırı ve formülü PDF metninde')
it('olay özeti AKTIFLESTIR ve KESINLESTIR eylemlerini içerir; başka sözleşmenin olayı yok; once/sonra içeriği yok')
it('DISA_AKTAR denetim satırı DENETIM_DOSYASI; TASLAK sözleşmede IsKuraliHatasi')
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm test:integration -- denetim-dosyasi`
Expected: FAIL.

- [ ] **Step 3: Veri yükleyiciyi, bölümleri, route'u ve bağlantıyı yaz**

- [ ] **Step 4: Testleri çalıştır**

Run: `pnpm test:integration -- denetim-dosyasi && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/rapor/denetim-dosyasi.ts src/server/cikti/belgeler/denetim-dosyasi.ts src/app/api/sozlesmeler "src/app/(uygulama)/sozlesmeler/[id]/page.tsx" tests/integration/denetim-dosyasi.test.ts
git commit -m "feat(rapor): sözleşme denetim dosyası (PDF)"
```

---

### Task 19: Uçtan uca akış, operasyon belgesi ve son doğrulama

**Files:**
- Create: `tests/e2e/odeme-paketi.spec.ts`
- Modify: `tests/e2e/global-setup.ts` (ikinci birim "E2E Ödeme Birimi"; paket yalnızca bu testin sözleşmesini içersin), `docs/OPERASYON.md`

**Interfaces:**
- Consumes: Task 6–14'ün ekranları ve indirme route'ları.

**E2E senaryosu** (gerçek bugün = `bugunIstanbul()`):
1. Giriş yapılır.
2. Sözleşme sihirbazıyla sözleşme girilir ve aktifleştirilir. Adımlar `ana-akis.spec.ts` ile aynıdır; şu değerler farklıdır:
   - sözleşme no `E2E-F2-001`;
   - harcama birimi "E2E Ödeme Birimi";
   - imza tarihi `2026-01-05` (sabit; damga hep 2026 azamisiyle hesaplanır);
   - başlangıç bu ayın 1'i, bitiş 12 ay sonrasının bir gün öncesi;
   - artış kuralı `YOK`. 2027 ve sonrasında da artış bekleme hatası oluşmaz; damga matrahı her zaman 120.000,00, damga 226,80'dir.
3. Kişi sayfasında borç sorgusu eklenir: bugün, borç yok.
4. `/odeme-paketleri` sayfasında yeni paket açılır. Birim "E2E Ödeme Birimi"dir; vade aralığı bu ayın başı ile sonudur.
5. Paket detayında "Hesapla" seçilir. Ön kontrolde hata olmamalı. Dağılım tablosunda `E2E-F2-001` satırının neti `7.773,20` olmalı (ilk ödeme, damga dahil).
6. "Kesinleştir" seçilir ve onay verilir. Durum "KESINLESTI" olmalı.
7. "Paket belgeleri (PDF)" indirilir (Playwright `download` olayı). Dosya adı `odeme-paketi-<id>.pdf` olmalı ve ilk baytlar `%PDF-` olmalı.
8. "Banka aktarım dosyası (Excel)" indirilir; dosya adı `.xlsx` ile bitmeli.
9. Ödeme emri girilir (`OE-2026-1`, bugün), ardından ödendi işaretlenir (bugün). Durum "ODENDI" olmalı.
10. Sözleşmenin Taksitler sekmesinde o ayın satırı ODENDI rozeti taşımalı.

**`docs/OPERASYON.md` eklemeleri** ("F2 — Ödeme paketleri" bölümü):
- **Kurulum:**
  - `IDARE_VKN` girilmeli (girilmezse föyde VKN boş kalır ve ön kontrol uyarı verir).
  - `MUHASEBE_FIS_HESAPLARI` muhasebe müdürlüğüyle teyit edilmeli.
  - Her yıl Aralık sonunda bir sonraki yılın `DAMGA_AZAMI` değeri girilmeli. Girilmezse yeni sözleşmede `DAMGA_HATA` hatırlatması açılır.
- **Aylık akış:**
  1. Paket oluştur → hesapla (tutarları gör) → 22/A sorgularını ve faturaları gir → yeniden hesapla → kesinleştir (aynı gün). Fatura ya da taksit değişikliği paketi taslağa döndürür; kesinleştirmeden önce son hesap gereklidir.
  2. PDF ve Excel'i al → ödeme emri no → ödendi.
  3. Ayın 20'sinde H9 hatırlatmasıyla muhtasar ve damga listelerini al.
- **Geçiş:** F2'den önce sistem dışında ödenmiş taksitler "Sistem dışında ödendi" ile kapatılır. F2 öncesi aktifleştirilmiş sözleşmelere ILK damga kaydı, gerekiyorsa Damga sekmesinden elle eklenir.
- **Müşavir teyit listesine eklenecekler:**
  - haciz ve 22/A kesintilerinin 333 hesabına kaydı;
  - 22/A ve haciz toplamasının hak sahibi bazında yapılması;
  - artış onayı beklerken ödemenin engellenmesi (spec gereği engel);
  - vakıf/dernek muhtasar kodu;
  - 22/A eşiğinin damga ve haciz düşüldükten sonraki tutara uygulanması;
  - muhtasar listesinin tahakkuk yerine ödeme tarihine göre alınması (stopaj "hesaben ödemede" de doğar; GVK 94);
  - tek borç sorgusunda birden çok vergi dairesine borç (şimdilik tek daire);
  - ILK damga taahhüt notunun KDV'li sözleşmede KDV'yi içermesi.

- [ ] **Step 1: E2E testini yaz**

- [ ] **Step 2: E2E testini çalıştır**

Run: `pnpm test:e2e`
Expected: PASS (2 test: `ana-akis` ve `odeme-paketi`).

- [ ] **Step 3: Operasyon belgesini güncelle**

- [ ] **Step 4: Son doğrulama (hepsi yeşil olmalı)**

Run (sırayla): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm test:mutation`
Expected: hepsi PASS; Stryker toplam skoru ≥ %90 (eşik `break: 90`).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/odeme-paketi.spec.ts tests/e2e/global-setup.ts docs/OPERASYON.md
git commit -m "test(e2e): ödeme paketi akışı; operasyon belgesine F2 bölümü"
```
