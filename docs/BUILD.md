# FleetForge first playable build

Goal: a real 3D world where a deliberately faulty two-robot controller jams, an engineer repairs its source, and independent simulation verifies the deliveries.

Architecture: shared TypeScript contracts and trusted grid engine; React + Three.js warehouse; browser Worker for untrusted controller code; Express + official Google GenAI SDK for background Managed Agents, tools, artifacts and cancellation. Ruling: use TypeScript throughout rather than the proposed Python API so there is one scenario/verification contract and one install.

Constraints: original event-authored geometry; 8×8 world; at most 24 free cells; two robots; 120 ticks; no shared destinations or opposing edge swaps. Candidate code only returns moves and JSON state. A separately owned verifier recomputes outcomes. Missing API credentials must be explicit; local reference behavior must never be labeled AI-generated. No claim of real robot safety or guaranteed prize eligibility.

1. Simulator: schema and fixtures, deterministic movement, bounded joint-state feasibility, independent trace verification; tests for collisions, blocked goals, forged states, delayed blocking and deterministic replay.
2. Controller execution: isolated browser module Worker, source/state/deadline bounds, network denied, candidate errors retained, original seeded failure and independently authored reference controller.
3. Interface: original interactive isometric warehouse, camera controls, playback/scrubbing, scenario selection, editable supported obstacles, rendered robot state, visible fault→repair→verify flow.
4. Managed service: explicit event model, durable run IDs and interaction/environment IDs, tool allowlist, duplicate-call cache, candidate validation and independent evaluation, actual rendered image feedback, cancellation and honest capability status.
5. Delivery: integration/browser checks, public clean repository, README/provenance, prompts and next build steps. A live paid API run requires credentials; adapter tests are separate evidence.

Review focus: edge swaps; infeasible blocked aisles; hanging controller timeout; forged completion; stale/cancelled runs; visual replay consistency; truthful offline/live labels.

Plan source: the researched FleetForge option and Managed Agents playbook copied alongside this file. User delegated project choice and explicitly requested immediate implementation and a separate repository on 2026-10-25.

## Delivery checkpoint

- [x] Standalone Git repository and shared contracts
- [x] Strict schemas, deterministic simulator, bounded feasibility and canonical verification
- [x] Seeded failure and cooperative reference with six-case measured comparison
- [x] Original Three.js interface, replay, source editor and run history implementation
- [x] Real Managed Agents adapter, persisted IDs, tool cycle and prompts
- [x] Non-browser checks and production build; independent review fixes
- [ ] Actual browser/visual smoke test (origin permission was declined)
- [ ] Event-key live Managed Agents create/tool/resume/render/submit smoke test
- [ ] Genuine generated scene and source repair evidence
- [ ] Submission video, live rehearsal and organizer eligibility confirmation

The repository deliberately preserves a labeled local reference mode while live Gemini is unconfigured. The initial implementation remains on local `build/first-demo`. A clean publication snapshot is on `main`; there is no prior base branch to merge into. GitHub rejected creation of a workflow with the current OAuth permissions, so CI is supplied as `docs/ci-check.yml.example` rather than an active workflow. Implementation decisions are TypeScript throughout, two robots, and original geometry. Cost if these choices are wrong: language conversion, a larger state-space planner, or replacement assets; all are reversible before submission.
