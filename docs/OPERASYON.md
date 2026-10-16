# KBB Kira Takip — Operasyon

## İlk kurulum
1. Sunucu hazırlığı:
   - Docker ve Docker Compose kurulu olmalı. Yeniden başlatmada konteynerlerin geri gelmesi için `systemctl enable docker`.
   - Günlük dosyalarının diski doldurmaması için `/etc/docker/daemon.json` içine `{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}}` yazıp `systemctl restart docker` çalıştırın.
   - Sunucunun `evds3.tcmb.gov.tr` adresine **doğrudan** HTTPS çıkışı olmalı (güvenlik duvarı kuralı). Node `fetch` varsayılan olarak `HTTP_PROXY`/`HTTPS_PROXY` ortam değişkenlerini yok sayar; bu yüzden vekil tanımlamak çıkışı vekile yönlendirmez. Vekil kaçınılmazsa worker'ın ortamına `NODE_USE_ENV_PROXY=1` ekleyin (Node 22.21+/24: `fetch` o zaman `HTTPS_PROXY`'yi dikkate alır); ayarı bir kez deneyip EVDS'e erişimi doğrulayın (Yönetim → Zamanlanmış işler → `endeks-cek` → "Şimdi çalıştır").
2. `.env` dosyasını oluşturun ve `chmod 600 .env` ile yalnızca sahibine açın:
   ```
   POSTGRES_PASSWORD=<openssl rand -hex 24 çıktısı>
   DATABASE_URL=postgresql://kbbkira:<aynı parola>@postgres:5432/kbbkira?schema=public
   SESSION_SECRET=<openssl rand -base64 48 çıktısı>
   EVDS_API_KEY=<evds3.tcmb.gov.tr profilinden alınan anahtar>
   APP_URL=https://kira.konya.bel.tr
   TZ=Europe/Istanbul
   ```
   - `.env` web, worker ve migrate servislerinin üçüne de verilir. `SESSION_SECRET` (en az 32 karakter) worker için de zorunludur: worker açılışta ortamı doğrular (`ortam()`), değer yoksa kapanır.
   - Veritabanı parolası URL için güvenli olmalı: ya hex üretin (yukarıdaki gibi) ya da `DATABASE_URL` içinde yüzde-kodlayın (`@` → `%40`, `/` → `%2F`, `:` → `%3A`, `#` → `%23`). Aksi halde adres bozulur ve bağlantı kurulamaz. `POSTGRES_PASSWORD` ile `DATABASE_URL`'deki parola aynı olmalıdır.
   - `.env.example` dosyasını olduğu gibi kopyalamayın. İçindeki `BELGE_DIZINI=./var/belgeler` imajın `/data/belgeler` değerini ezer; belgeler volume'un dışına, konteynerin geçici katmanına yazılır ve konteyner yenilenince kaybolur. Üretim `.env`'inde `BELGE_DIZINI` tanımlamayın.
3. İmajı hazırlayın ve başlatın:
   - Kaynaktan: `docker compose build`, sonra `docker compose up -d`. İmaj adı `KBB_KIRA_IMAJ` değişkeninden gelir; tanımlı değilse `kbb-kira:latest` kullanılır (yerelde üretilen imaj).
   - Registry'den (GitLab CI `imaj` işinin ittiği imaj): `.env` içine `KBB_KIRA_IMAJ=<registry>/<grup>/<proje>:latest` ekleyin (CI'daki `$CI_REGISTRY_IMAGE` adresi). Sunucuda bir kez `docker login <registry>` çalıştırın; kullanıcı olarak yalnızca `read_registry` yetkili bir dağıtım jetonu kullanın. Kimlik bilgisi `~/.docker/config.json` içine yazılır; bu dosya yalnızca root tarafından okunabilmelidir. Sonra `docker compose pull && docker compose up -d`.
   - `migrate` servisi tek seferlik bir işidir ve web/worker ona bağlıdır; her `docker compose up -d` çağrısında yeniden çalışır: önce migrasyonları, sonra tohum verisini (seed) uygular.
   - Seed "yoksa oluştur" biçimindedir (`update: {}`): var olan kayıtları ezmez, yöneticinin tohum satırları üzerindeki düzenlemeleri korunur. Ancak yöneticinin sildiği ya da yürürlük başlangıç tarihini değiştirdiği bir tohum parametresi veya tatil satırı bir sonraki `up -d` çağrısında yeniden oluşturulur. Bir parametre değerinin artık istenmemesi gerekiyorsa satırı silmek yerine yürürlük bitişi vererek geçerliliğini sonlandırın; tatillerde yeniden eklenmesi kabul edilmelidir.
