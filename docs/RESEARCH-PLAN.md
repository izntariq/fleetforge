# FleetForge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a robotics prototyper an interactive 3D warehouse in which a managed engineer reproduces a coordination failure, repairs controller code, and demonstrates independently checked deliveries.

**Architecture:** A deterministic TypeScript grid engine owns movement, orders and disturbances. The candidate controller runs separately and can only propose moves; trusted simulation and verification code compute outcomes. A Python service persists Managed Agents sessions, serves validated artifacts and brokers simulation/render tools.

**Tech Stack:** Node22, TypeScript, Vite, Three.js, Zod, Vitest, Playwright; Python3.12, FastAPI, Uvicorn, official Google GenAI SDK. Use the current SDK recommendation in the shared playbook and pin working package versions after the smoke test.

**Spec:** [Shared requirements](EVENT-SPEC.md), plus the exact scope and interfaces below. This is a proposal; no FleetForge application has been built or benchmarked.

## Global Constraints

- One8×8 original procedural warehouse; two robots solo, three with teammates; one pickup/drop-off order per robot.
- At most24 traversable cells in the initial fixtures; discrete N/E/S/W/WAIT moves;120-tick horizon;100ms wall-clock controller timeout per decision in the development runner.
- Candidate controller JSON state ≤16KiB and source bundle ≤64KiB; no arbitrary engine, verifier or renderer changes accepted.
- Disturbances: one blocked aisle and a greedy-controller deadlock. A block activates once its cell is vacant; the event is announced to the controller at its scheduled tick.
- All materials, geometry and fixtures are original event work. Jootafly inspires the workshop appearance, not the judged baseline code.
- Track2 claim: the system generates/edits a procedural warehouse world and controller, renders it, inspects actual views, and repairs the result. Include bounded scene generation in addition to controller repair.
- Preserve the last verified result, original failing revision, canonical scenario and measured replay. Clearly label deliberately seeded controller faults.

## Review Focus

- Two robots swapping adjacent cells must fail even if their final cells differ: Task2 edge-swap test.
- Blocking the only route must produce `infeasible` rather than an invented successful repair: Task1 feasibility test.
- A controller that hangs, crashes or emits invalid moves must terminate with evidence: Task3 worker tests.
- A renderer that interpolates through a wall must not be mistaken for a successful engine replay: Task4 waypoint and scene-clearance tests.
- A late or failed agent result must not replace a newer verified candidate: Task5 run/candidate revision tests.

## User, outcome and differentiation

Initial user: one actual robotics founder/teammate evaluating small-fleet coordination, or the builder explicitly acting as the simulation creator. Record the actual name and example before the pitch; no customer interview is claimed here.

Output: generated warehouse scene, repaired controller module, counterexample trace, holdout results and a playable operator view. The user can place a supported obstacle and replay the resulting jobs. The main product is the simulation and repair workflow, not a metrics dashboard.

Open-RMF already schedules and negotiates robot traffic. This project does not invent multi-agent path finding or validate real robot safety. Its contribution is a compact source-level failure-to-repair workflow with rendered evidence and independently checked actions.

## Files and interfaces

All paths below are relative to a NEW selected-project repository, not this planning folder.

