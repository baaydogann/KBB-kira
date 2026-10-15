-- CreateEnum
CREATE TYPE "TasinmazTuru" AS ENUM ('BINA', 'ISYERI', 'ARSA', 'DEPO', 'KONUT');

-- CreateEnum
CREATE TYPE "KullanimAmaci" AS ENUM ('HIZMET_BINASI', 'LOJMAN', 'DEPO', 'OTOPARK', 'SOSYAL_TESIS', 'DIGER');

-- CreateEnum
CREATE TYPE "KisiTipi" AS ENUM ('GERCEK', 'TUZEL');

-- CreateEnum
CREATE TYPE "VergiStatusu" AS ENUM ('GMSI_GERCEK', 'SERBEST_MESLEK', 'TICARI_AKTIF', 'BASIT_USUL', 'SIRKET', 'KOOPERATIF', 'VAKIF_DERNEK', 'KAMU');

-- CreateEnum
CREATE TYPE "BedelTabani" AS ENUM ('AYLIK', 'YILLIK');

-- CreateEnum
CREATE TYPE "BedelTuru" AS ENUM ('BRUT', 'NET');

-- CreateEnum
CREATE TYPE "OdemeZamani" AS ENUM ('PESIN', 'DONEM_SONU');

-- CreateEnum
CREATE TYPE "VadeKurali" AS ENUM ('DONEM_BASI_ARTI_GUN', 'AYIN_GUNU', 'DONEM_SONU_ARTI_GUN');

-- CreateEnum
CREATE TYPE "ArtisKurali" AS ENUM ('TUFE12', 'YIUFE', 'TUFE_YIUFE_ORT', 'SABIT', 'YOK', 'ELLE');

-- CreateEnum
CREATE TYPE "DegisimTuru" AS ENUM ('ON_IKI_AY_ORT', 'YILLIK');

-- CreateEnum
CREATE TYPE "KistYontemi" AS ENUM ('GERCEK_GUN', 'OTUZ_GUN');

-- CreateEnum
CREATE TYPE "DamgaTahsil" AS ENUM ('ISTIHKAKTAN', 'MALIK_BEYAN');

-- CreateEnum
CREATE TYPE "IhaleDayanagi" AS ENUM ('DT_4734_22E', 'PZ_2886_51L', 'DIGER');

-- CreateEnum
CREATE TYPE "SozlesmeDurumu" AS ENUM ('TASLAK', 'AKTIF', 'UZADI', 'FESHEDILDI', 'SONA_ERDI');

-- CreateEnum
CREATE TYPE "KiraDonemiKaynagi" AS ENUM ('ILK', 'ARTIS', 'TESPIT', 'ANLASMA', 'ELLE');

