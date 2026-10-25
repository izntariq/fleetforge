import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../server/app';
import type { ManagedClient } from '../../server/managed';
import { SCENARIOS } from '../../src/core/fixtures';
const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});
async function serve(options: Parameters<typeof createApp>[0] = {}) {
  const app = createApp(options);
  const server = await new Promise<Server>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  return { app, url: `http://127.0.0.1:${address.port}` };
}
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
describe('managed API', () => {
  it('truthfully reports absent credentials and rejects paid run creation with 503', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { url } = await serve();
    expect(await (await fetch(`${url}/api/status`)).json()).toEqual({
      configured: false,
      model: 'gemini-4-argon',
      agent: 'antigravity-preview-09-2026',
    });
    const response = await fetch(
      `${url}/api/runs`,
      json({ scenarioId: 'crossroads', task: 'repair' }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('GEMINI_API_KEY');
  });
  it('creates/polls a durable run and returns 404 for unknown or path-like identifiers', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'fleetforge-api-'));
    dirs.push(artifactsDir);
    const client: ManagedClient = {
      interactions: {
        create: async () => ({ id: 'i-api', environment_id: 'e-api', status: 'incomplete' }),
        get: async () => {
          throw new Error('unexpected get');
        },
        cancel: async () => ({ id: 'i-api', status: 'cancelled' }),
      },
    };
    const { app, url } = await serve({ client, artifactsDir });
    const response = await fetch(
      `${url}/api/runs`,
      json({ scenarioId: SCENARIOS[0].id, task: 'repair' }),
    );
    expect(response.status).toBe(202);
    const run = await response.json();
    await app.locals.runner.wait(run.id);
    expect(await (await fetch(`${url}/api/runs/${run.id}`)).json()).toMatchObject({
      id: run.id,
      status: 'incomplete',
      interactionId: 'i-api',
    });
    expect((await fetch(`${url}/api/runs/not-a-run`)).status).toBe(404);
    expect((await fetch(`${url}/api/runs/%2E%2E%2Fsecret`)).status).toBe(404);
    expect((await fetch(`${url}/api/runs/not-a-run/cancel`, json({}))).status).toBe(404);
  });
  it('rejects malformed run requests and unknown scenarios before calling the remote SDK', async () => {
    const create = vi.fn(async () => ({ id: 'should-not-run', status: 'failed' }));
    const { url } = await serve({
      client: { interactions: { create, get: create, cancel: create } },
    });
    expect(
      (await fetch(`${url}/api/runs`, json({ scenarioId: '../secret', task: 'repair' }))).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${url}/api/runs`,
          json({ scenarioId: 'crossroads', task: 'shell', command: 'rm' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${url}/api/runs`,
          json({ scenarioId: 'crossroads', task: 'repair', request: 'a'.repeat(4001) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${url}/api/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('serves the isolated sandbox with network denial policy', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { url } = await serve();
    const response = await fetch(`${url}/sandbox.html`);
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(await response.text()).toContain('fleetSandbox');
  });
  it('can inspect persisted runs after credentials are removed without creating a new interaction', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'fleetforge-persist-'));
    dirs.push(artifactsDir);
    const create = vi.fn(async () => ({
      id: 'i-persist',
      environment_id: 'env-persist',
      status: 'incomplete',
    }));
    const first = await serve({
      artifactsDir,
      client: { interactions: { create, get: create, cancel: create } },
    });
    const run = await (
      await fetch(`${first.url}/api/runs`, json({ scenarioId: 'crossroads', task: 'repair' }))
    ).json();
    await first.app.locals.runner.wait(run.id);
    vi.stubEnv('GEMINI_API_KEY', '');
    const second = await serve({ artifactsDir });
    const response = await fetch(`${second.url}/api/runs/${run.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: run.id, interactionId: 'i-persist' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
