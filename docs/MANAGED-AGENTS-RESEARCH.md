# Managed Agents implementation and prompt playbook

Research date:25October2026. These are reference snippets and proposed application contracts, not an implemented or API-tested client. Read the selected project plan and [shared specification](00-shared-spec.md) first. Build only one project.

## Recommended integration

Use one persistent managed Argon engineer, a deterministic acceptance runner controlled by the application, and optional independent managed adversarial work. Add companion models only after the complete cycle works. Store run IDs, source/candidate hashes, interaction IDs, environment IDs and authoritative verification reports in the server.

The browser starts a run and polls its state; it never receives an API key. The server provisions the environment, seeds the selected source, dispatches the project prompt, handles custom tool requests, retrieves artifacts, rejects disallowed changes, runs independent acceptance and publishes the last passing artifact.

Model/agent roles:

| Role | Choice | Purpose |
|---|---|---|
| Engineer/repairer | Antigravity with explicit Argon model | Real code/scene execution and persistent files |
| Acceptance | Deterministic project code | Authoritative pass/fail from measured outputs |
| Adversary, optional | Separate managed Argon or measured Flash task | New cases/counterexamples; no acceptance ownership |
| Video/audio critic, optional | Direct Argon model call | Modalities not supported as managed input |

## SDK setup and provenance

The event guide says SDK≥2.3.0. The current [official Gemini API skill](https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-api-dev/SKILL.md), checked at file SHA`9add97f8e0a6e91bab022abd12923b257e01b024`, recommends `google-genai>=2.30.1` and `@google/genai>=2.29.1`. At implementation, install the current working SDK, record its exact version in a lockfile and prove the selected API methods. Avoid the deprecated `google-generativeai` and `@google/generative-ai` packages.

Suggested implementation-time commands, not run during planning:

```sh
python -m pip install 'google-genai>=2.30.1' fastapi uvicorn pydantic pytest
python -m pip show google-genai
npm install '@google/genai@^2.29.1'
```

Python alone is sufficient for the application integration; installing both SDKs is unnecessary unless the project uses both. Node remains useful for browser tools. Keep dependency manifests separated per selected application.

The event's suggested API skills installation is optional setup during execution:

```sh
npx skills add google-gemini/gemini-skills --skill gemini-api-dev
```

Install the Live API skill only for a selected real-time voice feature; none of these MVPs requires it. This planning run has not installed skills or dependencies.

## Reference start and continuation

The following Python is documentation code. `engineer_prompt` is the rendered common envelope plus the selected project prompt; it must be supplied by the application. `tools` is the application's registered tool-schema list, not strings naming imaginary SDK methods.

```python
from google import genai

client = genai.Client()  # Reads the server-side API-key environment.
agent_config = {
    "type": "antigravity",
    "model": "gemini-4-argon",
    "max_total_tokens": 250000,
}

first = client.interactions.create(
    agent="antigravity-preview-09-2026",
    agent_config=agent_config,
    environment="remote",
    input=engineer_prompt,
    tools=tools,
    background=True,
    store=True,
)

# Persist first.id immediately, plus environment_id when available.
# After the current interaction reaches a resumable/completed state:
followup = client.interactions.create(
    agent="antigravity-preview-09-2026",
    agent_config=agent_config,
    previous_interaction_id=completed.id,
    environment=completed.environment_id,
    input=repair_prompt,
    tools=tools,
    background=True,
    store=True,
)
```

`completed` and `repair_prompt` above are application values; this block is not a standalone executable script. The250,000-token setting is a proposed starting experiment, not a cost guarantee or API requirement. Tune after the first task; cached tokens are excluded from the documented managed token budget and it is best-effort. Record incomplete outcomes and actual usage. Do not automatically continue an exhausted budget without an application decision.

Re-send tools and any interaction-scoped instructions/configuration each turn. The common prompt envelope is included in each new task/repair input for clarity. Avoid relying on inherited defaults; the managed default model is Flash when Argon is not configured.

## Direct-model and managed settings differ

