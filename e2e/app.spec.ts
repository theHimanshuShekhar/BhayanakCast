import { expect, test } from '@playwright/test'

test('home keeps public discovery accessible', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /watch together/i }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /create room/i })).toBeVisible()
  await expect(page.getByPlaceholder(/search rooms/i)).toBeVisible()
})

test('v1 pages render room profile and admin surfaces', async ({ page }) => {
  await page.goto('/rooms/demo-room')
  await expect(
    page.getByRole('heading', { name: /sign in to join this room/i }),
  ).toBeVisible()
  await expect(page.getByText(/watch together/i)).toBeVisible()

  await page.goto('/profile')
  await expect(
    page.getByRole('heading', { name: /sign in to view your profile/i }),
  ).toBeVisible()
  await expect(page.getByText(/public watch history/i)).toBeVisible()

  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: /admin access required/i }),
  ).toBeVisible()
  await expect(page.getByText(/allowlisted discord account/i)).toBeVisible()
})

test('authenticated-only user profile route rejects anonymous visitors', async ({
  page,
}) => {
  await page.goto('/users/demo-user')
  await expect(
    page.getByRole('heading', { name: /sign in to view profiles/i }),
  ).toBeVisible()
  await expect(page.getByText(/continue with discord/i)).toBeVisible()
})
