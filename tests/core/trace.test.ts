import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/core/fixtures';
import { initialState, step } from '../../src/core/engine';
import { verifyTrace } from '../../src/verify/trace';
import type { Trace } from '../../src/core/types';
function trace(): Trace {
  const s = SCENARIOS[0],
    initial = initialState(s);
  return { scenarioId: s.id, candidateId: 'test', initial, transitions: [step(s, initial, {})] };
}
describe('independent acceptance', () => {
  it('rejects forged completion and recomputes its delivered count', () => {
    const t = trace();
    t.transitions[0].after.delivered = { amber: true, teal: true };
    const report = verifyTrace(SCENARIOS[0], t);
    expect(report.status).toBe('failed');
    expect(report.delivered).toBe(0);
    expect(report.checks.find((c) => c.id === 'state-integrity')?.passed).toBe(false);
  });
  it('rejects forged initial state, transition before, tick, validity and scenario id', () => {
    for (const mutate of [
      (t: Trace) => {
        t.initial.delivered.amber = true;
      },
      (t: Trace) => {
        t.transitions[0].before.tick = 8;
      },
      (t: Trace) => {
        t.transitions[0].after.tick = 119;
      },
      (t: Trace) => {
        t.transitions[0].valid = false;
      },
      (t: Trace) => {
        t.scenarioId = 'other';
      },
    ]) {
      const t = trace();
      mutate(t);
      expect(verifyTrace(SCENARIOS[0], t).status).toBe('failed');
    }
  });
  it('counts illegal attempted moves even when candidate labels them valid', () => {
    const t = trace();
    t.transitions[0].moves.amber = 'N';
    t.transitions[0].valid = true;
    expect(verifyTrace(SCENARIOS[0], t).illegalMoves).toBe(1);
  });
  it('refuses controller errors and over-horizon traces', () => {
    const t = trace();
    t.controllerError = 'timed out';
    expect(verifyTrace(SCENARIOS[0], t).status).toBe('failed');
    const long = trace();
    long.transitions = Array.from({ length: 121 }, () => long.transitions[0]);
    expect(verifyTrace(SCENARIOS[0], long).status).toBe('failed');
  });
});
it('reports the first tick of a sustained terminal stall', () => {
  const s = SCENARIOS[0],
    initial = initialState(s);
  const t: Trace = { scenarioId: s.id, candidateId: 'stall', initial, transitions: [] };
  let current = initial;
  for (let i = 0; i < 4; i++) {
    const next = step(s, current, {});
    t.transitions.push(next);
    current = next.after;
  }
  expect(verifyTrace(s, t).deadlockTick).toBe(0);
});
