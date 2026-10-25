import { test, expect, type Page } from '@playwright/test';
import { SANDBOX_HTML } from '../../src/controller/sandbox';

async function run(page: Page, source: string) {
  await page.setContent(SANDBOX_HTML);
  return await page.evaluate(async (source) => {
    const api = (
      window as unknown as {
        fleetSandbox: {
          init: (source: string) => void;
          decide: (observation: unknown, state: unknown) => Promise<unknown>;
        };
      }
    ).fleetSandbox;
    api.init(source);
    try {
      return { decision: await api.decide({ tick: 0 }, null), error: null };
    } catch (error) {
      return { decision: null, error: String(error) };
    }
  }, source);
}

test.describe('real browser Worker boundary', () => {
  test('executes a candidate without Node or document access', async ({ page }) => {
    const result = await run(
      page,
      'export function decide() { return {moves:{A:"N"},state:{document:typeof document,require:typeof require}}; }',
    );
    expect(result.error).toBeNull();
    expect(result.decision).toEqual({
      moves: { A: 'N' },
      state: { document: 'undefined', require: 'undefined' },
    });
  });
  test('denies outbound network from candidate code using CSP', async ({ page }) => {
    const result = await run(
      page,
      'export async function decide() { try {await fetch("https://example.com");return {moves:{},state:"leaked"};} catch {return {moves:{},state:"blocked"};} }',
    );
    expect(result.error).toBeNull();
    expect(result.decision).toEqual({ moves: {}, state: 'blocked' });
  });
  test('terminates an infinite decision instead of hanging the simulator', async ({ page }) => {
    const result = await run(page, 'export function decide() {while(true){}}');
    expect(result.error).toMatch(/timed out/);
  });
});
