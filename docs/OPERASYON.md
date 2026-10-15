# KBB Kira Takip — Operasyon

## İlk kurulum
1. Sunucuda Docker ve Docker Compose kurulu olmalı. Sunucunun `evds3.tcmb.gov.tr` adresine HTTPS çıkışı olmalı.
2. `.env` dosyasını oluşturun:
   ```
   POSTGRES_PASSWORD=<güçlü parola>
   DATABASE_URL=postgresql://kbbkira:<güçlü parola>@postgres:5432/kbbkira?schema=public
   SESSION_SECRET=<openssl rand -base64 48 çıktısı>
   EVDS_API_KEY=<evds3.tcmb.gov.tr profilinden alınan anahtar>
   APP_URL=https://kira.konya.bel.tr
   TZ=Europe/Istanbul
   ```
   `.env` web, worker ve migrate servislerinin üçüne de verilir. `SESSION_SECRET` (en az 32 karakter) worker için de zorunludur: worker açılışta ortamı doğrular (`ortam()`), değer yoksa kapanır.
3. `docker compose pull` (registry) veya `docker compose build` (kaynaktan), sonra `docker compose up -d`.
4. İlk kullanıcıyı oluşturun: `docker compose exec web node_modules/.bin/tsx scripts/kullanici-olustur.ts --kullanici-adi <ad> --ad-soyad "<Ad Soyad>"`. Geçici şifre bir kez yazdırılır.
5. Uygulamada sırasıyla şunları yapın:
   - Yönetim → Parametreler: `EVDS_SERI_YIUFE` seri kodunu EVDS seri listesinden doğrulayın (spec §21-10).
   - Birimler ve taşınmazları girin, ardından malikleri ekleyin.

## Ters vekil (reverse proxy)
Uygulama yalnızca kurumun ters vekili üzerinden erişilebilir olmalıdır.