| File                                                   | Owner and purpose                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/core/types.ts`, `scenario.ts`                     | Canonical schemas and bounds; trusted                                   |
| `src/core/engine.ts`                                   | Trusted transition rules, pickup/delivery and block events              |
| `src/verify/trace.ts`, `feasible.ts`                   | Independent action/goal checks and bounded fixture feasibility          |
| `src/controller/worker.ts`                             | Loads candidate, isolates state and enforces deadline                   |
| `candidate/controller.ts`                              | Managed engineer's editable controller                                  |
| `candidate/scene.json`                                 | Bounded original warehouse layout/style; frozen for a controller repair |
| `src/view/warehouse.ts`, `replay.ts`                   | Three.js scene and actual transition replay                             |
| `service/app.py`, `agent.py`, `runs.py`                | HTTP API, Managed Agents adapter and persisted run records              |
| `scripts/evaluate.ts`, `render.ts`                     | Controlled simulation/render commands                                   |
| `tests/core/*.test.ts`, `tests/browser/replay.spec.ts` | Canonical checks owned outside builder output                           |
| `fixtures/public/*.json`, `fixtures/holdout/*.json`    | Disclosed scenarios and separately held-out variations                  |

```typescript
type Cell = readonly [number, number];
type Move = 'N' | 'E' | 'S' | 'W' | 'WAIT';
type Robot = { id: string; start: Cell; pickup: Cell; dropoff: Cell };
type Scenario = {
  schemaVersion: 1;
  width: 8;
  height: 8;
  blocked: Cell[];
  robots: Robot[];
  events: { tick: number; type: 'block'; cell: Cell }[];
  horizon: 120;
};
type SceneSpec = {
  schemaVersion: 1;
  scenario: Scenario;
  style: { palette: 'cloud-workshop' | 'industrial'; tileScale: 1 };
  decorations: {
    id: string;
    kind: 'crate' | 'cloud' | 'feather';
    cell: Cell;
    height: 0.25 | 0.5;
  }[];
};
type Observation = {
  tick: number;
  scenario: Scenario;
  positions: Record<string, Cell>;
  carrying: Record<string, boolean>;
  delivered: Record<string, boolean>;
};
type Decision = { moves: Record<string, Move>; state: unknown };
function decide(observation: Observation, state: unknown): Decision;
function step(state: WorldState, moves: Record<string, Move>): Transition;
function verifyTrace(scenario: Scenario, trace: Trace): VerificationReport;
function findFeasibleTrace(scenario: Scenario, maxStates: number): FeasibilityResult;
function freezeScene(scene: SceneSpec): { sceneHash: string; scenarioId: string };
```

`WorldState`, `Transition`, `Trace` and `FeasibilityResult` are defined in `types.ts`. A trace contains the initial state and every proposed action plus trusted post-transition state. `FeasibilityResult.status` is `feasible|infeasible|budget_exhausted`; exhaustion is not proof of infeasibility. Begin with two-robot joint-state BFS and a100,000-state cap; three robots remain behind the measured runtime gate. The canonical engine rejects shared destinations and opposing edge swaps before applying a tick. Pickup/dropoff and completion flags are computed only by the engine.

`SceneSpec` contains the generated scenario, not an unbound reference. Permit at most24 unique decorations, located on blocked cells only; reject unknown fields, nonfinite values, occupied route cells and unsupported dimensions. `freezeScene` validates schema and feasibility, canonicalizes the document, registers its scenario and records the immutable scene hash. A controller repair must preserve that hash. The renderer's geometry is generated only from these bounded fields, so candidate code cannot weaken collision geometry through an independent scene script.

Execute candidate code in a browser module Worker in a fresh isolated browser context. It receives only observations/state and returns validated move JSON through a controlled message protocol. Use a worker response deadline and termination; disallow module imports in the accepted single-file controller bundle, give the context no secrets, do not serve canonical fixtures/expected outputs, and apply a network-denying CSP. A Node worker alone is insufficient because it retains Node filesystem/network capabilities. Never import the candidate into the API process or canonical Node verifier. The external verifier recomputes outcomes from action messages using its own canonical engine/checks. Test attempted canonical mutation, forbidden imports/network requests and forged output; none may alter acceptance. This is a bounded prototype execution design, not a general security certification.

Application tools, implemented by this project rather than supplied automatically by Gemini:

- `evaluate_fleet(candidate_id, scenario_id)` resolves approved IDs, runs the candidate against a public scenario, and returns the shared `VerificationReport`.
- `render_candidate(candidate_id, view_ids)` returns actual top/junction/interior images and a replay clip when capture works.
- `submit_candidate(candidate_id, manifest_path)` freezes candidate files, hashes them, and requests independent acceptance; it cannot set acceptance itself.
- `freeze_scene(candidate_id, scene_path)` accepts only the registered candidate's `scene.json`, validates `SceneSpec`, checks feasibility, and returns `sceneHash`/`scenarioId` before controller repair.
- `register_adversary_scenario(scenario_path)` is adversary-only: accepts an allowlisted file from that role's artifacts, validates it, runs bounded feasibility, and returns a registered scenario ID plus `feasible|infeasible|budget_exhausted`. Only feasible scenarios enter controller evaluation.

The coordinator supplies rendered images inline on the next managed interaction. A local file path in tool text alone does not make its pixels visible to the model.

## Task1: Scenario contract and feasible fixtures —45min

**Files:** `package.json`, `tsconfig.json`, `src/core/types.ts`, `scenario.ts`, `src/verify/feasible.ts`, `tests/core/scenario.test.ts`, public fixtures.

**Consumes:** fixed scope above. **Produces:** `parseScenario(value:unknown):Scenario`, `findFeasibleTrace(...)` and one feasible crossing-with-passing-bay fixture.

- [ ] Write assertions that duplicate robot starts, out-of-bounds cells and a121-tick horizon are rejected; an isolated pickup returns infeasible; budget exhaustion stays distinct.
- [ ] Use the first20min of this allocation for the real API create/resume/download gate and a nonblank local browser render. Record actual capabilities before committing to the application stack.
- [ ] Run `npm run test:core -- scenario.test.ts`; confirm the missing-contract failure.
- [ ] Add manifests/scripts and implement schema plus bounded feasibility search. Keep free cells≤24 in selected fixtures.
- [ ] Implement `SceneSpec` parsing and `freezeScene`; reject decoration on a traversable cell, duplicate decoration IDs, an unbound scenario and a changed scene hash during repair.
- [ ] Rerun the test; verify a passing-bay fixture has a valid route and a one-cell swap corridor without a bay is rejected.
- [ ] Save the fixture and oracle trace; commit the independently testable contract in the selected repository.

## Task2: Deterministic movement and acceptance —45min

**Files:** `src/core/engine.ts`, `src/verify/trace.ts`, `tests/core/engine.test.ts`, `tests/core/trace.test.ts`.

**Consumes:** Scenario. **Produces:** `initialState(scenario):WorldState`, `step(...)`, `verifyTrace(...)`.

- [ ] Write tests: shared destination fails; opposing edge swap fails; WAIT is legal; blocked moves fail; pickup cannot occur remotely; delivery cannot precede pickup; the same actions replay to identical states.
- [ ] Run `npm run test:core -- engine.test.ts trace.test.ts` and observe failure before implementation.
- [ ] Implement simultaneous movement and event activation, then independent trace checks. Acceptance requires all declared deliveries within120 ticks and zero illegal transitions.
- [ ] Assert the verifier rejects a trace with forged `delivered:true` and recomputes every state from actions.
- [ ] Run all core tests and save test evidence; commit.

## Task3: Candidate controller and failure reproduction —50min

**Files:** `candidate/controller.ts`, `src/controller/worker.ts`, `scripts/evaluate.ts`, `tests/core/controller.test.ts`.

**Consumes:** Observation, shared report. **Produces:** `runCandidate(candidateId,scenarioId):Promise<{trace:Trace;report:VerificationReport}>`.

- [ ] Write tests that missing robot moves become WAIT, unknown move names fail validation, oversized state fails, thrown errors are reported and an infinite loop is terminated.
- [ ] Assert the browser Worker cannot mutate canonical files, import arbitrary modules, fetch network resources or set trusted completion flags; a forged state/result is independently rejected.
- [ ] Run `npm run test:core -- controller.test.ts` and observe missing-runner failure.
- [ ] Implement worker protocol and command `npm run evaluate -- --candidate <id> --scenario <id> --out <run-dir>`.
- [ ] The evaluation command drives the isolated browser Worker and collects action messages; only trusted code runs in Node. Do not replace this with a Node worker executing candidate code.
- [ ] Add a clearly labeled seeded greedy controller that stalls on the feasible crossing fixture. Preserve it as the first candidate; do not claim it was an unknown production defect.
- [ ] Confirm a trusted reference action trace passes while the greedy candidate fails completion. Commit.

## Task4: Real rendered inspection and replay —55min

**Files:** Vite entry files, `src/view/warehouse.ts`, `replay.ts`, `scripts/render.ts`, `tests/browser/replay.spec.ts`.

**Consumes:** canonical scene and trace. **Produces:** actual top/junction/interior views and `window.fleetReplay={load,advance,getState}` test bridge.

- [ ] Add a browser test that advances the real controller/engine replay and compares visible robot object positions with canonical cell centers at every tick boundary.
- [ ] Implement original instanced boxes, cloud-like stations, visible pickup/dropoff and a scrubber. Interpolate only along accepted adjacent segments; blocked cells remain nontraversable.
- [ ] Add camera views that expose the junction failure and a scene-clearance check for oversized decoration over traversable cells.
- [ ] Run `npm run test:browser`; capture images. Record video only after closing the Playwright context; preserve images if video is unavailable.
- [ ] Verify the render smoke test on the actual demo machine; commit.

## Task5: Managed reproduce–patch–verify loop —70min

**Files:** `service/app.py`, `agent.py`, `runs.py`, `tests/service/test_runs.py`, project prompts.

**Consumes:** shared playbook, tool contracts above. **Produces:** `POST /runs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, permitted artifact route.

- [ ] Test with a fake SDK: same interaction/environment reused on repair; unknown tool denied; stale candidate cannot overwrite the accepted revision; traversal in artifact paths rejected.
- [ ] Test adversary-only registration rejects builder access, invalid/out-of-root files and infeasible cases, while a valid new case receives an ID that evaluation accepts.
- [ ] Run `python -m pytest tests/service/test_runs.py -q` before implementation and observe failures.
- [ ] Implement job persistence and current SDK adapter, preserving all requested tool-call IDs and re-sending scoped tool/config definitions. Export only permitted candidate files.
- [ ] Execute the real API smoke test, then let the managed engineer reproduce the public failure and patch `candidate/controller.ts`. For this repair, the scene is frozen.
- [ ] Independently rerun the canonical scenario, then render it and supply actual images for critique. A separate bounded scene-generation task must also execute to satisfy the world-generation component.
- [ ] Run service tests and core/browser checks. Record SDK version, model/agent IDs, real artifacts and limitations; commit.

## Task6: Holdouts, comparison and submission —125min

**Files:** held-out fixtures, `scripts/compare.ts`, evidence UI, `README.md`, `PROVENANCE.md`, video script.

- [ ] Add three feasible held-out variations with changed starts, pickup/dropoff order or supported block timing. The agent does not receive their expected traces.
- [ ] Compare first and repaired candidates against the same cases; record actual completion counts, illegal moves and elapsed time. Do not assume the repaired candidate wins.
- [ ] Run `npm run test:core`, `npm run test:browser`, `npm run build`, and `python -m pytest tests/service -q`; report actual results only.
- [ ] Rehearse a supported fresh input and rejection of an infeasible placement. If fresh agent repair is slow, show earlier event repair transparently and verify/play fresh input live.
- [ ] Record the one-minute video, check public-repo attribution and accessibility of links, submit by16:45Pacific.

The six allocations total390min. Tasks1–3 can be owned by one person while another owns Task4; the agent/API owner starts Task5 against fixtures once Task2's interfaces freeze. With one builder, use two robots, one failure family and still images; cut movable machinery, voice, textures, ROS and realistic robot physics.

## Copyable managed prompts

Prepend `prompts/00-common-envelope.md` from this pack. The coordinator supplies RUN_ID, candidate/scenario IDs, manifest and canonical tool definitions; names below are application tools.

### Engineer prompt

```text
Build the FleetForge candidate for the supplied RUN_ID. Read the project contract and the supplied Scenario. First execute the public scenario and preserve the original controller, actual trace and verification report. The scenario has at most three robots, discrete N/E/S/W/WAIT actions and a120-tick horizon. The trusted engine alone owns pickup, delivery and collision rules.

For a scene-generation task, create candidate/scene.json within the bounded schema and request feasibility/render checks. For a controller-repair task, freeze that accepted scene and edit only candidate/controller.ts. Do not edit engine, verifier, tests, horizon, robot abilities, requested orders or acceptance rules. Implement decide(observation,state)->{moves,state}; state must be JSON and≤16KiB.

Use evaluate_fleet(candidate_id,scenario_id), inspect the concrete earliest failing tick, and render_candidate(candidate_id,["top","junction","interior"]). The coordinator will attach actual images; do not infer a visual pass from filenames. Repair the coordination logic rather than deleting orders or teleporting robots. Run npm run test:core and the approved evaluation command. Stop after three offline attempts or the supplied deadline.

Write artifacts/RUN_ID/candidate-manifest.json listing source files, hashes, scenario ID, commands executed, test outcomes, changed behavior and unresolved limitations. Request submit_candidate. Return the manifest path and a short factual summary; the independent runner decides acceptance.
```

### Adversary prompt

```text
Act as FleetForge's independent scenario adversary. You may create new scenarios under adversary/scenarios/ and reports under artifacts/RUN_ID/. Do not modify candidate source, canonical movement rules, verifier, tests or existing expected outcomes.

Seek a small feasible counterexample to the submitted controller: opposing traffic with a passing bay, a block after planning, or a delayed robot that causes an unfinished delivery. Keep the8×8 bounds,≤24 free cells, at most three robots and120 ticks. Register each new file through register_adversary_scenario and use its returned scenario ID. Infeasible or budget-exhausted scenarios are not controller regressions. Evaluate the candidate using the registered independent tools.

Return one minimized scenario plus the first divergence/deadlock evidence, expected contract, observed trace and reproduction command. If no counterexample is found, report the exact tested cases and say no failure found in those cases; never invent one. Write adversary-report.json with status, scenario paths and evidence paths. Acceptance is owned by the deterministic runner.
```

### Repair prompt

```text
Continue FleetForge in the existing interaction and environment. The coordinator supplies the failing candidate hash, canonical scenario and trusted verification report. Reproduce that exact revision before editing. Read the first failing tick and attached rendered junction/interior views.

Modify only candidate/controller.ts. Keep the scene and all game rules fixed. Correct the smallest general coordination defect; do not hard-code the supplied scenario ID, weaken tests, lengthen the horizon or mark an order complete yourself. Rerun the public failure and the public regression suite. At most two repair attempts are allowed for this live request.

Save the source diff, revised manifest and actual reports under artifacts/RUN_ID/. If the same failure remains, state it; if the deadline is reached, leave the previous verified candidate intact. Return evidence paths and changed logic. The independent runner will check held-out scenarios separately.
```

### Demo prompt

```text
Prepare FleetForge's factual three-minute demonstration using only artifacts from this event. Read the baseline, repaired and holdout reports and provenance. Do not invent speedups, success rates, customers or real-hardware safety claims.

Create demo/script.md and demo/submission-60s.md. Show the creator's delivery requirement, the seeded-or-real origin of the observed deadlock, actual rendered failure, the managed source patch and independently replayed deliveries. Reserve a bounded fresh judge input for live checking and execution. Fresh model repair is optional and latency-dependent; label any earlier event run or recording.

List exact run/candidate/scenario IDs, commands, views to open, setup/reset steps and the honest fallback if API or video fails. Keep the main screen a working3D simulation. End with the downloadable controller and reproduction evidence, supported limitations and attribution.
```

## Demo and evidence

Three minutes:0–20s user requirement;20–50s failure replay;50–100s patch and rendered critique;100–155s repaired and fresh supported replay;155–180s measured comparison and artifacts. One-minute video:10s problem,15s failure,20s managed repair/result,15s fresh input and evidence.

Required bundle: provenance, candidate hashes, fixture IDs, canonical rule version, baseline/final reports, original and repaired controller, actual rendered views, trace and honest limitations. Claim success only for tested scenarios and the declared discrete model.

## Research ledger

- [Open-RMF overview](https://osrf.github.io/ros2multirobotbook/rmf-core.html): establishes traffic scheduling/negotiation prior art; not an implementation dependency.
- [Three.js documentation](https://threejs.org/docs/): rendering and geometry tools. Actual local WebGL compatibility remains untested.
- [Playwright video](https://playwright.dev/docs/videos): recording is supported and finalizes on context close. Browser installation and software-renderer support need the opening spike.
- [Playwright visual comparison](https://playwright.dev/docs/test-snapshots): screenshot output depends on execution environment; use fixed cameras/runtime for evidence rather than cross-machine pixel identity as a correctness claim.
- [Managed Agent](https://ai.google.dev/gemini-api/docs/antigravity-agent) and [environment API](https://ai.google.dev/gemini-api/docs/agent-environment): managed execution and state/artifact mechanics, expanded in the shared playbook.

No API call, browser render, source implementation or FleetForge test was executed during preparation of this document.
