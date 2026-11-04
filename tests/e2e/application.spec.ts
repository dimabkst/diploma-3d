import { expect, test } from '@playwright/test';

test('application renders without uncaught JavaScript errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Стереометрія 3D' })).toBeVisible();
  await expect(page.getByRole('banner').getByLabel('Геометричне тіло', { exact: true })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Завантажити 3MF' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Налаштування моделі' })).toBeVisible();
  await expect(page.getByRole('region', { name: '3D-перегляд' })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