- The supplied guide's direct Argon `generation_config.thinking_level` and long-decode `max_output_tokens` example applies to model calls. Do not copy it wholesale into a managed interaction.
- Current managed documentation explicitly rejects `temperature`, `top_p`, `top_k`, `stop_sequences`, and `max_output_tokens`. Use managed `agent_config.max_total_tokens` for the documented best-effort interaction budget.
- Managed structured-output mode is unsupported. Request a JSON file in the prompt, download it and validate with Pydantic/Zod. Invalid/missing evidence means failed/blocked, not success.
- Managed input supports text/images. Direct Argon can process other supported modalities. Default to actual rendered stills; add separate video/audio analysis only when justified and verified.

See [managed configuration and limitations](https://ai.google.dev/gemini-api/docs/antigravity-agent).

## State machine and tool-call dispatcher

Application phases are defined in00-shared-spec; do not confuse them with raw API status.

| API state | Application action |
|---|---|
| `queued`, `in_progress` | Persist state, expose progress, poll with bounded backoff/deadline |
| `requires_action` | Dispatch only pending registered custom calls; return results and continue |
| `completed` | Retrieve candidate artifacts; independently verify before accepting |
| `incomplete` | Preserve evidence; expose budget/incompletion; no success claim |
| `failed`, `cancelled` | Preserve last accepted artifact and actual error/cancellation |
| Unknown | Record raw state and block gracefully; avoid infinite polling |

Poll about every2–5seconds with jitter and a measured deadline. A lost network connection is not evidence that the remote task failed: retrieve by saved ID before creating another job. Persist tool call results by call ID so reconnecting does not run a tool twice.

Example function schema, copied into the selected project's adapter and tested there:

```python
verify_tool = {
    "type": "function",
    "name": "verify_candidate",
    "description": "Run canonical public checks for a registered candidate ID.",
    "parameters": {
        "type": "object",
        "properties": {
            "candidate_id": {"type": "string"},
            "suite": {"type": "string", "enum": ["public"]},
        },
        "required": ["candidate_id", "suite"],
    },
}
tools = [{"type": "code_execution"}, verify_tool]
```

Passing a custom tool declaration does not implement it. The server must:

1. Read `function_call` steps lacking matching `function_result.call_id` entries. The call's identifier is `function_call.id`.
2. Match `name` against the role-specific registered custom-tool whitelist. Filesystem calls can appear among steps but are executed by the environment; do not dispatch every function-like name locally.
3. Validate arguments with the application's schema. Resolve candidate/scenario IDs through its registry; never accept arbitrary shell commands, host paths or URLs as a tool parameter.
4. Execute the bounded tool, save its result keyed by call ID, and return the real result. A repeated call ID uses the saved result.
5. Continue the same environment/history with input content of this form:

```python
function_result_content = {
    "type": "function_result",
    "name": call.name,
    "call_id": call.id,
    "result": actual_tool_result,
}
```

Return all required pending custom results before continuing. Re-send role tools and agent configuration. Handle exceptions as explicit tool-error results; avoid fabricated empty passes. Detailed dispatch comes from [managed function calling](https://ai.google.dev/gemini-api/docs/antigravity-agent#function-calling).

For rendered critique, append actual image content on continuation rather than only a local filename:

```python
image_content = {
    "type": "image",
    "mime_type": "image/png",
    "data": image_base64,
}
next_input = [function_result_content, image_content]
```

The application supplies `image_base64`; validate size and provenance. A contact sheet is acceptable evidence of actual rendered views. Generated illustrative images cannot substitute for rendering the candidate being checked.

## Sources and artifact transport

Seed only the selected project, public licensed references and synthetic fixtures. Use documented environment repository/inline sources, or a staged tar upload after provisioning. Pin source commits before baseline capture; the initial repository source may resolve a default branch and must not be represented as immutable until recorded.

Repository source shape:

```python
environment_config = {
    "type": "remote",
    "sources": [{
        "type": "repository",
        "source": public_repository_url,
        "target": "/workspace/project",
    }],
}
```

The server supplies an approved public URL. For local event work, upload an explicit allowlisted archive containing source/config, excluding API keys, private foot data, pre-event outputs and restrictive reference assets. Check member paths and extracted size before extraction. No public sandbox preview URL is assumed.

Retrieve each artifact with the current environment-files API:

```python
content = client.environments.files.download(
    environment=completed.environment_id,
    path=artifact_environment_path,
)
```

`artifact_environment_path` is recorded from environment file listing; do not assume it equals a local absolute shell path. Verify size, MIME/content, candidate ID and hash before exposing it. The old whole-environment snapshot download endpoint is deprecated. If downloading a tar directory, validate members and never blindly extract untrusted absolute paths or `..` entries. See [environment source/files documentation](https://ai.google.dev/gemini-api/docs/agent-environment).

Environment state and conversation state differ. Reusing only an environment preserves files/packages; reusing only a previous interaction does not guarantee those files. Handle expiration/missing environments as a new explicit bootstrap from the last saved artifact.

## Rendering and runtime gates

In the first30minutes, prove the actual demo machine and managed sandbox can support the chosen workflow:

- Official SDK import, model access, managed environment and a downloaded sentinel artifact.
- A second interaction reads the sentinel and retains the environment ID.
- A custom test tool is requested once, dispatched and resumed with the matching call ID.
- Exact project package imports/compilers and one deterministic fixture.
- If needed, Chromium renders a nonblank WebGL canvas and saves an image. Record video only after this succeeds.
- If needed, browser WebGPU returns an adapter and actually executes/readbacks a small compute shader; a browser presence check is insufficient.

Use a trusted local renderer through a custom function when sandbox Chromium is unavailable. Pass verified candidate data/artifacts to the renderer; do not expose a broad remote-shell tool on the developer machine. Stills are the default fallback. Video finalizes when the Playwright context closes; [Playwright recording documentation](https://playwright.dev/docs/videos) covers this behavior.

## Prompt assembly

Every project has five separate use cases: build kickoff for the coding assistant, engineer, independent adversary, repairer and demo preparation. The latter four are managed task templates. They become complete only after the project runner exists and supplies its schemas, file registry and tools.

Standalone files under `prompts/<project>/` contain the common envelope plus the relevant task. Replace supplied identifiers consistently and attach the request manifest. Required run context:

```json
{
  "run_id": "event-run-001",
  "project_id": "fleetforge",
  "candidate_id": "candidate-001",
  "workspace_root": "/workspace/project",
  "request_manifest_path": "requests/event-run-001.json",
  "read_only_paths": ["canonical/", "fixtures/holdout/"],
  "write_allowlist": ["candidate/", "artifacts/event-run-001/"],
  "tool_names": ["evaluate_fleet", "render_candidate", "submit_candidate"],
  "max_attempts": 3,
  "deadline_utc": "SET_ACTUAL_DEADLINE"
}
```

The request manifest includes project-specific source refs, scenario IDs, measurements, test commands and accepted input bounds. The example deadline is a required replacement, not a runnable timestamp. Never send hidden expected outputs to the builder. Give the adversary a distinct write allowlist and environment; its proposed cases still pass deterministic feasibility/validity checks.

## Verification and observability

At minimum test the adapter with a fake SDK for completion, requires_action, duplicate calls, missing artifacts, invalid JSON, incomplete budget, network reconnect, stale run revision and cancellation. The real paid smoke test is separate. Keep clear labels for fake/unit tests versus live API execution.

After a candidate finishes, the orchestrator recomputes acceptance. A successful API status means the model finished, not that the product passed. Candidate metadata must match the bytes evaluated. Show actual commands, source diff, test checks, rendered views and retained failures. Token counts are useful when available; no task-cost claim should be inferred from a token ceiling alone.

Cancellation reference:

```python
client.interactions.cancel(id=interaction_id)
```

Prefer the SDK method: the agent article and newer API/background pages show differing raw REST cancellation paths. See [background execution](https://ai.google.dev/gemini-api/docs/background-execution) and [API reference](https://ai.google.dev/api/interactions-api). Distinguish a cancellation request from confirmed terminal cancellation in the UI.

## Common prompt envelope

The file `prompts/00-common-envelope.md` is the authoritative copyable prefix. Project prompts then provide actual work. Plain prompt restrictions do not enforce filesystem protection; the application must own export allowlists and independent verification. Hooks may assist workflow instrumentation but are not relied upon as a complete boundary.

## Research status and unresolved checks

Verified from primary documentation: model selection, SDK recommendations, function result shape, separate state IDs, current files-download API, managed input/config limitations and background lifecycle. Not run: event credentials, sandbox provisioning, package installation, compiler/browser/GPU behavior, timings, task costs, or any project acceptance suite. The first build gate must measure those.

The supplied participant and builder guides remain the event authority. Product documentation describes capabilities, not eligibility or prize stacking.