- **Ağ erişimi:** `docker-compose.yml` web portunu varsayılan olarak `127.0.0.1` adresine bağlar (`WEB_BIND`). Vekil aynı sunucudaysa değiştirmeyin. Vekil başka bir makinedeyse `.env` içinde `WEB_BIND`'i vekilin eriştiği özel arayüz adresine ayarlayın (ör. `WEB_BIND=10.0.0.12`); `0.0.0.0` vermeyin. `WEB_PORT` (varsayılan 3000) ile port değiştirilebilir.
- **İstemci IP'si (`X-Forwarded-For`):** Vekil bu başlığı tam **bir** güvenilir sekmeyle ayarlamalı ya da sonuna eklemelidir; girdiler çıplak IP adresi olmalıdır (port ve köşeli parantez yok). Uygulama yalnızca **en sağdaki** girdiye güvenir ve girişteki IP sınırı ile denetim kaydındaki IP için onu kullanır. İstemcinin kendi gönderdiği başlık değeri güvenilmez: vekil başlığı ezmeli (`$remote_addr`) ya da kendi gördüğü adresi sona eklemelidir (`$proxy_add_x_forwarded_for`).
- **Vekil yoksa:** Geçerli bir IP bulunamazsa IP sınırı atlanır; yalnızca hesap kilidi (art arda hatalı girişte geçici kilit) çalışır. Üretimde bu durum kabul edilmemelidir.
- **HTTPS:** Hizmet HTTPS üzerinden sunulmalı ve `.env` içindeki `APP_URL` `https://` ile başlamalıdır. Oturum çerezi (`kbbkira_oturum`) yalnızca `APP_URL` `https://` ile başlıyorsa `Secure` işaretlenir; TLS vekilde sonlansa bile `APP_URL` https olmalıdır.
- **Host başlığı (sunucu eylemleri):** Next.js sunucu eylemleri `Origin` başlığını `Host` (ya da `X-Forwarded-Host`) ile karşılaştırır; uyuşmazsa istek reddedilir (formlar "gönderilemedi" ile başarısız olur). Seçilen yöntem: **vekil özgün `Host` başlığını iletir** (nginx'te `proxy_set_header Host $host;`). Vekil bunu yapamıyorsa ikinci seçenek `X-Forwarded-Host` başlığını genel adresle ayarlamaktır. Hiçbiri mümkün değilse `next.config.ts` içinde `experimental.serverActions.allowedOrigins` listesine genel alan adı (ör. `kira.konya.bel.tr`) eklenip imaj yeniden üretilmelidir.
- **Takvim aboneliği günlüğü:** Vekil `/takvim/<token>.ics` yolunu günlüğe **yazmamalı** ya da token'ı maskelemelidir; token bir taşıyıcı kimlik bilgisidir (adresi bilen herkes takvimi okur). Uygulamanın kendi istek günlüğü bu yolu zaten dışarıda bırakır.

Örnek (nginx, yalnızca yönlendirme):
```
server {
  listen 443 ssl;
  server_name kira.konya.bel.tr;
  # ssl_certificate ... ssl_certificate_key ...

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /takvim/ {
    access_log off; # token adreste: günlüğe yazılmaz
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
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

## Güncelleme
`docker compose pull && docker compose up -d`. `migrate` servisi önce migrasyonları uygular, web ve worker ondan sonra başlar.

## Gizli anahtar (`SESSION_SECRET`) ve döndürme
`SESSION_SECRET` oturum belirteçlerinin ve takvim aboneliği belirteçlerinin özetini (HMAC) hesaplamakta kullanılır. Değeri değiştirmek **tüm oturumları ve tüm takvim adreslerini** geçersiz kılar: kullanıcılar yeniden giriş yapar ve takvim bağlantılarını Hesabım ekranından yenileyip takvim uygulamalarına yeniden eklemelidir. Döndürmeyi mesai dışında yapın ve kullanıcılara önceden duyurun. Yeni değer web ve worker için aynı `.env`'den okunur; ikisini birlikte yeniden başlatın (`docker compose up -d`).

## Hesap kilidi (acil durum)
Art arda hatalı girişten kilitlenen bir hesabı, uygulamaya girilemiyorsa veritabanından açın:
```
docker compose exec postgres psql -U kbbkira -d kbbkira -c "UPDATE kullanici SET kilit_bitis = NULL, hatali_giris_sayisi = 0 WHERE kullanici_adi = '<kullanıcı adı>';"
```
Uygulamaya girebilen bir yönetici varsa aynı işi Yönetim → Kullanıcılar ekranındaki şifre sıfırlama yapar: yeni geçici şifre verir, hatalı giriş sayacını ve kilidi temizler, oturumları ve takvim bağlantısını kapatır.

## Yedekleme (her gece, 30 gün saklama)
`/etc/cron.d/kbb-kira-yedek`:
```
30 2 * * * root cd /opt/kbb-kira && docker compose exec -T postgres pg_dump -U kbbkira -Fc kbbkira > /yedek/kbbkira-$(date +\%F).dump && docker run --rm -v kbb-kira_belgeler:/kaynak -v /yedek/belgeler:/hedef alpine sh -c "cp -an /kaynak/. /hedef/" && find /yedek -name 'kbbkira-*.dump' -mtime +30 -delete
```

## Aylık geri yükleme testi
1. `docker run --rm -d --name geri-yukle -e POSTGRES_PASSWORD=x postgres:17`
2. `docker exec -i geri-yukle createdb -U postgres deneme && docker exec -i geri-yukle pg_restore -U postgres -d deneme < /yedek/kbbkira-<tarih>.dump`
3. `docker exec geri-yukle psql -U postgres -d deneme -c "select count(*) from sozlesme"`; sayı canlı sistemle uyuşmalı.
4. `docker rm -f geri-yukle`. Sonucu ve tarihi bu dosyanın sonundaki çizelgeye yazın.

## Sorun giderme
- **Panoda "son 26 saatte çalışmadı" bandı:** `docker compose logs worker --tail 200` ile log'a bakın. Ardından Yönetim → Zamanlanmış işler → "Şimdi çalıştır".
- **"EVDS'e ulaşılamadı":** Anahtar ve ağ çıkışını kontrol edin. Bu sürede Endeksler ekranından TÜİK bülteniyle elle giriş yapın.
- **Parametre yürürlüğü bitti (H13):** Yönetim → Parametreler'den yeni yürürlük kaydı ekleyin. Örnek: 2027 `DAMGA_AZAMI`.
- **Formlar giriş yapıldığı halde "gönderilemedi" diyor / eylemler reddediliyor:** Vekilin özgün `Host` (ya da `X-Forwarded-Host`) başlığını ilettiğini denetleyin (bkz. Ters vekil).
- **Worker açılışta kapanıyor ("SESSION_SECRET en az 32 karakter olmalı"):** Worker'ın `.env`'de `SESSION_SECRET` aldığından emin olun.

## CI notu (GitLab)
Birim testleri Prisma'ya bağımlı modülleri içe aktarır; CI hattı `pnpm test` öncesinde `pnpm prisma generate` çalıştırmalıdır (`.gitlab-ci.yml` bunu yapar). Entegrasyon ve E2E işleri yalnızca `*_test` adlı yerel/servis veritabanında çalışır; koruma başka bir adreste testleri reddeder.

## Geri yükleme testi çizelgesi
| Tarih | Yedek dosyası | Sonuç | Yapan |
|---|---|---|---|
