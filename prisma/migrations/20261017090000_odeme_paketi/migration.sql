-- F2: ödeme paketi, malik dağılımı, kesinti kaynakları (22/A borç sorgusu, haciz, damga) ve sistem dışı ödeme.
-- Prisma kısmı `prisma migrate diff` ile üretildi; elle yazılan kısıtlar ve tetikleyiciler dosyanın sonundadır.

-- CreateEnum
CREATE TYPE "PaketDurumu" AS ENUM ('TASLAK', 'HESAPLANDI', 'KESINLESTI', 'ODEME_EMRINDE', 'ODENDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "HacizDurumu" AS ENUM ('AKTIF', 'KAPANDI');

-- CreateEnum
CREATE TYPE "DamgaOlayi" AS ENUM ('ILK', 'YAZILI_ARTIS', 'YAZILI_UZATMA');

-- CreateEnum
CREATE TYPE "KesintiTuru" AS ENUM ('DAMGA', 'HACIZ', 'KESINTI_22A');

-- AlterTable
ALTER TABLE "taksit" ADD COLUMN     "odeme_notu" TEXT,
ADD COLUMN     "sistem_disi_odeme" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "odeme_paketi" (
    "id" SERIAL NOT NULL,
    "birim_id" INTEGER NOT NULL,
    "ad" TEXT NOT NULL,
    "vade_baslangic" DATE NOT NULL,
    "vade_bitis" DATE NOT NULL,
    "durum" "PaketDurumu" NOT NULL DEFAULT 'TASLAK',
    "kalan_odenek" DECIMAL(18,2),
    "hesap_tarihi" DATE,
    "on_kontrol" JSONB,
    "hesap_parmak_izi" JSONB,
    "muhasebe_odeme_emri_no" TEXT,
    "muhasebe_odeme_emri_tarihi" DATE,
    "odeme_tarihi" DATE,
    "olusturan_id" INTEGER,
    "kesinlestiren_id" INTEGER,
    "kesinlesme_zamani" TIMESTAMPTZ(3),
    "iptal_nedeni" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "odeme_paketi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paket_taksit" (
    "id" SERIAL NOT NULL,
    "paket_id" INTEGER NOT NULL,
    "taksit_id" INTEGER NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "bolunsun" BOOLEAN NOT NULL DEFAULT false,
    "hesaplanan_taksit_surumu" INTEGER,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paket_taksit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paket_fatura" (
    "id" SERIAL NOT NULL,
    "paket_id" INTEGER NOT NULL,
    "taksit_id" INTEGER NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "fatura_no" TEXT NOT NULL,
    "fatura_tarihi" DATE NOT NULL,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "paket_fatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taksit_dagilim" (
    "id" SERIAL NOT NULL,
    "paket_id" INTEGER NOT NULL,
    "taksit_id" INTEGER NOT NULL,
    "sozlesme_malik_id" INTEGER NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "odeme_kisi_id" INTEGER NOT NULL,
    "iban_id" INTEGER,
    "sira" INTEGER NOT NULL,
    "parca" INTEGER NOT NULL DEFAULT 0,
    "parca_baslangic" DATE NOT NULL,
    "parca_bitis" DATE NOT NULL,
    "pay" INTEGER NOT NULL,
    "payda" INTEGER NOT NULL,
    "brut" DECIMAL(18,2) NOT NULL,
    "kdv" DECIMAL(18,2) NOT NULL,
    "stopaj" DECIMAL(18,2) NOT NULL,
    "kdv_orani" DECIMAL(9,4) NOT NULL,
    "stopaj_orani" DECIMAL(9,4) NOT NULL,
    "damga_kesintisi" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "haciz_kesintisi" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kesinti_22a" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(18,2) NOT NULL,
    "hesap_goruntusu" JSONB NOT NULL,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taksit_dagilim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dagilim_kesinti" (
    "id" SERIAL NOT NULL,
    "paket_id" INTEGER NOT NULL,
    "dagilim_id" INTEGER NOT NULL,
    "tur" "KesintiTuru" NOT NULL,
    "tutar" DECIMAL(18,2) NOT NULL,
    "haciz_id" INTEGER,
    "borc_sorgu_id" INTEGER,
    "damga_payi_id" INTEGER,

    CONSTRAINT "dagilim_kesinti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borc_sorgu" (
    "id" SERIAL NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "sorgu_tarihi" DATE NOT NULL,
    "gecerlilik_bitis" DATE NOT NULL,
    "borc_var" BOOLEAN NOT NULL,
    "borc_tutari" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vergi_dairesi" TEXT,
    "belge_no" TEXT,
    "belge_id" INTEGER,
    "olusturan_id" INTEGER,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "borc_sorgu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "haciz" (
    "id" SERIAL NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "alacakli" TEXT NOT NULL,
    "dosya_no" TEXT NOT NULL,
    "teblig_tarihi" DATE NOT NULL,
    "toplam_tutar" DECIMAL(18,2) NOT NULL,
    "kalan_tutar" DECIMAL(18,2) NOT NULL,
    "durum" "HacizDurumu" NOT NULL DEFAULT 'AKTIF',
    "kapanis_nedeni" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "haciz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damga_kaydi" (
    "id" SERIAL NOT NULL,
    "sozlesme_id" INTEGER NOT NULL,
    "olay" "DamgaOlayi" NOT NULL,
    "olay_tarihi" DATE NOT NULL,
    "matrah" DECIMAL(18,2) NOT NULL,
    "oran_binde" DECIMAL(9,4) NOT NULL,
    "azami" DECIMAL(18,2) NOT NULL,
    "tutar" DECIMAL(18,2) NOT NULL,
    "tahsil" "DamgaTahsil" NOT NULL,
    "makbuz_belge_id" INTEGER,
    "gerekce" JSONB NOT NULL,
    "iptal" BOOLEAN NOT NULL DEFAULT false,
    "iptal_nedeni" TEXT,
    "olusturan_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "olusturma_zamani" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guncelleme_zamani" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "damga_kaydi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damga_payi" (
    "id" SERIAL NOT NULL,
    "damga_kaydi_id" INTEGER NOT NULL,
    "kisi_id" INTEGER NOT NULL,
    "pay" INTEGER NOT NULL,
    "payda" INTEGER NOT NULL,
    "tutar" DECIMAL(18,2) NOT NULL,
    "kalan" DECIMAL(18,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "damga_payi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "odeme_paketi_durum_idx" ON "odeme_paketi"("durum");

-- CreateIndex
CREATE INDEX "odeme_paketi_birim_id_idx" ON "odeme_paketi"("birim_id");

-- CreateIndex
CREATE INDEX "paket_taksit_taksit_id_idx" ON "paket_taksit"("taksit_id");

-- CreateIndex
CREATE UNIQUE INDEX "paket_taksit_paket_id_taksit_id_key" ON "paket_taksit"("paket_id", "taksit_id");

-- CreateIndex
CREATE UNIQUE INDEX "paket_fatura_paket_id_taksit_id_kisi_id_key" ON "paket_fatura"("paket_id", "taksit_id", "kisi_id");

-- CreateIndex
CREATE INDEX "taksit_dagilim_paket_id_idx" ON "taksit_dagilim"("paket_id");

-- CreateIndex
CREATE INDEX "taksit_dagilim_taksit_id_idx" ON "taksit_dagilim"("taksit_id");

-- CreateIndex
CREATE INDEX "taksit_dagilim_kisi_id_idx" ON "taksit_dagilim"("kisi_id");

-- CreateIndex
CREATE INDEX "dagilim_kesinti_paket_id_idx" ON "dagilim_kesinti"("paket_id");

-- CreateIndex
CREATE INDEX "dagilim_kesinti_dagilim_id_idx" ON "dagilim_kesinti"("dagilim_id");

-- CreateIndex
CREATE INDEX "dagilim_kesinti_haciz_id_idx" ON "dagilim_kesinti"("haciz_id");

-- CreateIndex
CREATE INDEX "dagilim_kesinti_borc_sorgu_id_idx" ON "dagilim_kesinti"("borc_sorgu_id");

-- CreateIndex
CREATE INDEX "dagilim_kesinti_damga_payi_id_idx" ON "dagilim_kesinti"("damga_payi_id");

-- CreateIndex
CREATE INDEX "borc_sorgu_kisi_id_gecerlilik_bitis_idx" ON "borc_sorgu"("kisi_id", "gecerlilik_bitis");

-- CreateIndex
CREATE INDEX "haciz_kisi_id_durum_idx" ON "haciz"("kisi_id", "durum");

-- CreateIndex
CREATE INDEX "damga_kaydi_sozlesme_id_idx" ON "damga_kaydi"("sozlesme_id");

-- CreateIndex
CREATE UNIQUE INDEX "damga_payi_damga_kaydi_id_kisi_id_key" ON "damga_payi"("damga_kaydi_id", "kisi_id");

-- AddForeignKey
ALTER TABLE "odeme_paketi" ADD CONSTRAINT "odeme_paketi_birim_id_fkey" FOREIGN KEY ("birim_id") REFERENCES "birim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paket_taksit" ADD CONSTRAINT "paket_taksit_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "odeme_paketi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paket_taksit" ADD CONSTRAINT "paket_taksit_taksit_id_fkey" FOREIGN KEY ("taksit_id") REFERENCES "taksit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paket_fatura" ADD CONSTRAINT "paket_fatura_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "odeme_paketi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paket_fatura" ADD CONSTRAINT "paket_fatura_taksit_id_fkey" FOREIGN KEY ("taksit_id") REFERENCES "taksit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paket_fatura" ADD CONSTRAINT "paket_fatura_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "odeme_paketi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_taksit_id_fkey" FOREIGN KEY ("taksit_id") REFERENCES "taksit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_sozlesme_malik_id_fkey" FOREIGN KEY ("sozlesme_malik_id") REFERENCES "sozlesme_malik"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_odeme_kisi_id_fkey" FOREIGN KEY ("odeme_kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taksit_dagilim" ADD CONSTRAINT "taksit_dagilim_iban_id_fkey" FOREIGN KEY ("iban_id") REFERENCES "iban"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagilim_kesinti" ADD CONSTRAINT "dagilim_kesinti_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "odeme_paketi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagilim_kesinti" ADD CONSTRAINT "dagilim_kesinti_dagilim_id_fkey" FOREIGN KEY ("dagilim_id") REFERENCES "taksit_dagilim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagilim_kesinti" ADD CONSTRAINT "dagilim_kesinti_haciz_id_fkey" FOREIGN KEY ("haciz_id") REFERENCES "haciz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagilim_kesinti" ADD CONSTRAINT "dagilim_kesinti_borc_sorgu_id_fkey" FOREIGN KEY ("borc_sorgu_id") REFERENCES "borc_sorgu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dagilim_kesinti" ADD CONSTRAINT "dagilim_kesinti_damga_payi_id_fkey" FOREIGN KEY ("damga_payi_id") REFERENCES "damga_payi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borc_sorgu" ADD CONSTRAINT "borc_sorgu_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "haciz" ADD CONSTRAINT "haciz_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damga_kaydi" ADD CONSTRAINT "damga_kaydi_sozlesme_id_fkey" FOREIGN KEY ("sozlesme_id") REFERENCES "sozlesme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damga_payi" ADD CONSTRAINT "damga_payi_damga_kaydi_id_fkey" FOREIGN KEY ("damga_kaydi_id") REFERENCES "damga_kaydi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damga_payi" ADD CONSTRAINT "damga_payi_kisi_id_fkey" FOREIGN KEY ("kisi_id") REFERENCES "kisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Elle yazılan kısıtlar =====

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