-- CreateEnum
CREATE TYPE "ArtisDurumu" AS ENUM ('BEKLEMEDE', 'HESAPLANDI', 'ONAYLANDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "TaksitTuru" AS ENUM ('NORMAL', 'FARK', 'KIST');

-- CreateEnum
CREATE TYPE "TaksitDurumu" AS ENUM ('PLANLANDI', 'PAKETTE', 'ODEME_EMRINDE', 'ODENDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "OranSerisi" AS ENUM ('TUFE_12AY_ORT', 'TUFE_YILLIK', 'YIUFE_12AY_ORT', 'YIUFE_YILLIK');

-- CreateEnum
CREATE TYPE "EndeksKaynagi" AS ENUM ('EVDS', 'ELLE');

-- CreateEnum
CREATE TYPE "OnayDurumu" AS ENUM ('BEKLIYOR', 'ONAYLANDI');

-- CreateEnum
CREATE TYPE "HatirlatmaDurumu" AS ENUM ('ACIK', 'TAMAMLANDI', 'ERTELENDI', 'OTOMATIK_KAPANDI');

-- CreateEnum
CREATE TYPE "Oncelik" AS ENUM ('KRITIK', 'YUKSEK', 'NORMAL');

-- CreateEnum
CREATE TYPE "BelgeTuru" AS ENUM ('SOZLESME', 'TAPU', 'ONAY_BELGESI', 'PIYASA_ARASTIRMA', 'BORC_YAZISI', 'FATURA', 'EK_PROTOKOL', 'MAHKEME_KARARI', 'DAMGA_MAKBUZU', 'DIGER');

-- CreateEnum
CREATE TYPE "IsDurumu" AS ENUM ('CALISIYOR', 'BASARILI', 'HATALI', 'ATLANDI');

-- CreateTable
CREATE TABLE "kullanici" (
    "id" SERIAL NOT NULL,
    "kullanici_adi" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "sifre_hash" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "sifre_degismeli" BOOLEAN NOT NULL DEFAULT true,
    "hatali_giris_sayisi" INTEGER NOT NULL DEFAULT 0,
    "kilit_bitis" TIMESTAMPTZ(3),
    "son_giris" TIMESTAMPTZ(3),
    "ics_token_hash" TEXT,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kullanici_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oturum" (
    "id" SERIAL NOT NULL,
    "kullanici_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "bitis" TIMESTAMPTZ(3) NOT NULL,
    "mutlak_bitis" TIMESTAMPTZ(3) NOT NULL,
    "iptal_zamani" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oturum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birim" (
    "id" SERIAL NOT NULL,
    "ad" TEXT NOT NULL,
    "kurumsal_kod" TEXT NOT NULL,
    "fonksiyonel_kod" TEXT NOT NULL,
    "finans_kodu" TEXT NOT NULL DEFAULT '5',
    "gerceklestirme_gorevlisi" TEXT,
    "harcama_yetkilisi" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "birim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasinmaz" (
    "id" SERIAL NOT NULL,
    "tur" "TasinmazTuru" NOT NULL,
    "kisa_ad" TEXT NOT NULL,
    "adres" TEXT NOT NULL,
    "il" TEXT NOT NULL DEFAULT 'Konya',
    "ilce" TEXT NOT NULL,
    "mahalle" TEXT,
    "ada" TEXT,
    "parsel" TEXT,
    "bagimsiz_bolum" TEXT,
    "tapu_bilgisi" TEXT,
    "m2" DECIMAL(12,2),
    "kullanan_birim_id" INTEGER,
    "kullanim_amaci" "KullanimAmaci" NOT NULL,
    "notlar" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasinmaz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kisi" (
    "id" SERIAL NOT NULL,
    "tip" "KisiTipi" NOT NULL,
    "tckn" TEXT,
    "vkn" TEXT,
    "ad" TEXT,
    "soyad" TEXT,
    "unvan" TEXT,
    "vergi_dairesi" TEXT,
    "vergi_statusu" "VergiStatusu" NOT NULL,
    "statu_teyitli" BOOLEAN NOT NULL DEFAULT false,
    "telefon" TEXT,
    "adres" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kisi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iban" (
    "id" SERIAL NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "iban" TEXT NOT NULL,
    "banka_adi" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "iban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sozlesme" (
    "id" SERIAL NOT NULL,
    "sozlesme_no" TEXT NOT NULL,
    "tasinmaz_id" INTEGER NOT NULL,
    "birim_id" INTEGER NOT NULL,
    "ekonomik_kod" TEXT NOT NULL,
    "imza_tarihi" DATE,
    "baslangic" DATE NOT NULL,
    "bitis" DATE,
    "ilk_kira_baslangici" DATE NOT NULL,
    "onceki_sozlesme_id" INTEGER,
    "bedel_tutari" DECIMAL(18,2) NOT NULL,
    "bedel_tabani" "BedelTabani" NOT NULL,
    "bedel_turu" "BedelTuru" NOT NULL DEFAULT 'BRUT',
    "odeme_periyodu_ay" INTEGER NOT NULL,
    "odeme_zamani" "OdemeZamani" NOT NULL,
    "vade_kurali" "VadeKurali" NOT NULL,
    "vade_parametresi" INTEGER NOT NULL DEFAULT 0,
    "artis_kurali" "ArtisKurali" NOT NULL,
    "artis_degisim_turu" "DegisimTuru" NOT NULL DEFAULT 'ON_IKI_AY_ORT',
    "sabit_artis_orani" DECIMAL(9,4),
    "artis_periyodu_ay" INTEGER NOT NULL DEFAULT 12,
    "kist_yontemi" "KistYontemi" NOT NULL DEFAULT 'GERCEK_GUN',
    "damga_tahsil" "DamgaTahsil" NOT NULL DEFAULT 'ISTIHKAKTAN',
    "ihale_dayanagi" "IhaleDayanagi" NOT NULL DEFAULT 'DT_4734_22E',
    "onay_belgesi_no" TEXT,
    "onay_belgesi_tarihi" DATE,
    "piyasa_arastirma_tarihi" DATE,
    "encumen_karar_no" TEXT,
    "gecis_tarihi" DATE,
    "gecis_bedeli" DECIMAL(18,2),
    "odenmis_sayilan_son_tarih" DATE,
    "durum" "SozlesmeDurumu" NOT NULL DEFAULT 'TASLAK',
    "uzama_sayisi" INTEGER NOT NULL DEFAULT 0,
    "fesih_tarihi" DATE,
    "fesih_nedeni" TEXT,
    "notlar" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sozlesme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sozlesme_malik" (
    "id" SERIAL NOT NULL,
    "sozlesme_id" INTEGER NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "pay" INTEGER NOT NULL,
    "payda" INTEGER NOT NULL,
    "iban_id" INTEGER,
    "vekil_kisi_id" INTEGER,
    "gecerlilik_baslangic" DATE NOT NULL,
    "gecerlilik_bitis" DATE,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sozlesme_malik_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kira_donemi" (
    "id" SERIAL NOT NULL,
    "sozlesme_id" INTEGER NOT NULL,
    "baslangic" DATE NOT NULL,
    "bitis" DATE,
    "bedel_tutari" DECIMAL(18,2) NOT NULL,
    "bedel_tabani" "BedelTabani" NOT NULL,
    "kaynak" "KiraDonemiKaynagi" NOT NULL,
    "artis_hesabi_id" INTEGER,
    "aciklama" TEXT,
    "olusturan_id" INTEGER,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kira_donemi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artis_hesabi" (
    "id" SERIAL NOT NULL,
    "sozlesme_id" INTEGER NOT NULL,
    "donem_baslangic" DATE NOT NULL,
    "referans_yil" INTEGER NOT NULL,
    "referans_ay" INTEGER NOT NULL,
    "tavan" DECIMAL(9,4),
    "sozlesme_orani" DECIMAL(9,4),
    "uygulanan_oran" DECIMAL(9,4),
    "eski_bedel" DECIMAL(18,2) NOT NULL,
    "yeni_bedel" DECIMAL(18,2),
    "elle_oran" DECIMAL(9,4),
    "elle_oran_gerekcesi" TEXT,
    "gerekce" JSONB NOT NULL,
    "durum" "ArtisDurumu" NOT NULL,
    "onaylayan_id" INTEGER,
    "onay_zamani" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "artis_hesabi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taksit" (
    "id" SERIAL NOT NULL,
    "sozlesme_id" INTEGER NOT NULL,
    "tur" "TaksitTuru" NOT NULL,
    "donem_baslangic" DATE NOT NULL,
    "donem_bitis" DATE NOT NULL,
    "vade_tarihi" DATE NOT NULL,
    "tutar" DECIMAL(18,2) NOT NULL,
    "hesap_goruntusu" JSONB NOT NULL,
    "durum" "TaksitDurumu" NOT NULL DEFAULT 'PLANLANDI',
    "odeme_tarihi" DATE,
    "ana_taksit_id" INTEGER,
    "artis_hesabi_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "taksit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endeks_degeri" (
    "id" SERIAL NOT NULL,
    "seri" "OranSerisi" NOT NULL,
    "yil" INTEGER NOT NULL,
    "ay" INTEGER NOT NULL,
    "deger" DECIMAL(14,4) NOT NULL,
    "kaynak" "EndeksKaynagi" NOT NULL,
    "evds_degeri" DECIMAL(14,4),
    "evds_seri_kodu" TEXT,
    "ham_veri" JSONB,
    "onay_durumu" "OnayDurumu" NOT NULL,
    "onaylayan_id" INTEGER,
    "onay_zamani" TIMESTAMPTZ(3),
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "endeks_degeri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametre" (
    "id" SERIAL NOT NULL,
    "anahtar" TEXT NOT NULL,
    "deger" TEXT NOT NULL,
    "yururluk_baslangic" DATE NOT NULL,
    "yururluk_bitis" DATE,
    "mevzuat_dayanagi" TEXT,
    "aciklama" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parametre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tatil" (
    "id" SERIAL NOT NULL,
    "tarih" DATE NOT NULL,
    "ad" TEXT NOT NULL,
    "yarim_gun" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tatil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hatirlatma" (
    "id" SERIAL NOT NULL,
    "anahtar" TEXT NOT NULL,
    "kural" TEXT NOT NULL,
    "iliskili_tur" TEXT NOT NULL,
    "iliskili_id" TEXT NOT NULL,
    "sozlesme_id" INTEGER,
    "baslik" TEXT NOT NULL,
    "aciklama" TEXT NOT NULL,
    "hedef_tarih" DATE NOT NULL,
    "gorunur_tarih" DATE NOT NULL,
    "oncelik" "Oncelik" NOT NULL,
    "karar_gerekli" BOOLEAN NOT NULL DEFAULT false,
    "durum" "HatirlatmaDurumu" NOT NULL DEFAULT 'ACIK',
    "ertelenen_tarih" DATE,
    "tamamlayan_id" INTEGER,
    "tamamlanma_zamani" TIMESTAMPTZ(3),
    "not" TEXT,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hatirlatma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "belge" (
    "id" SERIAL NOT NULL,
    "sahip_tur" TEXT NOT NULL,
    "sahip_id" INTEGER NOT NULL,
    "belge_turu" "BelgeTuru" NOT NULL,
    "dosya_adi" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "boyut" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "yukleyen_id" INTEGER NOT NULL,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "belge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "is_calisma" (
    "id" SERIAL NOT NULL,
    "is_adi" TEXT NOT NULL,
    "baslangic" TIMESTAMPTZ(3) NOT NULL,
    "bitis" TIMESTAMPTZ(3),
    "durum" "IsDurumu" NOT NULL,
    "ozet" TEXT,
    "hata" TEXT,

    CONSTRAINT "is_calisma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "olay_gunlugu" (
    "id" SERIAL NOT NULL,
    "kullanici_id" INTEGER,
    "zaman" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "varlik" TEXT NOT NULL,
    "varlik_id" TEXT NOT NULL,
    "eylem" TEXT NOT NULL,
    "once" JSONB,
    "sonra" JSONB,
    "ip" TEXT,

    CONSTRAINT "olay_gunlugu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kullanici_kullanici_adi_key" ON "kullanici"("kullanici_adi");

-- CreateIndex
CREATE UNIQUE INDEX "kullanici_ics_token_hash_key" ON "kullanici"("ics_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "oturum_token_hash_key" ON "oturum"("token_hash");

-- CreateIndex
CREATE INDEX "oturum_kullanici_id_idx" ON "oturum"("kullanici_id");

-- CreateIndex
CREATE UNIQUE INDEX "birim_ad_key" ON "birim"("ad");

-- CreateIndex
CREATE INDEX "tasinmaz_ada_parsel_idx" ON "tasinmaz"("ada", "parsel");

-- CreateIndex
CREATE UNIQUE INDEX "kisi_tckn_key" ON "kisi"("tckn");

-- CreateIndex
CREATE UNIQUE INDEX "kisi_vkn_key" ON "kisi"("vkn");

-- CreateIndex
CREATE UNIQUE INDEX "iban_kisi_id_iban_key" ON "iban"("kisi_id", "iban");

-- CreateIndex
CREATE UNIQUE INDEX "sozlesme_sozlesme_no_key" ON "sozlesme"("sozlesme_no");

-- CreateIndex
CREATE UNIQUE INDEX "sozlesme_onceki_sozlesme_id_key" ON "sozlesme"("onceki_sozlesme_id");

-- CreateIndex
CREATE INDEX "sozlesme_durum_idx" ON "sozlesme"("durum");

-- CreateIndex
CREATE INDEX "sozlesme_malik_sozlesme_id_idx" ON "sozlesme_malik"("sozlesme_id");

-- CreateIndex
CREATE UNIQUE INDEX "kira_donemi_artis_hesabi_id_key" ON "kira_donemi"("artis_hesabi_id");

-- CreateIndex
CREATE INDEX "kira_donemi_sozlesme_id_baslangic_idx" ON "kira_donemi"("sozlesme_id", "baslangic");

-- CreateIndex
CREATE INDEX "artis_hesabi_sozlesme_id_donem_baslangic_idx" ON "artis_hesabi"("sozlesme_id", "donem_baslangic");

-- CreateIndex
CREATE INDEX "taksit_sozlesme_id_donem_baslangic_idx" ON "taksit"("sozlesme_id", "donem_baslangic");

-- CreateIndex
CREATE INDEX "taksit_durum_vade_tarihi_idx" ON "taksit"("durum", "vade_tarihi");

-- CreateIndex
CREATE UNIQUE INDEX "endeks_degeri_seri_yil_ay_key" ON "endeks_degeri"("seri", "yil", "ay");

-- CreateIndex
CREATE INDEX "parametre_anahtar_idx" ON "parametre"("anahtar");

-- CreateIndex
CREATE UNIQUE INDEX "parametre_anahtar_yururluk_baslangic_key" ON "parametre"("anahtar", "yururluk_baslangic");

-- CreateIndex
CREATE UNIQUE INDEX "tatil_tarih_key" ON "tatil"("tarih");

-- CreateIndex
CREATE UNIQUE INDEX "hatirlatma_anahtar_key" ON "hatirlatma"("anahtar");

-- CreateIndex
CREATE INDEX "hatirlatma_durum_hedef_tarih_idx" ON "hatirlatma"("durum", "hedef_tarih");

-- CreateIndex
CREATE INDEX "hatirlatma_sozlesme_id_idx" ON "hatirlatma"("sozlesme_id");

-- CreateIndex
CREATE INDEX "belge_sahip_tur_sahip_id_idx" ON "belge"("sahip_tur", "sahip_id");

-- CreateIndex
CREATE INDEX "is_calisma_is_adi_baslangic_idx" ON "is_calisma"("is_adi", "baslangic");

-- CreateIndex
CREATE INDEX "olay_gunlugu_varlik_varlik_id_idx" ON "olay_gunlugu"("varlik", "varlik_id");

-- CreateIndex
CREATE INDEX "olay_gunlugu_zaman_idx" ON "olay_gunlugu"("zaman");

-- AddForeignKey
ALTER TABLE "oturum" ADD CONSTRAINT "oturum_kullanici_id_fkey" FOREIGN KEY ("kullanici_id") REFERENCES "kullanici"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasinmaz" ADD CONSTRAINT "tasinmaz_kullanan_birim_id_fkey" FOREIGN KEY ("kullanan_birim_id") REFERENCES "birim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iban" ADD CONSTRAINT "iban_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme" ADD CONSTRAINT "sozlesme_tasinmaz_id_fkey" FOREIGN KEY ("tasinmaz_id") REFERENCES "tasinmaz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme" ADD CONSTRAINT "sozlesme_birim_id_fkey" FOREIGN KEY ("birim_id") REFERENCES "birim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme" ADD CONSTRAINT "sozlesme_onceki_sozlesme_id_fkey" FOREIGN KEY ("onceki_sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme_malik" ADD CONSTRAINT "sozlesme_malik_sozlesme_id_fkey" FOREIGN KEY ("sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme_malik" ADD CONSTRAINT "sozlesme_malik_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme_malik" ADD CONSTRAINT "sozlesme_malik_iban_id_fkey" FOREIGN KEY ("iban_id") REFERENCES "iban"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sozlesme_malik" ADD CONSTRAINT "sozlesme_malik_vekil_kisi_id_fkey" FOREIGN KEY ("vekil_kisi_id") REFERENCES "kisi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kira_donemi" ADD CONSTRAINT "kira_donemi_sozlesme_id_fkey" FOREIGN KEY ("sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kira_donemi" ADD CONSTRAINT "kira_donemi_artis_hesabi_id_fkey" FOREIGN KEY ("artis_hesabi_id") REFERENCES "artis_hesabi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artis_hesabi" ADD CONSTRAINT "artis_hesabi_sozlesme_id_fkey" FOREIGN KEY ("sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit" ADD CONSTRAINT "taksit_sozlesme_id_fkey" FOREIGN KEY ("sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit" ADD CONSTRAINT "taksit_ana_taksit_id_fkey" FOREIGN KEY ("ana_taksit_id") REFERENCES "taksit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit" ADD CONSTRAINT "taksit_artis_hesabi_id_fkey" FOREIGN KEY ("artis_hesabi_id") REFERENCES "artis_hesabi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
