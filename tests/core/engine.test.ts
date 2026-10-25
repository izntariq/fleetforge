import { describe, expect, it } from 'vitest';
import { initialState, step } from '../../src/core/engine';
import { SCENARIOS } from '../../src/core/fixtures';
import type { Scenario } from '../../src/core/types';
const scenario = SCENARIOS[0];
const near = (a: [number, number], b: [number, number]): Scenario => ({
  ...scenario,
  robots: [
    { ...scenario.robots[0], start: a, pickup: a },
    { ...scenario.robots[1], start: b, pickup: b },
  ],
});
describe('trusted simultaneous rules', () => {
  it('rejects shared destinations atomically', () => {
    const s = near([2, 3], [4, 3]);
    const before = initialState(s);
    const result = step(s, before, { amber: 'E', teal: 'W' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/destination/i);
    expect(result.after.positions).toEqual(before.positions);
  });
  it('rejects opposing edge swaps', () => {
    const s = near([2, 3], [3, 3]);
    expect(step(s, initialState(s), { amber: 'E', teal: 'W' }).errors.join(' ')).toMatch(/swap/i);
  });
  it('allows WAIT and defaults absent robot actions to WAIT', () => {
    const before = initialState(scenario);
    const result = step(scenario, before, {});
    expect(result.valid).toBe(true);
    expect(result.after.tick).toBe(1);
    expect(result.after.positions).toEqual(before.positions);
    expect(result.moves).toEqual({ amber: 'WAIT', teal: 'WAIT' });
  });
  it('rejects walls and unknown actions or robot ids', () => {
    expect(step(scenario, initialState(scenario), { amber: 'N', teal: 'WAIT' }).valid).toBe(false);
    expect(step(scenario, initialState(scenario), { amber: 'JUMP' } as never).valid).toBe(false);
    expect(step(scenario, initialState(scenario), { intruder: 'WAIT' }).valid).toBe(false);
  });
  it('rejects non-string action values instead of coercing them', () => {
    expect(step(scenario, initialState(scenario), { amber: ['E'] } as never).valid).toBe(false);
  });
  it('uses WAIT for an omitted action even when the robot id matches an object prototype key', () => {
    const s = structuredClone(scenario);
    s.robots[0].id = 'toString';
    const result = step(s, initialState(s), {});
    expect(result.valid).toBe(true);
    expect(result.moves.toString).toBe('WAIT');
  });
  it('computes pickup and delivery only at the corresponding cells', () => {
    const s = {
      ...scenario,
      robots: [{ ...scenario.robots[0], pickup: [2, 3] as [number, number] }, scenario.robots[1]],
    };
    const before = initialState(s);
    expect(before.carrying.amber).toBe(false);
    expect(before.delivered.amber).toBe(false);
    const after = step(s, before, { amber: 'E', teal: 'WAIT' }).after;
    expect(after.carrying.amber).toBe(true);
    expect(after.delivered.amber).toBe(false);
    expect(before.positions.amber).toEqual([1, 3]);
  });
  it('announces a scheduled block but delays activation until its occupied cell becomes vacant', () => {
    const s = {
      ...scenario,
      events: [{ tick: 1, type: 'block' as const, cell: [2, 3] as [number, number] }],
    };
    const first = step(s, initialState(s), { amber: 'E', teal: 'WAIT' }).after;
    expect(first.announcedEvents).toEqual([0]);
    expect(first.activeBlocks).not.toContainEqual([2, 3]);
    const wait = step(s, first, {}).after;
    expect(wait.activeBlocks).not.toContainEqual([2, 3]);
    const exit = step(s, wait, { amber: 'E', teal: 'WAIT' }).after;
    expect(exit.activeBlocks).toContainEqual([2, 3]);
    expect(step(s, exit, { amber: 'W', teal: 'WAIT' }).valid).toBe(false);
  });
  it('replays deterministically without mutating input', () => {
    const before = initialState(scenario);
    const copy = structuredClone(before);
    expect(step(scenario, before, { amber: 'E' })).toEqual(step(scenario, before, { amber: 'E' }));
    expect(before).toEqual(copy);
  });
});
