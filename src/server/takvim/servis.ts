import { randomBytes } from 'node:crypto'
import { OTOMATIK_KURALLAR } from '@/core/hatirlatma'
import { icsUret } from '@/core/ics'
import { bugunIstanbul, gunEkle, tarih as tarihMetni, type Tarih } from '@/core/tarih'
import type { IslemBaglami } from '../baglam'
import { prisma } from '../db'
import { denetimKaydi } from '../denetim'
import { ortam } from '../env'
import { tokenOzeti } from '../auth/oturum'

// Bu dosya 'use server' TAŞIMAZ: export edilen her fonksiyon aksi halde oturumsuz çağrılabilen bir HTTP uç noktası olurdu.
// Server action'lar app katmanında (hesabim/actions.ts), akış ise /takvim/[dosya]/route.ts üzerinden sunulur.

/** Bu biçimin dışındaki istek (rota parametresi dahil) veritabanına gitmeden reddedilir. */
const TOKEN_BICIMI = /^[A-Za-z0-9_-]{20,}$/

/**
 * Açıklaması akışa girebilen kurallar: hatırlatma motorunun (çekirdek `hatirlatmalariUret`) ürettikleri; açıklamaları çekirdekte
 * yalnızca sözleşme no, taşınmaz kısa adı ve tarihten kurulur. H1 hariç: açıklamasında taksit tutarı var (spec §9: akışta tutar yok;
 * tutar panoda kalır). Diğer kuralların (UZAMA_BILGI, UZAMA_HATA, ARTIS_HESAP_HATA, H5_FAZLA_ODEME, TAKVIM_HATA...) açıklaması başka
 * servislerin yazdığı serbest iletidir (tutar/kişi adı içerebilir); akışa girmez (KVKK: kişi adı/TCKN/IBAN yok). Bu kümenin dışındaki
 * her kural için akışa yalnızca `baslik` ile sabit açıklama gider.
 */
const MOTOR_KURALLARI: ReadonlySet<string> = new Set<string>([...OTOMATIK_KURALLAR.filter((k) => k !== 'H1'), 'H13'])

const GENEL_ACIKLAMA = 'Ayrıntı için KBB Kira Takip uygulamasında hatırlatmayı açın.'

/** Pencerenin geriye uzanımı: eşik = bugün − bu kadar gün (geciken işler takvimde de görünsün); kural için bkz. `takvimIcerigi`. */
const GERI_GUN = 7
const AZAMI_ETKINLIK = 2000

/** Düz token yalnızca burada, bir kez döner; veritabanında HMAC özeti saklanır (oturum tokenıyla aynı yöntem). */
export async function icsTokenUret(kullaniciId: number, baglam: IslemBaglami): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await prisma.$transaction(async (tx) => {
    await tx.kullanici.update({ where: { id: kullaniciId }, data: { icsTokenHash: tokenOzeti(token) } })
    // Denetim satırında token ve özeti yoktur; yalnızca değişen alanın adı.
    await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: kullaniciId, eylem: 'TAKVIM_TOKEN_URET', sonra: { degisenAlanlar: ['icsTokenHash'] } })
  })
  return token
}

export async function icsTokenIptal(kullaniciId: number, baglam: IslemBaglami): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.kullanici.update({ where: { id: kullaniciId }, data: { icsTokenHash: null } })
    await denetimKaydi(tx, baglam, { varlik: 'kullanici', varlikId: kullaniciId, eylem: 'TAKVIM_TOKEN_IPTAL', sonra: { degisenAlanlar: ['icsTokenHash'] } })
  })
}

export function takvimUrl(token: string): string {
  return `${ortam().APP_URL.replace(/\/$/, '')}/takvim/${token}.ics`
}

