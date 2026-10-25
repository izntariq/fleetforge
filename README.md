# FleetForge

A proving ground for robot fleets. Generate a warehouse, reproduce a coordination failure, repair the controller, and verify every move in a 3D replay.

Built for the Gemini 4 Argon hackathon. The first build includes a deterministic simulator, an interactive Three.js warehouse, editable controllers, and a real Gemini Managed Agents adapter. Local reference mode runs without an API key and is explicitly labeled as a built-in reference.

## Run locally

Use Node.js 22.12 or later and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The local API listens on **127.0.0.1:8787**.

1. Select **Crossroads** and click **Reproduce failure**. The deliberately seeded greedy controller gets stuck without making illegal moves.
2. Click **Apply local repair**. The cooperative reference completes the deliveries; scrub the replay and inspect the actual source.
3. Try the other scenarios, switch camera views, or place a supported obstacle. The application rejects placements that cannot be proved feasible within its search budget.
4. Choose **Managed agent** to use the live integration once the server key is configured.

## Enable Gemini Managed Agents

Copy `.env.example` to `.env`, add your event key as `GEMINI_API_KEY`, and restart the development server. Keys remain on the server and `.env` is ignored by Git. Do not put a key in a `VITE_` variable or commit it.

The integration explicitly requests `antigravity-preview-09-2026` with `agent_config.model="gemini-4-argon"`, using the official `@google/genai` SDK. It retains both interaction and environment IDs, resumes custom tool calls, supplies actual rendered PNGs, caches duplicate tool calls, and independently checks a submitted candidate against the selected scene and three additional scenarios. See the [primary Managed Agents documentation](https://ai.google.dev/gemini-api/docs/managed-agents-quickstart).

The agent may use these application-owned tools:

| Tool               | Behavior                                                                    |
| ------------------ | --------------------------------------------------------------------------- |
| `evaluate_fleet`   | Register immutable controller source and run it against the frozen scenario |
| `render_candidate` | Attach an actual PNG of the measured trajectory                             |
| `submit_candidate` | Recompute selected-scene and holdout results; accept only if all pass       |
| `propose_scene`    | Generation mode only: validate a bounded scene and prove feasibility        |

The first live run needs an accessible Chrome installation on macOS, or installed Playwright Chromium on Linux, plus the Vite renderer running. The service reports failures rather than substituting local results for a managed run. An unset key returns an explicit `503` on run creation.

## What is measured

The trusted engine models an 8×8 grid, two robots, automatic pickup/dropoff, simultaneous actions, shared-cell collisions, opposing edge swaps, delayed aisle blocking, and a 120-tick limit. The independent verifier replays action messages and rejects fabricated state. The bounded joint-state search distinguishes `infeasible` from `budget_exhausted`.

Initial non-browser checks across three public scenarios and three additional scenarios:

| Controller                       | Deliveries per scenario |             Completion | Illegal moves |
| -------------------------------- | ----------------------: | ---------------------: | ------------: |
| Deliberately seeded greedy fault |                   0 / 2 | 120-tick limit reached |             0 |
| Built-in cooperative reference   |                   2 / 2 |              7–8 ticks |             0 |

These results were computed by the simulator in Node. They are not evidence of a Gemini-generated repair or measured browser performance. The reference has been tested on all six repository scenarios; these public fixtures do not constitute an unseen production benchmark.

## Checks

```sh
npm test              # Simulator, schemas, transfer validation, API and agent lifecycle
npm run build        # TypeScript and production frontend bundle
npm run test:browser # Separate real-browser UI, replay and sandbox checks
```

The browser suite uses the installed Chrome channel on macOS. Browser checks and live Gemini execution are separate from unit tests. See [verification status](docs/STATUS.md) for what was run and the [hackathon readiness audit](docs/HACKATHON-READINESS.md) for submission gates.

## Structure

```text
src/core/          Trusted scenario contracts, fixtures and deterministic engine
src/verify/        Independent replay and bounded feasibility search
src/controller/    Standalone candidate sources and browser Worker protocol
src/view/          Original procedural Three.js warehouse
src/App.tsx        Mission selection, replay, evidence and controller editing
server/            Managed runs, SDK adapter, trusted browser evaluation and rendering
prompts/           Engineer, repair, adversary and demo task templates
tests/             Core, service and browser checks
docs/              Build plan, research, provenance and current limitations
```

Candidate source executes in a browser module Worker with a deadline and a network-denying CSP. The canonical engine and server never import candidate code into Node. Source is limited to 64 KiB and mutable controller state to 16 KiB. This is a bounded prototype execution design, not a general security guarantee.

## Next hackathon milestones

1. Complete the visual/replay and Worker smoke test on the demo machine.
2. Configure the event key and prove real create → tool → continuation → render → submit behavior.
3. Capture one genuine source repair, retaining the failing candidate, interaction/environment IDs and measured comparison.
4. Run one genuine generated-scene task, then repair against its frozen scene; preserve the rendered critique.
5. Record the 60-second submission and rehearse a three-minute live demonstration. Confirm track eligibility and the separate bonus rubric with organizers.

Research informed the choice: [Open-RMF](https://osrf.github.io/ros2multirobotbook/rmf-core.html) already addresses robot traffic scheduling. FleetForge focuses on an accessible source-repair loop with visual and deterministic evidence. It does not claim to invent multi-agent path finding or certify real robot safety.

A CI configuration is included as `docs/ci-check.yml.example`; installing it as a GitHub workflow requires an appropriately scoped GitHub credential.

See [build decisions](docs/BUILD.md), [Managed Agents research](docs/MANAGED-AGENTS-RESEARCH.md), and [provenance](PROVENANCE.md).
