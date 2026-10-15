import { kullaniciGerekli } from '@/server/auth/gerekli'
import { kullaniciListesi } from '@/server/kullanici/servis'
import { SayfaBasligi } from '@/components/sayfa-basligi'
import { Kart } from '@/components/ui/kart'
import { Rozet } from '@/components/ui/rozet'
import { Tablo, Td, Th } from '@/components/ui/tablo'
import { Dugme } from '@/components/ui/dugme'
import { aktiflikAction } from './actions'
import { KullaniciFormu, SifreSifirlaFormu } from './kullanici-formu'

export default async function KullanicilarSayfasi() {
  const ben = await kullaniciGerekli()
  const liste = await kullaniciListesi()
  const simdi = new Date()
  return (
    <>
      <SayfaBasligi baslik="Kullanıcılar" aciklama="Tüm kullanıcılar eşit yetkilidir. Her işlem olay günlüğüne yazılır." />
      <div className="space-y-4">
        <Kart baslik="Yeni kullanıcı"><KullaniciFormu /></Kart>
        <Tablo>
          <thead><tr><Th>Kullanıcı adı</Th><Th>Ad soyad</Th><Th>Durum</Th><Th>Son giriş</Th><Th>Şifre</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((k) => (
              <tr key={k.id}>
                <Td>{k.kullaniciAdi}</Td>
                <Td>{k.adSoyad}</Td>
                <Td className="space-x-1">
                  {k.aktif ? <Rozet ton="yesil">Aktif</Rozet> : <Rozet>Pasif</Rozet>}
                  {k.kilitBitis && k.kilitBitis > simdi ? <Rozet ton="kirmizi">Kilitli</Rozet> : null}
                  {k.sifreDegismeli ? <Rozet ton="sari">Şifre değişmeli</Rozet> : null}
                </Td>
                <Td>{k.sonGiris ? k.sonGiris.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'}</Td>
                <Td><SifreSifirlaFormu id={k.id} /></Td>
                <Td>
                  {k.id === ben.id ? null : (
                    <form action={aktiflikAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <input type="hidden" name="aktif" value={String(!k.aktif)} />
                      <Dugme type="submit" tur={k.aktif ? 'tehlike' : 'ikincil'}>{k.aktif ? 'Pasifleştir' : 'Aktifleştir'}</Dugme>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tablo>
      </div>
    </>
  )
}