/**
 * Token geçerli ve kullanıcı aktifse `.ics` metni, aksi halde null (bilinmeyen, yenilenmiş/iptal edilmiş ve pasif kullanıcı ayırt edilmez).
 * Eşleştirme sunulan tokenın HMAC özeti üzerinden benzersiz dizinle yapılır: özet tokenın önekini sızdırmaz, dolayısıyla karakter karakter
 * (zamanlama) karşılaştırması söz konusu değildir. Token günlüğe yazılmaz.
 *
 * Pencere ve etkinlik tarihi (`eşik` = bugün − 7 gün):
 * - ACIK kayıt `hedefTarih >= eşik` ise girer ve hedef tarihinde görünür.
 * - ERTELENDI kayıt `ertelenenTarih >= eşik` YA DA `hedefTarih >= eşik` ise girer. Etkinlik tarihi `ertelenenTarih >= eşik` ise ertelenen
 *   tarih, değilse (erteleme eşikten eski ya da yok) hedef tarihidir: erteleme günü geçse de hedefi yaklaşan açık kayıt takvimden düşmez.
 * - KRITIK önceliğindeki ACIK ya da ERTELENDI kayıt pencereden bağımsız girer (aynı etkinlik tarihi kuralıyla): gecikmiş kritik iş
 *   (ör. ödenmemiş taksit, fazla ödeme) tamamlanana kadar takvimden düşmez.
 * Etkinlikler bu etkinlik tarihine, eşitlikte kimliğe göre sıralanır ve `AZAMI_ETKINLIK` sınırı sıralamadan SONRA (SQL'de) uygulanır.
 *
 * KVKK / spec §9: akışta yalnızca sözleşme no, taşınmaz kısa adı ve olay bulunur; tutar, kişi adı, TCKN, IBAN yok (bkz. `MOTOR_KURALLARI`).
 */
export async function takvimIcerigi(token: string, bugun: Tarih = bugunIstanbul()): Promise<string | null> {
  if (!TOKEN_BICIMI.test(token)) return null
  // Yalnızca aktiflik okunur: sifreHash gibi alanlar belleğe yüklenmesin.
  const k = await prisma.kullanici.findUnique({ where: { icsTokenHash: tokenOzeti(token) }, select: { aktif: true } })
  if (!k?.aktif) return null
  // Etkinlik tarihi kayda göre değiştiği için sıralama ve sınır SQL'de, hesaplanan tarih üzerinden yapılır (Prisma `orderBy` hesaplanmış
  // sütun alamaz). Eşik 'YYYY-MM-DD' metni olarak bağlanır; `::date` dönüşümü oturum saat diliminden etkilenmez.
  const esik = gunEkle(bugun, -GERI_GUN)
  const kayitlar = await prisma.$queryRaw<{ anahtar: string; kural: string; baslik: string; aciklama: string; oncelik: string; tarih: string }[]>`
    SELECT k.anahtar, k.kural, k.baslik, k.aciklama, k.oncelik::text AS oncelik, to_char(k.tarih, 'YYYY-MM-DD') AS tarih
      FROM (
        SELECT id, anahtar, kural, baslik, aciklama, oncelik,
               CASE WHEN durum = 'ERTELENDI' AND ertelenen_tarih >= ${esik}::date THEN ertelenen_tarih ELSE hedef_tarih END AS tarih
          FROM hatirlatma
         WHERE (durum = 'ACIK' AND hedef_tarih >= ${esik}::date)
            OR (durum = 'ERTELENDI' AND (ertelenen_tarih >= ${esik}::date OR hedef_tarih >= ${esik}::date))
            OR (durum IN ('ACIK', 'ERTELENDI') AND oncelik = 'KRITIK')
      ) AS k
     ORDER BY k.tarih, k.id
     LIMIT ${AZAMI_ETKINLIK}`
  return icsUret({
    takvimAdi: 'KBB Kira Takip',
    olusturma: new Date(),
    etkinlikler: kayitlar.map((h) => ({
      uid: `${h.anahtar}@kbb-kira`,
      tarih: tarihMetni(h.tarih),
      baslik: `[${h.oncelik}] ${h.baslik}`,
      aciklama: MOTOR_KURALLARI.has(h.kural) ? h.aciklama : GENEL_ACIKLAMA,
    })),
  })
}
