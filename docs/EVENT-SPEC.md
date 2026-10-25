# Shared specification for the ten-project build pack

Status: researched planning proposals, not implemented applications. The user requested architecture, tools, build plans and complete Managed Agents prompts for ten alternative projects. Build one selected project, not all ten. Project-specific choices remain proposals for review.

## Event requirements

- Team: one builder with one or two possible teammates; maximum event team size four.
- Build window: 10:30–17:00 Pacific on 25 October 2026; plan for 390 minutes including submission.
- Submission: public repository, accessible one-minute video, all team members included.
- Judging: approximately three-minute live demo plus questions. Round one weights working demo50%, usefulness25%, originality15%, clarity10%; finals weight these equally.
- Track1: substantial software migration, translation or upgrade with measured baseline. A single trivial function port or ordinary bug fix weakens fit.
- Track2: generated 3D game/procedural world, rendered inspection, critique and repair. CAD and assembly-only interpretations need event clarification.
- Explicitly distinguish event-built functionality from upstream libraries, pre-event work and seeded benchmark defects.
- No basic RAG, Streamlit, image-analyzer-only product, dashboard as the main feature, medical-advice product, or other excluded categories in the participant guide.
- Separate Best Use of Managed Agents criteria and prize stacking were not supplied; do not invent them.

## Common product and agent requirements

- Use the real Gemini Managed Agents service: Interactions API, `agent="antigravity-preview-09-2026"`, `agent_config={"type":"antigravity","model":"gemini-4-argon"}`, `environment="remote"` for the initial environment. Confirm the event key supports this in the opening spike.
- Official SDK floor from the builder guide: `google-genai>=2.3.0` or `@google/genai>=2.3.0`. The current official Gemini API skill checked during this research recommends Python `google-genai>=2.30.1` and JavaScript `@google/genai>=2.29.1`; prefer those newer documented versions, then pin the actual working version at implementation time.
- Default recommendation: a Python API/orchestrator and official Python SDK; TypeScript/Vite browser application. Project plans may choose a different stack where justified.
- Keep API keys on the server. Prompts and browser bundles must not contain them. Do not install anything or consume event API credits while merely writing these plans.
- Persist both interaction ID and environment ID; their state purposes differ. An environment ID alone is not conversation history.
- Managed Agent text/image input is distinct from direct Argon multimodal input. Do not pass video/audio directly to the managed harness without verified support; use a direct-model tool or measured files where necessary.
- Headless Chromium, WebGL, video capture, GPU acceleration and public preview URLs are not presumed available in the managed runtime. A project that needs one must specify an early smoke test and a bounded fallback.
- Use one managed engineer initially. A second managed adversary/verifier is optional after a complete loop works. Flash leaf tasks are optional, not a prerequisite or a bonus-scoring guarantee.
- Final acceptance is computed by deterministic code, not the agent's prose or self-reported success JSON.
- Candidate permissions, accepted patch paths, immutable contracts and verifier ownership must be explicit. A prompt saying “do not edit tests” is not an enforcement boundary. Keep canonical checks outside the builder workspace, accept only permitted candidate files, and rerun against canonical checks from a separate runner/environment. Do not claim managed hooks are a complete security boundary.
- Product plans must identify the supported input domain, reject incompatible requests clearly, bound resource consumption, and retain the last verified artifact if a later attempt fails.
- Every demo must execute fresh input or verification live. Earlier event runs and recordings are labeled. Fresh model repair is latency-dependent and is not guaranteed to finish within three minutes.

## Canonical planning interfaces

These are proposed application interfaces, not Gemini SDK methods. Project authors must implement and test them if the project is selected.

`start_run(request: ProjectRequest) -> RunRecord`

`verify_candidate(candidate_id: str, suite: str) -> VerificationReport`

`render_candidate(candidate_id: str, view_ids: list[str]) -> RenderBundle`

`RunRecord = {run_id, project_id, phase, interaction_id, environment_id, candidate_id, started_at, updated_at}`

`phase` is one of `queued`, `working`, `verifying`, `passed`, `failed`, `cancelled`, `blocked`.

`VerificationReport = {run_id, candidate_id, status, checks, artifact_paths, elapsed_ms, limitations}`

`status` is one of `passed`, `failed`, `blocked`.

`checks` entries contain `{id, passed, observed, expected, evidence_path}`. `artifact_paths` are project-relative output paths resolved under that run's artifact directory. Reject path traversal and unknown run/candidate IDs.

`RenderBundle = {candidate_id, views:[{view_id,image_path}], video_path|null, provenance}`.

Artifacts live at `artifacts/<run_id>/`; record candidate hash, verifier version and source provenance. The agent may propose a result report; the orchestrator fills authoritative check status from actual verification.

## Shared budget and workflow defaults

- First30min: official API, sandbox persistence/artifact download and project-specific runtime smoke tests. Record failures instead of guessing compatibility.
- Use two repair attempts per live candidate, three per offline development candidate, and at most two simultaneous managed jobs initially. These are application limits, not claimed API limits.
- Configure a measured application deadline; avoid unbounded polling or automatic retrying of side effects. Cancel or expose incomplete state rather than reporting success.
- Save the first complete candidate before repair. Compare it and the repaired artifact with the same frozen evaluation cases. Use held-out cases for an additional check; do not disclose expected held-out outputs to the builder.
- Record elapsed time and token usage when available. No promised speedup, winning probability or exact task cost before measurement.
- Last90min: scope freeze, verification, one-minute video, rehearsals, public-repo attribution, submission buffer.
- No real payments, shipment requests, hardware movement, private-data uploads or external messages are required for these demo plans.

## Jootafly boundaries

The current workspace is existing Jootafly footwear/Foot Lab work, not an empty hackathon application. Its geometry, viewers, tests and historical fixes are pre-event work. This directory is not currently a Git checkout.

Use newly authored original geometry and synthetic data in public event demos. Official Zellerfeld reference templates carry CC BY-NC-ND4.0; do not assume template-derived output can be included in the public repository. The previous rounded-interior repair is already complete and cannot be presented as new work.

Photo reconstruction, real phone behavior, physical fit and manufacturing performance remain unverified. Blender background rendering has a recorded initialization failure. Browser rendering and imported synthetic fixtures are safer starting points.

## Required content of every project plan

1. Exact user, deliverable, differentiation, track fit and unresolved assumptions.
2. Researched stack and source/license candidates with primary links and status.
3. Architecture, file ownership, typed interfaces and runtime/data flows.
4. Exact verifier invariants, representative fixtures, holdouts and baseline methodology.
5. Five to seven independently testable implementation tasks, with file paths, interface signatures, checkbox steps, meaningful test assertions and commands. Test snippets are planned code, not executed tests.
6. Six-hour allocation, team division, stop conditions, scope cuts and live fallback.
7. Copyable project-specific engineer, adversary/verifier, repair and live-demo prompts. Refer to the common prompt envelope but include substantive project instructions, permitted paths, commands and acceptance criteria.
8. Three-minute live script, one-minute submission script, evidence manifest and honest limitations.
9. Primary-source research ledger: what each source supports and what has not been run or verified.

## Source documents

- Participant guide: `/Users/teriminator/.codex/attachments/b425a558-dd43-4294-bd7b-4c20fae7e99f/Pasted text.txt`.
- Builder guide: `/Users/teriminator/.codex/attachments/06c1447c-f0e5-4dd8-97a7-b755167be5c9/Pasted text.txt`.
- Local workspace: `/Users/teriminator/Documents/Projects/zeller_joota`.

The research and suggested prompts do not authorize building all projects. This pack is the decision and execution preparation artifact requested by the user.
