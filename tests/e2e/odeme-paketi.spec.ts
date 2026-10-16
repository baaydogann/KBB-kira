import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { ayEkle, birlestir, bugunIstanbul, gunEkle, parcala, tarihinAyi } from '@/core/tarih'
import { E2E_KULLANICI } from './global-setup'

/**
 * F2 akışı (gerçek bugün): sözleşme (bu ayın 1'i, 12 ay, artışsız, imza 2026-01-05 → damga 226,80) → borç yok sorgusu → paket →
 * hesapla (net 7.773,20) → kesinleştir → PDF ve banka Excel'i → ödeme emri → ödendi → taksit ODENDI.
 */
test('sözleşme → 22/A sorgusu → ödeme paketi → kesinleştir → belgeler → ödeme emri → ödendi', async ({ page }) => {
  const bugun = bugunIstanbul()
  const { yil, ay } = parcala(bugun)
  const ayBasi = birlestir(yil, ay, 1)
  const sonraki = tarihinAyi(ayEkle(ayBasi, 1))
  const ayinSonu = gunEkle(birlestir(sonraki.yil, sonraki.ay, 1), -1)

  await page.goto('/giris')
  await page.getByLabel('Kullanıcı adı').fill(E2E_KULLANICI.kullaniciAdi)
  await page.getByLabel('Şifre').fill(E2E_KULLANICI.sifre)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await expect(page.getByRole('heading', { name: 'Pano' })).toBeVisible()

  await page.goto('/sozlesmeler/yeni')
  await page.getByRole('button', { name: '2. Taşınmaz ve birim' }).click()
  await page.getByLabel('Sözleşme no').fill('E2E-F2-001')
  await page.getByLabel('Taşınmaz').selectOption({ label: 'Selçuklu ek bina' })
  await page.getByLabel('Harcama birimi').selectOption({ label: 'E2E Ödeme Birimi' })
  await page.getByLabel('İmza tarihi').fill('2026-01-05')
  await page.getByLabel('Başlangıç', { exact: true }).fill(ayBasi)
  await page.getByLabel('Bitiş (boş = belirsiz süreli)').fill(gunEkle(ayEkle(ayBasi, 12), -1))

  await page.getByRole('button', { name: '3. Malikler' }).click()
  await page.getByRole('button', { name: 'Malik ekle' }).click()
  await page.getByRole('combobox', { name: 'Malik', exact: true }).selectOption({ index: 1 })
  await page.getByRole('combobox', { name: "Ödeme IBAN'ı" }).selectOption({ index: 1 })

  await page.getByRole('button', { name: '4. Bedel ve ödeme' }).click()
  await page.getByLabel('Kira bedeli').fill('10.000,00')
  await page.getByRole('button', { name: '5. Artış' }).click()
  await page.getByLabel('Artış kuralı').selectOption('YOK')

  await page.getByRole('button', { name: '7. Önizleme' }).click()
  await page.getByRole('button', { name: 'Taslak olarak kaydet' }).click()
  await expect(page.getByRole('heading', { name: /E2E-F2-001/ })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Aktifleştir' }).click()
  await expect(page.getByText('Aktif', { exact: true })).toBeVisible()
  const sozlesmeUrl = page.url().split('?')[0]!

  // 22/A borç sorgusu: bugün, borç yok.
  await page.goto('/kisiler')
  await page.getByRole('link', { name: 'Deneme Malik' }).click()
  const sorguFormu = page.locator('form').filter({ has: page.getByRole('button', { name: 'Borç sorgusunu kaydet' }) })
  await sorguFormu.getByLabel('Sorgu tarihi').fill(bugun)
  await sorguFormu.getByLabel('Vergi dairesi').fill('Meram V.D.')
  await sorguFormu.getByLabel('Belge no').fill('E2E-B-1')
  await sorguFormu.getByRole('button', { name: 'Borç sorgusunu kaydet' }).click()
  await expect(page.getByText('Meram V.D.').first()).toBeVisible()

  // Paket: E2E Ödeme Birimi, bu ayın vade aralığı.
  await page.goto('/odeme-paketleri')
  await page.getByLabel('Harcama birimi').selectOption({ label: 'E2E Ödeme Birimi' })
  await page.getByLabel('Paket adı').fill('E2E F2 paketi')
  await page.getByLabel('Vade başlangıcı').fill(ayBasi)
  await page.getByLabel('Vade bitişi').fill(ayinSonu)
  await page.getByRole('button', { name: 'Paketi oluştur' }).click()
  await expect(page.getByRole('heading', { name: /Ödeme paketi #\d+ — E2E F2 paketi/ })).toBeVisible()
  const paketId = /\/odeme-paketleri\/(\d+)/.exec(page.url())![1]!

  await page.getByRole('button', { name: 'Hesapla', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ön kontrol' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kesinleştir' })).toBeVisible()
  await expect(page.locator('tr').filter({ hasText: 'E2E-F2-001' }).filter({ hasText: '7.773,20' }).first()).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Kesinleştir' }).click()
  await expect(page.getByText('Kesinleşti', { exact: true }).first()).toBeVisible()

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Paket belgeleri (PDF)' }).click()])
  expect(pdf.suggestedFilename()).toBe(`odeme-paketi-${paketId}.pdf`)
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  const [excel] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Banka aktarım dosyası (Excel)' }).click()])
  expect(excel.suggestedFilename()).toMatch(/\.xlsx$/)

  await page.getByLabel('Ödeme emri no').fill('OE-2026-1')
  await page.getByLabel('Ödeme emri tarihi').fill(bugun)
  await page.getByRole('button', { name: 'Ödeme emrini kaydet' }).click()
  await expect(page.getByText('Ödeme emrinde', { exact: true }).first()).toBeVisible()
  await page.getByLabel('Ödeme tarihi').fill(bugun)
  await page.getByRole('button', { name: 'Ödendi', exact: true }).click()
  await expect(page.getByText('Ödendi', { exact: true }).first()).toBeVisible()

  await page.goto(`${sozlesmeUrl}?sekme=taksitler`)
  const satir = page.locator('tbody tr').filter({ hasText: `paket #${paketId}` })
  await expect(satir).toHaveCount(1)
  await expect(satir.getByText('ODENDI', { exact: true })).toBeVisible()
})
