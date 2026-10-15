import { ortam } from '../env'
import { isDurumuOzeti, takiliCalismalariSupur } from './kayit'
import { gozetimKarari, IS_SIRASI, IS_ZAMANLARI, sonZamanlananZaman, type GozetimKarari, type IsAdi } from './zamanlama'

export interface GozetimSonucu { ad: IsAdi; karar: GozetimKarari | 'calistirildi' | 'calisiyor' | 'anahtar-yok' | 'hata' }

export interface GozetimSecenekleri {
  /** Verilmezse her iş için o anki zaman alınır (önceki iş dakikalar sürmüş olabilir). */
  simdi?: Date
  /** Zamanlayıcının kendi tetiklemesine tanınan süre; açılış turu 0 verir (kapalıyken kaçan iş hemen yakalanır). */
  toleransMs?: number
  /** Her işi başlatmadan önce sorulur; true ise tur kalan işleri başlatmadan biter (kapanış). */
  durdu?: () => boolean
}

/**
 * Gözetim turu (açılışta bir kez, sonra yarım saatte bir): önce takılı CALISIYOR kayıtlarını süpürür, sonra her iş için en son
 * zamanlanmış anından beri BAŞARILI çalışma var mı bakar, yoksa işi `calistir` ile çalıştırır. Kapalı kalan sunucu, kaçan ya da hatalı
 * biten çalışma böylece kendiliğinden telafi edilir; koşulsuz açılış çalıştırması yoktur. Sıra: takvim → endeks → hatırlatma.
 *
 * - İş zaten çalışıyorsa (taze CALISIYOR kaydı) dokunulmaz; `calistir` yine de işin kendi kilidiyle korunur (`tekKopya`).
 * - Son çalışması HATALI biten iş 2 saat geri çekilir (`geri-cekil`): sürekli başarısız bir iş (EVDS kapalı) yarım saatte bir yorulmaz.
 * - EVDS anahtarı tanımlı değilse endeks işi atlanır: elle giriş tercihidir, her turda ATLANDI kaydı üretmenin anlamı yok.
 * - Bir işin hatası diğerlerini engellemez; `durdu()` true olunca kalan işler başlatılmaz.
 */
export async function gozetimTuru(
  calistir: (ad: IsAdi) => Promise<unknown>, secenek: GozetimSecenekleri = {},
): Promise<{ supurulen: number; sonuclar: GozetimSonucu[] }> {
  let supurulen = 0
  try {
    supurulen = await takiliCalismalariSupur(secenek.simdi ?? new Date())
  } catch (e) {
    console.error('[gozetim] takılı çalışmalar süpürülemedi:', e)
  }
  const sonuclar: GozetimSonucu[] = []
  for (const ad of IS_SIRASI) {
    if (secenek.durdu?.()) break
    try {
      if (ad === 'endeks-cek' && ortam().EVDS_API_KEY.trim() === '') {
        sonuclar.push({ ad, karar: 'anahtar-yok' })
        continue
      }
      const an = secenek.simdi ?? new Date()
      const ozet = await isDurumuOzeti(ad, an)
      if (ozet.calisiyor) {
        sonuclar.push({ ad, karar: 'calisiyor' })
        continue
      }
      const karar = gozetimKarari({
        sonZamanlanan: sonZamanlananZaman(IS_ZAMANLARI[ad], an), sonBasari: ozet.sonBasari, sonHatali: ozet.sonHatali, simdi: an, toleransMs: secenek.toleransMs,
      })
      if (karar !== 'calistir') {
        sonuclar.push({ ad, karar })
        continue
      }
      await calistir(ad)
      sonuclar.push({ ad, karar: 'calistirildi' })
    } catch (e) {
      console.error(`[gozetim] ${ad} denetlenemedi ya da çalıştırılamadı:`, e)
      sonuclar.push({ ad, karar: 'hata' })
    }
  }
  return { supurulen, sonuclar }
}
