import { expect, test } from '@playwright/test'

// What the unit tests cannot see: that the published bundle starts at all, in a browser, under
// the /home-kitchen/ path, and that what a phone needs (RTL, manifest, service worker) is there.

test('the app starts and asks to sign in, in Arabic and right-to-left', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  await expect(page).toHaveTitle('مطبخ البيت')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.getByText('تسجيل الدخول')).toBeVisible()
  await expect(page.getByPlaceholder('name@example.com')).toBeVisible()
  expect(errors).toEqual([])
})

test('the sign-in button waits for an email', async ({ page }) => {
  await page.goto('./')
  const send = page.getByRole('button', { name: 'أرسل رابط الدخول' })
  await expect(send).toBeDisabled()
  await page.getByPlaceholder('name@example.com').fill('someone@example.com')
  await expect(send).toBeEnabled()
})

test('nothing needs sideways scrolling at phone width', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('تسجيل الدخول')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the install manifest is served and names the app', async ({ page }) => {
  await page.goto('./')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const response = await page.request.get(new URL(href!, page.url()).toString())
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({ name: 'مطبخ البيت', lang: 'ar', dir: 'rtl', display: 'standalone' })
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const res = await page.request.get(new URL(icon.src, new URL(href!, page.url())).toString())
    expect(res.ok(), icon.src).toBe(true)
  }
})

test('the service worker registers, so the app opens offline', async ({ page }) => {
  await page.goto('./')
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toContain('/home-kitchen/')
})
