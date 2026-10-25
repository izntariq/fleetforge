# Trusted simulation implementation

Implemented `src/core/scenario.ts`, `fixtures.ts`, `engine.ts`, `src/verify/trace.ts`, `feasible.ts`, and `src/controller/sources.ts`, plus four canonical test files. `src/core/types.ts` is unchanged.

The schema enforces the 8×8 world, exactly two robots, at most 24 free cells, horizon 120, strict supported fields, traversable orders, distinct starts, safe robot identifiers, and up to eight unique block events. Scene decorations are bounded to 24 unique identifiers on static blocked cells. Parsing returns owned copies.

The engine computes orders and completion, applies simultaneous moves, rejects walls/shared destinations/opposing edge swaps, and defaults missing actions to WAIT. A rejected action advances the clock without moving either robot. Events are announced in the state at their scheduled tick; an occupied event cell remains pending until vacant. The verifier starts from a fresh canonical state, replays only the supplied actions, compares every state/error/validity field, and derives completion from that replay. The feasibility oracle uses bounded joint-state BFS, preserving the distinction between infeasible and budget exhausted.

## Verification evidence

Tests were written first. The initial test run failed on the missing modules; implementation made them pass. Follow-up tests exposed a stall-tick off-by-one, which was corrected and rerun.

`npm test -- tests/core/scenario.test.ts tests/core/engine.test.ts tests/core/trace.test.ts tests/core/feasible.test.ts`: 21 tests pass. Coverage includes illegal joint actions, WAIT, pickup ownership, immutable deterministic replay, pending events, forged initial/post states, illegal actions mislabeled as valid, controller errors, over-horizon traces, isolated orders, a no-bay corridor, budget exhaustion, all six feasible inputs, and standalone controller/state size bounds.

Measured standalone local controller evaluations through the real trusted engine and verifier:

| Scenario | BFS states | Seeded fault | Local reference |
| --- | ---: | --- | --- |
| Crossroads | 84 | 0/2, 120 ticks, 0 illegal | 2/2, 7 ticks, 0 illegal |
| Blocked aisle | 87 | 0/2, 120 ticks, 0 illegal | 2/2, 7 ticks, 0 illegal |
| Shift change | 101 | 0/2, 120 ticks, 0 illegal | 2/2, 7 ticks, 0 illegal |
| Reverse dispatch (holdout) | 84 | 0/2, 120 ticks, 0 illegal | 2/2, 7 ticks, 0 illegal |
| Late closure (holdout) | 126 | 0/2, 120 ticks, 0 illegal | 2/2, 7 ticks, 0 illegal |
| Outbound collection (holdout) | 297 | 0/2, 120 ticks, 0 illegal | 2/2, 8 ticks, 0 illegal |

The fault is deliberately seeded: independent shortest paths stop before collisions and cannot negotiate. The local reference is independently authored joint BFS with a cached action plan. It uses no imports or scenario IDs. Maximum reference decision time in this Node test was 2.365 ms and maximum serialized state was 1,063 bytes; these timings are not browser Worker deadline evidence.

The required bare `npm test` was also run. Owned tests and runner tests passed; shared integration failures were reported to the coordinator: Chrome launch aborted with SIGABRT/EPERM in `sandbox.test.ts` (three browser cases skipped), and `managed.test.ts`'s immutable-source case found an undefined persisted cache candidate ID. A TypeScript check earlier exposed a stale server import and incomplete server files; no owned core type errors were reported.

## Limits

This is a discrete two-robot prototype, not real robot safety validation. The reference planner searches at most 50,000 states per fresh decision; it returns WAIT if no plan is found. Feasibility defaults to 100,000 expanded states and reports budget exhaustion separately. A reported deadlock tick is the start of four consecutive stationary ticks, a diagnostic rather than a proof of controller deadlock. Public and held-out scenarios are distinct inputs; no expected action traces are exported. Browser isolation, API persistence, rendering, deployment and live API evidence belong to other implementation areas.
