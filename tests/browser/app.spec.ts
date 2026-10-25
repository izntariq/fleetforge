import { test, expect } from '@playwright/test';

test('an engineer reproduces a fault, verifies a local repair, and inspects its actual source', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A proving ground for robot fleets.' }),
  ).toBeVisible();
  await expect(page.getByText('Local reference', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('warehouse-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Reproduce failure' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Failure reproduced', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Apply local repair' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Verified', { timeout: 20000 });
  await expect(page.getByTestId('delivery-count')).toHaveText('2 / 2');
  await page.getByRole('button', { name: 'View source' }).click();
  await expect(page.getByRole('dialog', { name: 'Controller source' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Controller JavaScript' })).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Controller source' })).not.toBeVisible();
});

test('scrubbing renders the canonical recorded robot positions and changing mission clears stale evidence', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Apply local repair' }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Verified', { timeout: 20000 });
  const replay = await page.evaluate(async () => {
    const bridge = (window as any).fleetReplay;
    bridge.advance(3);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return bridge.getState();
  });
  expect(replay.tick).toBe(3);
  expect(replay.visiblePositions).toEqual(replay.positions);
  await page.getByRole('button', { name: /02.*Mission/s }).click();
  await expect(page.getByTestId('verification-status')).toHaveText('Ready to simulate');
});

test('an unconfigured Managed Agent is visibly unavailable instead of presenting a local repair as AI', async ({
  page,
  request,
}) => {
  const capability = await request.get('/api/status');
  const status = await capability.json();
  test.skip(status.configured, 'This check targets the explicit no-key product state.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Managed agent', exact: true }).click();
  await expect(page.getByText('Managed Agent not configured.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repair with Managed Agent' })).toBeDisabled();
  await page.getByRole('button', { name: 'Local reference', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply local repair' })).toBeEnabled();
});

test('starting an evaluation exits obstacle placement and keeps the evaluated scene frozen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const warehouse = page.getByTestId('warehouse-canvas');
  const obstacleEvents = page
    .locator('.detail-row')
    .filter({ hasText: 'Obstacle events' })
    .locator('strong');
  await expect(obstacleEvents).toHaveText('00');
  await page.getByRole('button', { name: 'Top camera', exact: true }).click();
  // Let the actual smooth camera settle before targeting the central aisle cell.
  await page.evaluate(async () => {
    for (let i = 0; i < 70; i++) await new Promise(requestAnimationFrame);
  });
  await page.getByRole('button', { name: 'Add obstacle', exact: true }).click();
  await expect(warehouse).toHaveClass(/placing/);
  await page.getByRole('button', { name: 'Apply local repair', exact: true }).click();
  await expect(warehouse).not.toHaveClass(/placing/);
  const bounds = await warehouse.boundingBox();
  if (!bounds) throw new Error('Warehouse viewport is not available');
  // In the top view, cell [3,3] is half a tile above/left of the board center.
  const halfTile = (bounds.height / (2 * 17 * Math.tan((33 * Math.PI) / 360))) * 0.5;
  await warehouse.click({
    position: { x: bounds.width / 2 - halfTile, y: bounds.height / 2 - halfTile },
  });
  await expect(page.getByTestId('verification-status')).toHaveText('Verified', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Apply local repair', exact: true })).toBeEnabled();
  await expect(obstacleEvents).toHaveText('00');
  await expect(page.getByTestId('delivery-count')).toHaveText('2 / 2');
});
