CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Değer kısıtları
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_bedel_pozitif CHECK (bedel_tutari > 0);
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_periyot CHECK (odeme_periyodu_ay IN (1, 3, 6, 12));
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_artis_periyot CHECK (artis_periyodu_ay BETWEEN 1 AND 120);
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_tarih_sirasi CHECK (bitis IS NULL OR bitis >= baslangic);
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_ilk_kira CHECK (ilk_kira_baslangici <= baslangic);
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_gecis CHECK (gecis_tarihi IS NULL OR (gecis_tarihi > baslangic AND gecis_bedeli IS NOT NULL AND gecis_bedeli > 0));
ALTER TABLE sozlesme_malik ADD CONSTRAINT malik_hisse CHECK (pay > 0 AND payda > 0 AND pay <= payda);
ALTER TABLE sozlesme_malik ADD CONSTRAINT malik_tarih CHECK (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= gecerlilik_baslangic);
ALTER TABLE kira_donemi ADD CONSTRAINT kira_donemi_bedel CHECK (bedel_tutari > 0);
ALTER TABLE kira_donemi ADD CONSTRAINT kira_donemi_tarih CHECK (bitis IS NULL OR bitis >= baslangic);
ALTER TABLE taksit ADD CONSTRAINT taksit_tutar CHECK (tutar >= 0);
ALTER TABLE taksit ADD CONSTRAINT taksit_tarih CHECK (donem_bitis >= donem_baslangic);

-- Çakışmasız tarih aralıkları
ALTER TABLE kira_donemi ADD CONSTRAINT kira_donemi_cakismaz
  EXCLUDE USING gist (sozlesme_id WITH =, daterange(baslangic, bitis, '[]') WITH &&);
ALTER TABLE parametre ADD CONSTRAINT parametre_cakismaz
  EXCLUDE USING gist (anahtar WITH =, daterange(yururluk_baslangic, yururluk_bitis, '[]') WITH &&);

-- Kısmi tekillikler
CREATE UNIQUE INDEX taksit_donem_tekil ON taksit (sozlesme_id, donem_baslangic) WHERE tur <> 'FARK' AND durum <> 'IPTAL';
CREATE UNIQUE INDEX taksit_fark_tekil ON taksit (ana_taksit_id, artis_hesabi_id) WHERE tur = 'FARK' AND durum <> 'IPTAL';
CREATE UNIQUE INDEX artis_donem_tekil ON artis_hesabi (sozlesme_id, donem_baslangic) WHERE durum <> 'IPTAL';

-- Hisse toplamı = 1 (taslak hariç); servis katmanındaki tam rasyonel kontrolün emniyet ağı
CREATE OR REPLACE FUNCTION hisse_kontrol(p_sozlesme_id integer) RETURNS void AS $$
DECLARE
  r record;
  toplam numeric;
BEGIN
  IF (SELECT durum FROM sozlesme WHERE id = p_sozlesme_id) = 'TASLAK' THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT gecerlilik_baslangic AS t FROM sozlesme_malik WHERE sozlesme_id = p_sozlesme_id
    UNION SELECT baslangic FROM sozlesme WHERE id = p_sozlesme_id
  LOOP
    SELECT COALESCE(SUM(pay::numeric / payda), 0) INTO toplam FROM sozlesme_malik
      WHERE sozlesme_id = p_sozlesme_id
        AND gecerlilik_baslangic <= r.t
        AND (gecerlilik_bitis IS NULL OR gecerlilik_bitis >= r.t);
    IF abs(toplam - 1) > 0.000000001 THEN
      RAISE EXCEPTION 'HISSE_TOPLAMI_HATALI: sözleşme % için % tarihinde hisse toplamı %', p_sozlesme_id, r.t, toplam
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_malik_hisse() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM hisse_kontrol(OLD.sozlesme_id);
  ELSE
    PERFORM hisse_kontrol(NEW.sozlesme_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER malik_hisse_kontrol
  AFTER INSERT OR UPDATE OR DELETE ON sozlesme_malik
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_malik_hisse();

CREATE OR REPLACE FUNCTION trg_sozlesme_hisse() RETURNS trigger AS $$
BEGIN
  PERFORM hisse_kontrol(NEW.id);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER sozlesme_hisse_kontrol
  AFTER UPDATE OF durum ON sozlesme
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_sozlesme_hisse();

-- Audit tablosu yalnızca eklemeye açık
CREATE OR REPLACE FUNCTION trg_olay_gunlugu_degismez() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'olay_gunlugu yalnızca eklemeye açıktır' USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER olay_gunlugu_degismez
  BEFORE UPDATE OR DELETE ON olay_gunlugu
  FOR EACH ROW EXECUTE FUNCTION trg_olay_gunlugu_degismez();
