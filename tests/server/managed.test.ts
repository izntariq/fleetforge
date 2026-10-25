import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedRunner, type Interaction, type ManagedClient } from '../../server/managed';
import type { Evaluation, Scenario, SceneSpec } from '../../src/core/types';

const scene: SceneSpec = {
  schemaVersion: 1,
  scenario: {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    description: 'Small feasible arena',
    width: 8,
    height: 8,
    blocked: Array.from(
      { length: 64 },
      (_, i) => [i % 8, Math.floor(i / 8)] as [number, number],
    ).filter(([x, y]) => x > 3 || y > 2),
    robots: [
      { id: 'a', start: [0, 0], pickup: [1, 0], dropoff: [2, 0] },
      { id: 'b', start: [0, 2], pickup: [1, 2], dropoff: [2, 2] },
    ],
    events: [],
    horizon: 120,
  },
  style: { palette: 'cloud-workshop', tileScale: 1 },
  decorations: [],
};
const source = 'export function decide(observation, state) { return { moves: {}, state }; }';
function evaluation(id: string, passed = true): Evaluation {
  return {
    trace: {
      scenarioId: 'test',
      candidateId: id,
      initial: {
        tick: 0,
        positions: {},
        carrying: {},
        delivered: {},
        activeBlocks: [],
        announcedEvents: [],
      },
      transitions: [],
    },
    report: {
      status: passed ? 'passed' : 'failed',
      checks: [],
      delivered: passed ? 2 : 0,
      total: 2,
      ticks: 4,
      illegalMoves: 0,
      deadlockTick: null,
      summary: 'Measured test fixture',
    },
  };
}
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function setup(responses: Interaction[], options: Record<string, unknown> = {}) {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'fleetforge-tests-'));
  dirs.push(artifactsDir);
  const requests: Record<string, unknown>[] = [];
  const client: ManagedClient = {
    interactions: {
      create: vi.fn(async (request) => {
        requests.push(request);
        const next = responses.shift();
        if (!next) throw new Error('Unexpected create');
        return next;
      }),
      get: vi.fn(async () => {
        const next = responses.shift();
        if (!next) throw new Error('Unexpected get');
        return next;
      }),
      cancel: vi.fn(async () => ({ id: 'cancelled', status: 'cancelled' })),
    },
  };
  const evaluate = vi.fn(async (_source: string, _scenario: Scenario, id: string) =>
    evaluation(id),
  );
  const runner = new ManagedRunner({
    client,
    artifactsDir,
    scenes: [scene],
    holdouts: [scene.scenario],
    evaluateSource: evaluate,
    renderEvaluation: async () => ({
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
    }),
    pollIntervalMs: 0,
    maxPolls: 20,
    ...options,
  });
  return { runner, client, requests, evaluate, artifactsDir };
}
const call = (id: string, name: string, args: unknown) => ({
  type: 'function_call',
  id,
  name,
  arguments: args,
});
const interaction = (
  id: string,
  steps: unknown[] = [],
  status = 'requires_action',
): Interaction => ({ id, status, environment_id: 'env-test', steps });

