-- Var olan kira döneminin bedeli değiştirildiğinde (yenilemenin ILK dönemine artış onayı; onaylı artış dönemine aynı tarihli tespit)
-- aynı ana taksit için aynı kira dönemi ikinci bir FARK doğurabilir: artıştan gelen fark (artis_hesabi_id dolu) tahakkuk etmişken
-- tespit farkı (artis_hesabi_id boş). Tekillik artış hesabını da içerir; NULL'lar eşit sayılır: aynı dönem + aynı kaynak yine tek aktif FARK.
DROP INDEX taksit_fark_tekil;
CREATE UNIQUE INDEX taksit_fark_tekil ON taksit (ana_taksit_id, kira_donemi_id, artis_hesabi_id) NULLS NOT DISTINCT WHERE tur = 'FARK' AND durum <> 'IPTAL';
