import type { Check, Scenario, Trace, VerificationReport, WorldState } from '../core/types';
import { initialState, step } from '../core/engine';
// Compare object keys canonically so transport serialization order cannot affect acceptance.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export function verifyTrace(scenario: Scenario, trace: Trace): VerificationReport {
  const checks: Check[] = [];
  const check = (
    id: string,
    passed: boolean,
    observed: string | number | boolean,
    expected: string | number | boolean,
  ) => checks.push({ id, passed, observed, expected });
  let trusted: WorldState = initialState(scenario),
    illegalMoves = 0,
    integrity = true,
    firstStill: number | null = null,
    still = 0;
  const transitions = Array.isArray(trace?.transitions) ? trace.transitions : [];
  check(
    'scenario-id',
    trace?.scenarioId === scenario.id,
    trace?.scenarioId ?? 'missing',
    scenario.id,
  );
  check(
    'initial-state',
    canonical(trace?.initial) === canonical(trusted),
    canonical(trace?.initial) === canonical(trusted),
    true,
  );
  check(
    'horizon',
    Array.isArray(trace?.transitions) && transitions.length <= scenario.horizon,
    transitions.length,
    `≤${scenario.horizon}`,
  );
  check('controller', !trace?.controllerError, trace?.controllerError ?? 'no error', 'no error');
  for (const supplied of transitions.slice(0, scenario.horizon)) {
    try {
      const computed = step(scenario, trusted, supplied.moves);
      if (!computed.valid) illegalMoves++;
      if (
        canonical(supplied.before) !== canonical(computed.before) ||
        canonical(supplied.after) !== canonical(computed.after) ||
        supplied.valid !== computed.valid ||
        canonical(supplied.errors) !== canonical(computed.errors) ||
        canonical(supplied.moves) !== canonical(computed.moves)
      )
        integrity = false;
      if (canonical(trusted.positions) === canonical(computed.after.positions)) {
        still++;
        if (still === 4 && firstStill === null) firstStill = trusted.tick - 3;
      } else still = 0;
      trusted = computed.after;
    } catch {
      integrity = false;
      illegalMoves++;
    }
  }
  const delivered = scenario.robots.filter((r) => trusted.delivered[r.id]).length,
    total = scenario.robots.length;
  check('state-integrity', integrity, integrity, true);
  check('legal-actions', illegalMoves === 0, illegalMoves, 0);
  check('deliveries', delivered === total, delivered, total);
  const status = checks.every((c) => c.passed) ? 'passed' : 'failed';
  return {
    status,
    checks,
    delivered,
    total,
    ticks: trusted.tick,
    illegalMoves,
    deadlockTick: delivered === total ? null : firstStill,
    summary:
      status === 'passed'
        ? `${delivered}/${total} deliveries independently verified in ${trusted.tick} ticks.`
        : `${delivered}/${total} deliveries; ${illegalMoves} illegal actions.${!integrity ? ' Trace state differs from trusted replay.' : ''}${trace?.controllerError ? ` Controller: ${trace.controllerError}` : ''}`,
  };
}
