# Managed service implementation report

Implemented 25 October 2026. This report describes local adapter and HTTP evidence; it is not a live Gemini API execution report.

## Service and protocol

`server/index.ts` starts an Express API at `127.0.0.1:8787`. `createApp` exposes an injectable factory for SDK/client, evaluator, renderer, scenarios, holdouts, artifact directory and timing limits. The browser never receives `GEMINI_API_KEY`.

- `GET /api/status` returns actual credential/client configuration plus `gemini-4-argon` and `antigravity-preview-09-2026`. Missing credentials produce `configured:false`; `POST /api/runs` returns 503.
- `POST /api/runs` accepts `{scenarioId, task: 'repair'|'generate', request?: string}` and returns a durable run with HTTP 202. Unknown IDs, extra fields, malformed JSON and oversized requests are rejected.
- `GET /api/runs/:id` returns public run evidence. IDs must be generated UUIDs, never paths. Saved runs remain readable when credentials are removed.
- `POST /api/runs/:id/cancel` records cancellation intent, calls the SDK cancellation method and bounds confirmation checks. An unconfirmed cancellation is `incomplete`, with the retained remote ID; it is never represented as confirmed cancellation.
- `/sandbox.html` serves the isolated controller shell with a CSP denying network access. Root-owned evaluator and sandbox implement actual controller isolation and PNG rendering.

The official installed SDK is `@google/genai` 2.31.0. The adapter checks installed TypeScript signatures for `interactions.create`, `get(id, ...)` and `cancel(id, ...)`. Every interaction uses explicit Antigravity agent/model configuration, a string `max_total_tokens: '25000'`, `background:true`, `store:true`, and scoped tools/instructions. Continuations send both the previous interaction ID and retained environment ID. They reject a missing environment rather than silently starting elsewhere.

A source inspection and adapter regression test confirmed the Interactions bridge uses `maxRetries:0` to prevent ambiguous create requests from being silently retried. Its options differ from the older `httpOptions.retryOptions` shape. Getter network failures retry only retrieval of the saved ID, with a bounded error count. An ambiguous create error stops locally and never creates a replacement job automatically.

## Tool and artifact boundaries

The host exposes `evaluate_fleet`, `render_candidate`, and `submit_candidate`; generation also exposes `propose_scene`. Environment-owned code/filesystem calls are never dispatched on the developer host. No arbitrary host shell, filesystem path, URL download or remote artifact extraction endpoint exists.

Transferred source is one JavaScript file, at most 64 KiB in UTF-8, with a named `export function decide`. Parsing rejects static/dynamic imports, module reexports, `require`, and invalid syntax. Actual execution belongs to the browser Worker evaluator, never Node eval. Candidate IDs are immutable SHA-256 hashes of exact source bytes. Candidates are scoped to a validated scene hash. Three candidate evaluations and three generation scene proposals are the per-run limits. Feasibility search is bounded to 25,000 states and rejects exhaustion as well as infeasibility.

`render_candidate` uses the actual trusted renderer result, validates PNG signature and a 4 MiB bound, and attaches inline image data to the next managed interaction. The fake-SDK tests inject a tiny PNG only as test input; production has no illustrative/fake render fallback.

`submit_candidate` independently reruns exact registered source against the current scene plus all three `HOLDOUT_SCENARIOS`. It accepts only when every independent report passes and at least one holdout was run. API completion without accepted submission is `incomplete`. A holdout rejection never becomes a successful run. Repair cannot mutate its frozen scene. Generation proposals pass `parseScene` and `findFeasibleTrace` before becoming current.

`artifacts/runs/<uuid>.json` stores source registry, scene hash, IDs, statuses, bounded events and duplicate tool-call cache with atomic serialized writes. Duplicate call IDs reuse cached results; changed arguments under the same ID fail the run. Public GET responses omit the internal cache/registry. Restarted active runs become explicitly `incomplete` with saved IDs, rather than automatically submitting another potentially paid task. The artifacts directory is gitignored by project configuration.

## Verification evidence

- `npm test`: 57 tests passed across core and server at the reporting checkpoint (23 core, 34 server).
- `npm run build`: passed (includes TypeScript checking and Vite production build); Vite reports a nonfatal >500 kB chunk-size warning.
- Server coverage includes a complete evaluate → render → submit → complete tool cycle, independent holdout failure, duplicate call replay and changed-ID rejection, invalid JSON/source, UTF-8 source bound, unknown candidates/path-like IDs, frozen repair scene, invalid and infeasible generation proposals, three-attempt budget, environment-owned tool refusal, terminal/incomplete/budget/unknown statuses, saved-ID network retry bounds, late-result cancellation, unconfirmed cancellation, restart persistence, cancellation of saved remote jobs after local network failure, missing-key HTTP 503, request validation, sandbox CSP and official SDK argument/options shape.
- Initial lifecycle tests were introduced before implementation. Persistence-without-key and unconfirmed-cancellation tests were observed failing, then passed after fixes. The SDK options regression likewise caught and corrected a real request-option mismatch. A saved-job cancellation regression caught and fixed an inability to cancel a remote job after local network failure.

## Live limitations

No configured Gemini credential was available and no paid API call was made. Actual model access, remote environment provisioning, background polling latency, environment continuity, real custom-tool requests, token usage and live costs remain unverified. The prompts in `prompts/` describe implemented tools and limits; adversary and demo are optional preparation templates and are not separate automatically launched paid agents.

The root-owned browser evaluator/renderer is exercised separately by browser tests. Server adapter tests inject evaluator/renderer implementations, so they do not establish Chrome launch or WebGL availability on this machine. The root agent was investigating Chrome process launch failures at the time this report was written. There is no Node-execution fallback for an unavailable browser.

Primary protocol reference checked during implementation: [Antigravity agent documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent), alongside `docs/MANAGED-AGENTS-RESEARCH.md` and the installed SDK implementation/types.
