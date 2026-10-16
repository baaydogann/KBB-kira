import { expect, test } from '@playwright/test'
import { E2E_KULLANICI } from './global-setup'

test('giriş → sözleşme sihirbazı → aktifleştirme → taksit planı → hatırlatma işi → pano', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/giris/)
  await page.getByLabel('Kullanıcı adı').fill(E2E_KULLANICI.kullaniciAdi)
  await page.getByLabel('Şifre').fill(E2E_KULLANICI.sifre)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await expect(page.getByRole('heading', { name: 'Pano' })).toBeVisible()

  await page.goto('/sozlesmeler/yeni')
  await page.getByRole('button', { name: '2. Taşınmaz ve birim' }).click()
  await page.getByLabel('Sözleşme no').fill('E2E-001')
  await page.getByLabel('Taşınmaz').selectOption({ label: 'Meram hizmet binası' })
  await page.getByLabel('Harcama birimi').selectOption({ label: 'Emlak ve İstimlak Dairesi' })
  await page.getByLabel('Başlangıç', { exact: true }).fill('2026-01-01')
  await page.getByLabel('Bitiş (boş = belirsiz süreli)').fill('2026-12-31')

  await page.getByRole('button', { name: '3. Malikler' }).click()
  await page.getByRole('button', { name: 'Malik ekle' }).click()
  await page.getByRole('combobox', { name: 'Malik', exact: true }).selectOption({ index: 1 })
  await page.getByRole('combobox', { name: "Ödeme IBAN'ı" }).selectOption({ index: 1 })

  await page.getByRole('button', { name: '4. Bedel ve ödeme' }).click()
  await page.getByLabel('Kira bedeli').fill('10.000,00')

  await page.getByRole('button', { name: '7. Önizleme' }).click()
  await page.getByRole('button', { name: 'Önizlemeyi hesapla' }).click()
  await expect(page.getByText('8.000,00 ₺').first()).toBeVisible()
  await page.getByRole('button', { name: 'Taslak olarak kaydet' }).click()

  await expect(page.getByRole('heading', { name: /E2E-001/ })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Aktifleştir' }).click()
  await expect(page.getByText('Aktif', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Taksitler' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(12)
  await expect(page.getByText('10.000,00 ₺').first()).toBeVisible()

  // Gecikmiş hatırlatmaları worker üretir; e2e'de worker yok, işi Yönetim ekranından elle çalıştırırız.
  await page.goto('/yonetim/isler')
  const kart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'hatirlatma-uret' }) })
  await kart.getByRole('button', { name: 'Şimdi çalıştır' }).click()
  await expect(kart.getByText('İş bitti: BASARILI')).toBeVisible()

  // 2026 yılı taksitlerinin vadeleri geçmişte kaldığı sürece (2026-01-02'den itibaren) en az bir gecikmiş H1 satırı vardır.
  await page.goto('/')
  const gecikmis = page.getByRole('listitem').filter({ hasText: 'E2E-001' }).filter({ hasText: 'gecikti' })
  await expect(gecikmis.first()).toBeVisible()
  await expect(gecikmis.first()).toContainText('Gecikmiş kira ödemesi — E2E-001')
})
