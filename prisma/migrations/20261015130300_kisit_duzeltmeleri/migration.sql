-- Hisse toplamı: bitmiş hisseler ve doğrudan AKTIF ekleme
--
-- 1) hisse_kontrol yalnızca hisselerin başlangıç günlerini ve sözleşme başlangıcını denetliyordu;
--    ardılı olmadan biten bir hisse (ör. 1/1, 2026-06-30'da biter) kabul ediliyordu. Artık
--    gecerlilik_bitis + 1 günü de denetlenir. Denetlenen günler sözleşme bitişiyle (yoksa sonsuz) sınırlıdır.
CREATE OR REPLACE FUNCTION hisse_kontrol(p_sozlesme_id integer) RETURNS void AS $$
DECLARE
  r record;
  toplam numeric;
BEGIN
  IF (SELECT durum FROM sozlesme WHERE id = p_sozlesme_id) = 'TASLAK' THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT t FROM (
      SELECT gecerlilik_baslangic AS t FROM sozlesme_malik WHERE sozlesme_id = p_sozlesme_id
      UNION SELECT baslangic FROM sozlesme WHERE id = p_sozlesme_id
      UNION SELECT gecerlilik_bitis + 1 FROM sozlesme_malik WHERE sozlesme_id = p_sozlesme_id AND gecerlilik_bitis IS NOT NULL
    ) gunler
    WHERE t <= COALESCE((SELECT bitis FROM sozlesme WHERE id = p_sozlesme_id), 'infinity'::date)
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

-- 2) sozlesme_hisse_kontrol yalnızca AFTER UPDATE OF durum çalışıyordu; maliksiz doğrudan AKTIF
--    eklenen sözleşme kabul ediliyordu. INSERT yolu da eklenir (commit anında denetlenir).
DROP TRIGGER sozlesme_hisse_kontrol ON sozlesme;

CREATE CONSTRAINT TRIGGER sozlesme_hisse_kontrol
  AFTER INSERT OR UPDATE OF durum ON sozlesme
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_sozlesme_hisse();

-- FARK taksiti ana taksit ve artış hesabına bağlı olmalı; aksi halde taksit_fark_tekil NULL ile aşılabiliyordu
ALTER TABLE taksit ADD CONSTRAINT taksit_fark_baglantili
  CHECK (tur <> 'FARK' OR (ana_taksit_id IS NOT NULL AND artis_hesabi_id IS NOT NULL));

-- Geçiş tarihi ve geçiş bedeli birlikte dolu ya da birlikte boş olmalı
ALTER TABLE sozlesme ADD CONSTRAINT sozlesme_gecis_cift
  CHECK ((gecis_tarihi IS NULL) = (gecis_bedeli IS NULL));
