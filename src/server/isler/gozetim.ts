import { ortam } from '../env'
import { isDurumuOzeti } from './kayit'
import { gozetimKarari, IS_SIRASI, IS_ZAMANLARI, sonZamanlananZaman, type GozetimKarari, type IsAdi } from './zamanlama'

export interface GozetimSonucu { ad: IsAdi; karar: GozetimKarari | 'calistirildi' | 'calisiyor' | 'anahtar-yok' | 'hata' }

/**
 * Gözetim turu (açılışta bir kez, sonra yarım saatte bir): her iş için en son zamanlanmış anından beri BAŞARILI çalışma var mı bakar,
 * yoksa işi `calistir` ile çalıştırır. Kapalı kalan sunucu, kaçan ya da hatalı biten çalışma böylece kendiliğinden telafi edilir; koşulsuz
 * açılış çalıştırması yoktur (eskiden her yeniden başlatmada üç işi birden çalıştırırdı). Sıra: takvim → endeks → hatırlatma.
 *
 * - İş zaten çalışıyorsa (taze CALISIYOR kaydı) dokunulmaz; `calistir` yine de işin kendi kilidiyle korunur (`tekKopya`).
 * - EVDS anahtarı tanımlı değilse endeks işi atlanır: elle giriş tercihidir, her turda ATLANDI kaydı üretmenin anlamı yok.
 * - Bir işin hatası diğerlerini engellemez.
 * `simdi` verilmezse her iş için o anki zaman alınır (önceki iş dakikalar sürmüş olabilir).
 */
export async function gozetimTuru(calistir: (ad: IsAdi) => Promise<unknown>, simdi?: Date): Promise<GozetimSonucu[]> {
  const sonuclar: GozetimSonucu[] = []
  for (const ad of IS_SIRASI) {
    try {
      if (ad === 'endeks-cek' && ortam().EVDS_API_KEY.trim() === '') {
        sonuclar.push({ ad, karar: 'anahtar-yok' })
        continue
      }
      const an = simdi ?? new Date()
      const ozet = await isDurumuOzeti(ad, an)
      if (ozet.calisiyor) {
        sonuclar.push({ ad, karar: 'calisiyor' })
        continue
      }
      const karar = gozetimKarari({ sonZamanlanan: sonZamanlananZaman(IS_ZAMANLARI[ad], an), sonBasari: ozet.sonBasari, simdi: an })
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
  return sonuclar
}
