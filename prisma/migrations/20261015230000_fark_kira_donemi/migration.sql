-- FARK taksitinin bağı kira dönemidir (artış hesabı değil)
--
-- Tespit / anlaşma / düzeltme ile açılan kira dönemleri de ödenmiş taksitlerde fark doğurur (TBK 344/3: tespit, dönem başından geriye işler)
-- ve bunların artış hesabı yoktur. FARK taksiti artık, onu doğuran kira dönemine bağlanır; artis_hesabi_id yalnızca artıştan geldiğinde dolu,
-- bedel değişikliğinde boştur.
ALTER TABLE taksit ADD COLUMN kira_donemi_id integer REFERENCES kira_donemi(id);

-- Mevcut artış kaynaklı FARK taksitleri, artışı uygulayan kira dönemine bağlanır (kira_donemi.artis_hesabi_id).
UPDATE taksit t SET kira_donemi_id = kd.id FROM kira_donemi kd WHERE t.tur = 'FARK' AND kd.artis_hesabi_id = t.artis_hesabi_id;

ALTER TABLE taksit DROP CONSTRAINT taksit_fark_baglantili;
ALTER TABLE taksit ADD CONSTRAINT taksit_fark_baglantili CHECK (tur <> 'FARK' OR (ana_taksit_id IS NOT NULL AND kira_donemi_id IS NOT NULL));

-- Aynı ana taksit için aynı kira dönemi en çok bir aktif fark taksiti doğurur.
DROP INDEX taksit_fark_tekil;
CREATE UNIQUE INDEX taksit_fark_tekil ON taksit (ana_taksit_id, kira_donemi_id) WHERE tur = 'FARK' AND durum <> 'IPTAL';