describe('managed lifecycle', () => {
  it('reports API completion without a submitted passing candidate as incomplete', async () => {
    const { runner, requests } = await setup([interaction('i1', [], 'completed')]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect((await runner.get(run.id))?.status).toBe('incomplete');
    expect(requests[0]).toMatchObject({
      agent: 'antigravity-preview-09-2026',
      agent_config: { type: 'antigravity', model: 'gemini-4-argon' },
      environment: 'remote',
      background: true,
      store: true,
    });
  });
  it('registers immutable source, resends tools/history, renders real image, independently accepts and persists', async () => {
    const { runner, requests, evaluate, artifactsDir } = await setup([
      interaction('i1', [call('c1', 'evaluate_fleet', { source, scenario_id: 'test' })]),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    // The fake service responds based on the candidate hash returned by the real dispatcher.
    const client = runner.client;
    const original = client.interactions.create;
    client.interactions.create = vi.fn(async (request) => {
      if (!request.previous_interaction_id) return original(request);
      requests.push(request);
      const input = request.input as { result?: { candidate_id?: string } }[];
      const id = input.find((x) => x.result?.candidate_id)?.result?.candidate_id;
      if (request.previous_interaction_id === 'i1')
        return interaction('i2', [call('c2', 'render_candidate', { candidate_id: id })]);
      if (request.previous_interaction_id === 'i2')
        return interaction('i3', [
          call('c3', 'submit_candidate', {
            candidate_id: (await runner.get(run.id))?.candidate?.id,
          }),
        ]);
      return interaction('i4', [], 'completed');
    });
    await runner.wait(run.id);
    const result = await runner.get(run.id);
    expect(result?.status).toBe('completed');
    expect(result?.candidate?.source).toBe(source);
    expect(result?.candidate?.provenance).toBe('gemini-managed');
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(requests[1]).toMatchObject({ previous_interaction_id: 'i1', environment: 'env-test' });
    expect(requests.every((r) => Array.isArray(r.tools))).toBe(true);
    expect(JSON.stringify(requests[2].input)).toContain('"type":"image"');
    const saved = JSON.parse(await readFile(join(artifactsDir, `${run.id}.json`), 'utf8'));
    expect(saved.toolCache.c1.result.result.candidate_id).toBe(result?.candidate?.id);
    expect(saved.interactionId).toBe('i4');
  });
  it('replays duplicate call IDs without evaluating twice and rejects changed arguments', async () => {
    const repeated = call('same', 'evaluate_fleet', { source, scenario_id: 'test' });
    const { runner, evaluate, requests } = await setup([
      interaction('i1', [repeated]),
      interaction('i2', [repeated]),
      interaction('i3', [call('same', 'evaluate_fleet', { source: 'bad', scenario_id: 'test' })]),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect((await runner.get(run.id))?.status).toBe('failed');
    expect((await runner.get(run.id))?.error).toMatch(/reused/i);
    expect(requests).toHaveLength(3);
  });
  it('returns tool errors for unknown candidates, invalid source, and unauthorized scenario mutations', async () => {
    const { runner, requests, evaluate } = await setup([
      interaction('i1', [
        call('bad1', 'render_candidate', { candidate_id: '../../secret' }),
        call('bad2', 'evaluate_fleet', {
          source: 'import x from "node:fs"; export function decide(){}',
          scenario_id: 'test',
        }),
        call('bad3', 'propose_scene', { scene }),
      ]),
      interaction('i2', [], 'completed'),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect(evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(requests[1].input)).toContain('Unknown candidate');
    expect(JSON.stringify(requests[1].input)).toContain('imports');
    expect(JSON.stringify(requests[1].input)).toContain('frozen');
  });
  it('preserves incomplete status and bounds network retries against a saved interaction ID', async () => {
    const { runner, client } = await setup([interaction('i1', [], 'in_progress')], {
      maxNetworkErrors: 2,
    });
    client.interactions.get = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect(client.interactions.create).toHaveBeenCalledTimes(1);
    expect(client.interactions.get).toHaveBeenCalledTimes(2);
    expect(await runner.get(run.id)).toMatchObject({ status: 'incomplete', interactionId: 'i1' });
    expect(await runner.get('../../outside')).toBeUndefined();
  });
  it('cancellation wins over a late successful create and cancels its returned remote ID', async () => {
    let finish!: (value: Interaction) => void;
    const { runner, client } = await setup([]);
    client.interactions.create = vi.fn(
      () =>
        new Promise<Interaction>((resolve) => {
          finish = resolve;
        }),
    );
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runner.cancel(run.id);
    finish(interaction('late', [], 'completed'));
    await runner.wait(run.id);
    expect((await runner.get(run.id))?.status).toBe('cancelled');
    expect(client.interactions.cancel).toHaveBeenCalledWith('late');
  });
});

describe('managed acceptance boundaries', () => {
  it('does not accept a public pass when an independent holdout fails', async () => {
    const { runner, client, requests } = await setup(
      [interaction('i1', [call('e', 'evaluate_fleet', { source, scenario_id: 'test' })])],
      {
        evaluateSource: async (_source: string, scenario: Scenario, id: string) =>
          evaluation(id, scenario.id !== 'holdout'),
        holdouts: [{ ...scene.scenario, id: 'holdout' }],
      },
    );
    const original = client.interactions.create;
    client.interactions.create = async (request) => {
      if (!request.previous_interaction_id) return original(request);
      requests.push(request);
      if (request.previous_interaction_id === 'i1') {
        const id = (request.input as { result: { candidate_id: string } }[])[0].result.candidate_id;
        return interaction('i2', [call('s', 'submit_candidate', { candidate_id: id })]);
      }
      return interaction('i3', [], 'completed');
    };
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect((await runner.get(run.id))?.status).toBe('incomplete');
    expect(
      (requests[2].input as { result: { accepted: boolean; holdouts: { passed: number } } }[])[0]
        .result,
    ).toMatchObject({ accepted: false, holdouts: { passed: 0 } });
  });
  it('validates proposed scenes and rejects both invalid and infeasible generation inputs', async () => {
    const impossible = structuredClone(scene);
    // Each robot can occupy a separate singleton, but neither can reach its pickup.
    impossible.scenario.blocked = Array.from(
      { length: 64 },
      (_, i) => [i % 8, Math.floor(i / 8)] as [number, number],
    ).filter(
      ([x, y]) =>
        ![
          [0, 0],
          [2, 0],
          [4, 0],
          [0, 2],
          [2, 2],
          [4, 2],
        ].some(([a, b]) => x === a && y === b),
    );
    impossible.scenario.robots = [
      { id: 'a', start: [0, 0], pickup: [2, 0], dropoff: [4, 0] },
      { id: 'b', start: [0, 2], pickup: [2, 2], dropoff: [4, 2] },
    ];
    const { runner, requests } = await setup([
      interaction('i1', [
        call('p1', 'propose_scene', { scene: { ...scene, schemaVersion: 99 } }),
        call('p2', 'propose_scene', { scene: impossible }),
        call('p3', 'propose_scene', { scene }),
      ]),
      interaction('i2', [], 'completed'),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'generate' });
    await runner.wait(run.id);
    const replies = requests[1].input as {
      result: { ok: boolean; error?: string; scene_hash?: string };
    }[];
    expect(replies.map((reply) => reply.result.ok)).toEqual([false, false, true]);
    expect(replies[1].result.error).toContain('infeasible');
    expect(replies[2].result.scene_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('enforces three candidate attempts without counting render calls', async () => {
    const candidates = [0, 1, 2, 3].map((i) =>
      call(`c${i}`, 'evaluate_fleet', {
        source: source + `\n// candidate ${i}`,
        scenario_id: 'test',
      }),
    );
    const { runner, requests, evaluate } = await setup([
      interaction('i1', candidates),
      interaction('i2', [], 'completed'),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(requests[1].input)).toContain('Maximum three');
  });
  it.each(['incomplete', 'failed', 'cancelled', 'budget_exceeded', 'unexpected-new-status'])(
    'handles terminal/unknown API status %s without spinning',
    async (status) => {
      const { runner, client } = await setup([interaction('i1', [], status)]);
      const run = await runner.start({ scenarioId: 'test', task: 'repair' });
      await runner.wait(run.id);
      expect((await runner.get(run.id))?.status).toBe(
        status === 'budget_exceeded'
          ? 'incomplete'
          : status === 'unexpected-new-status'
            ? 'failed'
            : status,
      );
      expect(client.interactions.get).not.toHaveBeenCalled();
    },
  );
  it('does not dispatch environment-owned tools on the developer host', async () => {
    const { runner, evaluate } = await setup([
      interaction('i1', [call('host', 'write_to_file', { path: '/etc/passwd', contents: 'bad' })]),
    ]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect(evaluate).not.toHaveBeenCalled();
    expect((await runner.get(run.id))?.error).toMatch(/no pending allowed/);
  });
  it('retains saved evidence after server restart without silently paying for a replacement job', async () => {
    const { runner, artifactsDir, client } = await setup([interaction('i1', [], 'incomplete')]);
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    const restarted = new ManagedRunner({
      client,
      artifactsDir,
      scenes: [scene],
      holdouts: [],
      evaluateSource: async () => {
        throw new Error('unexpected evaluator');
      },
      renderEvaluation: async () => {
        throw new Error('unexpected renderer');
      },
    });
    expect(await restarted.get(run.id)).toMatchObject({
      id: run.id,
      status: 'incomplete',
      interactionId: 'i1',
      environmentId: 'env-test',
    });
    expect(client.interactions.create).toHaveBeenCalledTimes(1);
  });
});

describe('managed cancellation confirmation', () => {
  it('bounds an unconfirmed remote cancellation instead of leaving it pending forever', async () => {
    const { runner, client } = await setup([interaction('i1', [], 'in_progress')], {
      pollIntervalMs: 1,
    });
    client.interactions.cancel = vi.fn(async () => interaction('i1', [], 'in_progress'));
    client.interactions.get = vi.fn(async () => interaction('i1', [], 'in_progress'));
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runner.cancel(run.id);
    await runner.wait(run.id);
    expect((await runner.get(run.id))?.status).toBe('incomplete');
    expect((await runner.get(run.id))?.error).toMatch(/Cancellation unconfirmed/);
  });
});

describe('saved remote jobs', () => {
  it('allows cancellation of an incomplete local run whose remote interaction may still be running', async () => {
    const { runner, client } = await setup([interaction('saved-id', [], 'in_progress')], {
      maxNetworkErrors: 1,
    });
    client.interactions.get = vi.fn(async () => {
      throw new Error('offline');
    });
    const run = await runner.start({ scenarioId: 'test', task: 'repair' });
    await runner.wait(run.id);
    expect((await runner.get(run.id))?.status).toBe('incomplete');
    const cancelled = await runner.cancel(run.id);
    expect(client.interactions.cancel).toHaveBeenCalledWith('saved-id');
    expect(cancelled?.status).toBe('cancelled');
  });
});