4. İlk kullanıcıyı oluşturun: `docker compose exec web node_modules/.bin/tsx scripts/kullanici-olustur.ts --kullanici-adi <ad> --ad-soyad "<Ad Soyad>"`. Geçici şifre bir kez yazdırılır.
5. Uygulamada sırasıyla şunları yapın:
   - Yönetim → Parametreler: `EVDS_SERI_YIUFE` seri kodunu EVDS seri listesinden doğrulayın (spec §21-10).
   - Birimler ve taşınmazları girin, ardından malikleri ekleyin.

Compose proje adı `kbb-kira-prod`'dur (`docker-compose.yml` içinde `name:`). Konteynerler `kbb-kira-prod-web-1` gibi, volume'lar `kbb-kira-prod_pgdata` ve `kbb-kira-prod_belgeler` adını taşır. Komutları her zaman `docker-compose.yml`'in bulunduğu dizinde (`/opt/kbb-kira`) çalıştırın.

## Ters vekil (reverse proxy)
Uygulama yalnızca kurumun ters vekili üzerinden erişilebilir olmalıdır.

- **Ağ erişimi:** `docker-compose.yml` web portunu varsayılan olarak `127.0.0.1` adresine bağlar (`WEB_BIND`). Vekil aynı sunucudaysa değiştirmeyin. Vekil başka bir makinedeyse `.env` içinde `WEB_BIND`'i vekilin eriştiği özel arayüz adresine ayarlayın (ör. `WEB_BIND=10.0.0.12`); `0.0.0.0` vermeyin. `WEB_PORT` (varsayılan 3000) ile port değiştirilebilir.
- **İstemci IP'si (`X-Forwarded-For`):** Vekil bu başlığı tam **bir** güvenilir sekmeyle ayarlamalı ya da sonuna eklemelidir; girdiler çıplak IP adresi olmalıdır (port ve köşeli parantez yok). Uygulama yalnızca **en sağdaki** girdiye güvenir ve girişteki IP sınırı ile denetim kaydındaki IP için onu kullanır. İstemcinin kendi gönderdiği başlık değeri güvenilmez: vekil başlığı ezmeli (`$remote_addr`) ya da kendi gördüğü adresi sona eklemelidir (`$proxy_add_x_forwarded_for`).
- **Vekil yoksa:** Geçerli bir IP bulunamazsa IP sınırı atlanır; yalnızca hesap kilidi (art arda hatalı girişte geçici kilit) çalışır. Üretimde bu durum kabul edilmemelidir.
- **HTTPS:** Hizmet HTTPS üzerinden sunulmalı ve `.env` içindeki `APP_URL` `https://` ile başlamalıdır. Oturum çerezi (`kbbkira_oturum`) yalnızca `APP_URL` `https://` ile başlıyorsa `Secure` işaretlenir; TLS vekilde sonlansa bile `APP_URL` https olmalıdır.
- **Host başlığı (sunucu eylemleri):** Next.js sunucu eylemleri `Origin` başlığını `Host` (ya da `X-Forwarded-Host`) ile karşılaştırır; uyuşmazsa istek reddedilir (formlar "gönderilemedi" ile başarısız olur). Seçilen yöntem: **vekil özgün `Host` başlığını iletir** (nginx'te `proxy_set_header Host $host;`) ve ayrıca `X-Forwarded-Host $host` ayarlar. Vekil bunları yapamıyorsa `next.config.ts` içinde `experimental.serverActions.allowedOrigins` listesine genel alan adı (ör. `kira.konya.bel.tr`) eklenip imaj yeniden üretilmelidir.
- **Takvim aboneliği günlüğü:** `/takvim/<token>.ics` yolundaki token bir taşıyıcı kimlik bilgisidir (adresi bilen herkes takvimi okur). Vekil bu yolu erişim günlüğüne **yazmamalı**. Hata günlüğü (`error_log`) ise bir hata oluşunca istek satırını (token dahil) yazabilir; bu yol için seviye `crit`'e indirilir ve kalan risk (kritik hatada token görünebilir) kabul edilir: günlük dosyalarına erişim yalnızca sistem yöneticilerinde olmalıdır. Uygulamanın kendi istek günlüğü bu yolu zaten dışarıda bırakır.

Örnek (nginx, yalnızca yönlendirme):
```
server {
  listen 443 ssl;
  server_name kira.konya.bel.tr;
  # ssl_certificate ... ssl_certificate_key ...

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /takvim/ {
    access_log off;                                  # token adreste: erişim günlüğüne yazılmaz
    error_log /var/log/nginx/takvim-hata.log crit;   # hata günlüğü yalnızca kritik hatalar
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Veritabanı bağlantı havuzu
`docker-compose.yml` web ve worker servislerinin `DATABASE_URL` değerine havuz ayarlarını `.env`'deki adresin sonuna ekler:

| Servis | Eklenen parametreler |
|---|---|
| web | `connection_limit=15&pool_timeout=30` |
| worker | `connection_limit=10&pool_timeout=30` |

`.env` içindeki `DATABASE_URL` bir sorgu kısmı içermelidir (örnekte `?schema=public`); aksi halde birleştirilen adres geçersiz olur.

- PostgreSQL `max_connections` değeri **en az 50** olmalıdır (web 15 + worker 10 + yönetim/yedek bağlantıları). `postgres:17` varsayılanı 100'dür; elle düşürmeyin.
- Uygulama rolünde `idle_in_transaction_session_timeout` değerini en uzun işin süresinin altına **ayarlamayın** (kilit işlemi en çok 60 dakika açık kalabilir; ayarlanacaksa bundan uzun olmalı). Zamanlanmış işlerin kilidini tutan işlem tasarım gereği "idle in transaction" bekler; zaman aşımı bu bağlantıyı keser, iş kilidi düşer ve aynı iş iki kez çalışabilir.

## Güncelleme ve geri alma
Güncelleme: kaynaktan kuruluysa kodu çekip `docker compose build && docker compose up -d`; registry kullanılıyorsa `docker compose pull && docker compose up -d`. `migrate` servisi önce migrasyonları uygular, web ve worker ondan sonra başlar.

Geri alma (registry): `:latest` etiketi her yayında yer değiştirir, ona dönülemez. GitLab CI `imaj` işi her yayında ayrıca `:<kısa-SHA>` etiketi de ittiği için önceki sürüm SHA etiketiyle sabitlenir:
1. GitLab Container Registry'den çalıştığı bilinen önceki imajın SHA etiketini bulun.
2. `.env` içinde `KBB_KIRA_IMAJ=<registry>/<grup>/<proje>:<önceki-sha>` yapın.
3. `docker compose pull && docker compose up -d`.

Dönüş tamamlanınca `.env`'i yeniden `:latest`'e almak yerine bir sonraki düzeltme yayınlanana kadar SHA'da bırakın. Migrasyonlar geri alınmaz: şema değişikliği içeren bir sürümden dönülüyorsa veritabanı yeni şemada kalır; gerekirse son yedeği geri yükleyin (aşağıdaki geri yükleme adımları).

## Tatil takvimi
İş günü hesapları resmi tatil tablosunu kullanır: H2 ödeme emri hazırlığı tarihi, H4 endeks yayın günü ve H6 fesih bildirimi son günü. Eksik bir tatil bu tarihleri bir gün yanlış verir.

- Dini bayramlar (Ramazan ve Kurban bayramları, arifeler yarım gün) her yıl Diyanet takvimi ilan edildikten sonra elle girilmelidir: Yönetim → Tatiller → "Tatil ekle" (tarih `gg.aa.yyyy`, ad; arifeler için "Yarım gün (arife)" işaretlenir). Tohum verisi 2026–2027'yi tam, 2028'i yalnızca sabit tarihli tatillerle içerir; **2028 dini bayramları girilmemiştir**.
- Girişten sonra Yönetim → Parametreler'den `TATIL_TAKVIMI_GECERLILIK` için **yeni yürürlük kaydı** ekleyin: değer `TAM`, yürürlük başlangıcı önceki kaydın bitişinden sonraki gün (ör. `01.01.2028`), bitişi yeni dönemin son günü (ör. `31.12.2028`).
- Kayıt süresi dolmadan önce (`HATIRLATMA_MEVZUAT_ONCE_GUN`, varsayılan 30 gün) H13 hatırlatması Pano'da görünür; yeni yürürlük kaydı eklenince kapanır.

## Gizli anahtar (`SESSION_SECRET`) ve döndürme
`SESSION_SECRET` oturum belirteçlerinin ve takvim aboneliği belirteçlerinin özetini (HMAC) hesaplamakta kullanılır. Değeri değiştirmek **tüm oturumları ve tüm takvim adreslerini** geçersiz kılar: kullanıcılar yeniden giriş yapar ve takvim bağlantılarını Hesabım ekranından yenileyip takvim uygulamalarına yeniden eklemelidir. Döndürmeyi mesai dışında yapın ve kullanıcılara önceden duyurun. Yeni değer web ve worker için aynı `.env`'den okunur; ikisini birlikte yeniden başlatın (`docker compose up -d`).

## Hesap kilidi (acil durum)
Art arda hatalı girişten kilitlenen bir hesabı, uygulamaya girilemiyorsa veritabanından açın:
```
docker compose exec postgres psql -U kbbkira -d kbbkira -c "UPDATE kullanici SET kilit_bitis = NULL, hatali_giris_sayisi = 0 WHERE kullanici_adi = '<kullanıcı adı>';"
```
Uygulamaya girebilen bir yönetici varsa aynı işi Yönetim → Kullanıcılar ekranındaki şifre sıfırlama yapar: yeni geçici şifre verir, hatalı giriş sayacını ve kilidi temizler, oturumları ve takvim bağlantısını kapatır.

## Yedekleme (her gece, 30 gün saklama)
İlk kullanımdan önce `mkdir -p /yedek/belgeler`. `/etc/cron.d/kbb-kira-yedek` (tek satır):
```
30 2 * * * root cd /opt/kbb-kira && docker compose exec -T postgres pg_dump -U kbbkira -Fc kbbkira > /yedek/kbbkira-$(date +\%F).dump && docker run --rm --volumes-from "$(docker compose ps -a -q web)" -v /yedek/belgeler:/hedef alpine sh -c "cp -an /data/belgeler/. /hedef/" && find /yedek -name 'kbbkira-*.dump' -mtime +30 -delete
```
Belge volume'unun adı komutta yazılı değildir: `--volumes-from` web konteynerinin `/data/belgeler` bağlantısını olduğu gibi alır (volume adı `kbb-kira-prod_belgeler`). `cd` dizini `docker-compose.yml`'in bulunduğu yer olmalıdır; satırdaki `%` karakteri cron'da `\%` yazılır.

## Aylık geri yükleme testi
1. `docker run --rm -d --name geri-yukle -e POSTGRES_PASSWORD=x postgres:17`
2. Sunucunun hazır olmasını bekleyin (TCP üzerinden; ilk başlatma sırasındaki geçici sunucu sayılmaz): `until docker exec geri-yukle pg_isready -U postgres -h 127.0.0.1; do sleep 1; done`
3. `docker exec geri-yukle createdb -U postgres deneme && docker exec -i geri-yukle pg_restore --no-owner -U postgres -d deneme < /yedek/kbbkira-<tarih>.dump` (`--no-owner`: yedekteki `kbbkira` rolü bu geçici sunucuda yoktur).
4. `docker exec geri-yukle psql -U postgres -d deneme -c "select count(*) from sozlesme"`; sayı canlı sistemle uyuşmalı.
5. `docker rm -f geri-yukle`. Sonucu ve tarihi bu dosyanın sonundaki çizelgeye yazın.

## Sorun giderme
- **Panoda "son 26 saatte çalışmadı" bandı:** Önce `docker compose ps` ile worker'ın `running` durumda olduğuna bakın (worker'ın healthcheck'i yoktur; `Restarting` görünüyorsa `docker compose logs worker --tail 200` hatayı gösterir). Sonra Yönetim → Zamanlanmış işler → "Şimdi çalıştır".
- **"EVDS'e ulaşılamadı":** Anahtar ve ağ çıkışını kontrol edin (çıkış tercihen doğrudan olmalı; vekil için bkz. İlk kurulum, adım 1). Bu sürede Endeksler ekranından TÜİK bülteniyle elle giriş yapın.
- **Parametre yürürlüğü bitti (H13):** Yönetim → Parametreler'den yeni yürürlük kaydı ekleyin. Örnek: 2027 `DAMGA_AZAMI`. Tatil takvimi için bkz. "Tatil takvimi".
- **Formlar giriş yapıldığı halde "gönderilemedi" diyor / eylemler reddediliyor:** Vekilin özgün `Host` (ya da `X-Forwarded-Host`) başlığını ilettiğini denetleyin (bkz. Ters vekil).
- **Worker açılışta kapanıyor ("SESSION_SECRET en az 32 karakter olmalı"):** Worker'ın `.env`'de `SESSION_SECRET` aldığından emin olun.
- **Yüklenen belgeler yeniden başlatmada kayboluyor:** `.env` içinde `BELGE_DIZINI` tanımlı olabilir (bkz. İlk kurulum, `.env.example` uyarısı); satırı silip `docker compose up -d` çalıştırın.

## CI notu (GitLab)
Birim testleri Prisma'ya bağımlı modülleri içe aktarır; CI hattı `pnpm test` öncesinde `pnpm prisma generate` çalıştırmalıdır (`.gitlab-ci.yml` bunu yapar). `node:22-bookworm-slim` imajında OpenSSL yoktur; hat her işin başında kurar (Prisma sorgu motoru için). Entegrasyon ve E2E işleri yalnızca `*_test` adlı yerel/servis veritabanında çalışır; koruma başka bir adreste testleri reddeder.

## Geri yükleme testi çizelgesi
| Tarih | Yedek dosyası | Sonuç | Yapan |
|---|---|---|---|
