-- Ödemeyi geri almanın son gerekçesi (banka iadesi, yanlış işaretleme): para izi paket zaman çizelgesinde görünsün.
-- Serbest metindir; denetim satırına yazılmaz (KVKK), yalnızca pakette saklanır (iptal_nedeni gibi).
ALTER TABLE "odeme_paketi" ADD COLUMN "odeme_geri_alma_nedeni" TEXT;
