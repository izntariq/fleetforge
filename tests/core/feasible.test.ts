import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/core/fixtures';
import { initialState, step } from '../../src/core/engine';
import { findFeasibleTrace } from '../../src/verify/feasible';
import { verifyTrace } from '../../src/verify/trace';
import { GREEDY_SOURCE, COOPERATIVE_SOURCE } from '../../src/controller/sources';
import type { Trace, Decision, Observation, Scenario } from '../../src/core/types';
const load = (source: string) =>
  new Function(
    source.replace('export function decide', 'function decide') + ';return decide',
  )() as (o: Observation, s: unknown) => Decision;
function run(scenario: Scenario, decide: (o: Observation, s: unknown) => Decision): Trace {
  let current = initialState(scenario),
    memory: unknown = null;
  const trace: Trace = {
    scenarioId: scenario.id,
    candidateId: 'unit',
    initial: structuredClone(current),
    transitions: [],
  };
  while (current.tick < scenario.horizon && !Object.values(current.delivered).every(Boolean)) {
    const d = decide({ ...structuredClone(current), scenario }, memory);
    memory = d.state;
    const t = step(scenario, current, d.moves);
    trace.transitions.push(t);
    current = t.after;
  }
  return trace;
}
describe('bounded joint planning and measured baseline', () => {
  it('finds independently replayable delivery plans for every fixture', () => {
    for (const s of SCENARIOS) {
      const result = findFeasibleTrace(s);
      expect(result.status, s.name).toBe('feasible');
      let i = 0;
      const trace = run(s, () => ({ moves: result.actions[i++] ?? {}, state: null }));
      expect(verifyTrace(s, trace).status, s.name).toBe('passed');
    }
  });
  it('proves isolated orders infeasible and labels exhausted budgets distinctly', () => {
    const s = structuredClone(SCENARIOS[0]);
    s.blocked.push([2, 3]);
    expect(findFeasibleTrace(s).status).toBe('infeasible');
    expect(findFeasibleTrace(SCENARIOS[0], 1).status).toBe('budget_exhausted');
  });
  it('preserves a safe seeded failure and independently authored reference success', () => {
    for (const s of SCENARIOS) {
      const failed = verifyTrace(s, run(s, load(GREEDY_SOURCE)));
      const passed = verifyTrace(s, run(s, load(COOPERATIVE_SOURCE)));
      expect(failed.status, s.name).toBe('failed');
      expect(failed.illegalMoves, s.name).toBe(0);
      expect(passed.status, s.name).toBe('passed');
    }
  });
});
export { run };

// Held-out inputs are distinct scenarios, never expected action traces.
import { HOLDOUT_SCENARIOS } from '../../src/core/fixtures';
it('keeps three separate feasible holdout variations', () => {
  expect(HOLDOUT_SCENARIOS).toHaveLength(3);
  expect(new Set([...SCENARIOS, ...HOLDOUT_SCENARIOS].map((s) => s.id)).size).toBe(6);
  for (const s of HOLDOUT_SCENARIOS) {
    expect(findFeasibleTrace(s).status, s.name).toBe('feasible');
    expect(verifyTrace(s, run(s, load(COOPERATIVE_SOURCE))).status, s.name).toBe('passed');
  }
});
it('keeps standalone reference source and cached state within worker bounds', () => {
  expect(COOPERATIVE_SOURCE.length).toBeLessThan(65536);
  const decide = load(COOPERATIVE_SOURCE);
  const s = SCENARIOS[1],
    current = initialState(s);
  const first = decide({ ...current, scenario: s }, null);
  expect(JSON.stringify(first.state).length).toBeLessThan(16384);
  expect(COOPERATIVE_SOURCE).not.toMatch(/\bimport\s/);
});
it('proves a single aisle without a passing loop cannot exchange two robot orders', () => {
  const s = structuredClone(SCENARIOS[0]);
  s.blocked.push([2, 2], [3, 2], [4, 2]);
  expect(findFeasibleTrace(s).status).toBe('infeasible');
});
