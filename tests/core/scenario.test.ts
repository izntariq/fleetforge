import { describe, expect, it } from 'vitest';
import { parseScenario, parseScene, createDefaultScene } from '../../src/core/scenario';
import { SCENARIOS } from '../../src/core/fixtures';

describe('bounded scenario contract', () => {
  it('accepts the three named, bounded two-robot fixtures', () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual(['Crossroads', 'Blocked aisle', 'Shift change']);
    for (const scenario of SCENARIOS) {
      expect(parseScenario(scenario)).toEqual(scenario);
      expect(64 - scenario.blocked.length).toBeLessThanOrEqual(24);
      expect(scenario.robots).toHaveLength(2);
    }
  });
  it('rejects duplicate starts, out-of-bounds cells, extra fields and altered horizon', () => {
    const s = SCENARIOS[0];
    expect(() =>
      parseScenario({ ...s, robots: [s.robots[0], { ...s.robots[1], start: s.robots[0].start }] }),
    ).toThrow(/start/i);
    expect(() => parseScenario({ ...s, blocked: [...s.blocked, [8, 2]] })).toThrow();
    expect(() => parseScenario({ ...s, horizon: 121 })).toThrow();
    expect(() => parseScenario({ ...s, cheat: true })).toThrow();
    expect(() =>
      parseScenario({ ...s, robots: s.robots.map((r) => ({ ...r, pickup: s.blocked[0] })) }),
    ).toThrow();
  });
  it('returns an owned copy and rejects unbounded decorations', () => {
    const scene = createDefaultScene();
    expect(parseScene(scene)).toEqual(scene);
    const parsed = parseScenario(SCENARIOS[0]);
    parsed.robots[0].start[0] = 7;
    expect(SCENARIOS[0].robots[0].start[0]).not.toBe(7);
    expect(() =>
      parseScene({
        ...scene,
        decorations: [
          { id: 'bad', kind: 'crate', cell: scene.scenario.robots[0].start, height: 0.5 },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseScene({
        ...scene,
        decorations: [
          { id: 'x', kind: 'crate', cell: scene.scenario.blocked[0], height: 0.5 },
          { id: 'x', kind: 'crate', cell: scene.scenario.blocked[1], height: 0.5 },
        ],
      }),
    ).toThrow();
  });
});
