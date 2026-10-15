import { expect, test } from '@playwright/test'

test('giriş → sözleşme sihirbazı → aktifleştirme → taksit planı → pano', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/giris/)
  await page.getByLabel('Kullanıcı adı').fill('e2e.kullanici')
  await page.getByLabel('Şifre').fill('e2e-sifre-123456')
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

  await page.goto('/')
  await expect(page.getByText('Gecikmiş').first()).toBeVisible()
})
