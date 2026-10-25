import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentRun } from '../src/agent-types';
import type { Evaluation, Scenario, SceneSpec } from '../src/core/types';
import { parseScene } from '../src/core/scenario';
import { findFeasibleTrace } from '../src/verify/feasible';
import { validateCandidateSource } from './source';
import { buildPrompt } from './prompts';

export const AGENT = 'antigravity-preview-09-2026';
export const MODEL = 'gemini-4-argon';
export type Interaction = {
  id: string;
  status: string;
  environment_id?: string;
  steps?: unknown[];
  errors?: unknown[];
  [key: string]: unknown;
};
export type ManagedClient = {
  interactions: {
    create(request: Record<string, unknown>): Promise<Interaction>;
    get(id: string): Promise<Interaction>;
    cancel(id: string): Promise<Interaction>;
  };
};
export type RunnerOptions = {
  client: ManagedClient;
  scenes: SceneSpec[];
  holdouts: Scenario[];
  evaluateSource(source: string, scenario: Scenario, candidateId: string): Promise<Evaluation>;
  renderEvaluation(
    evaluation: Evaluation,
    scene: SceneSpec,
  ): Promise<{ mimeType: string; data: string }>;
  artifactsDir?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  maxNetworkErrors?: number;
  deadlineMs?: number;
};
type ToolCall = { type: 'function_call'; id: string; name: string; arguments: unknown };
type ToolReply = {
  type: 'function_result';
  name: string;
  call_id: string;
  result: Record<string, unknown>;
};
type CachedTool = {
  fingerprint: string;
  result: ToolReply;
  image?: { type: 'image'; mime_type: string; data: string };
};
type CandidateRecord = { id: string; source: string; sceneHash: string; evaluation: Evaluation };
type StoredRun = AgentRun & {
  toolCache: Record<string, CachedTool>;
  candidates: Record<string, CandidateRecord>;
  attempts: number;
  proposals: number;
  acceptedId?: string;
  request?: string;
  cancelRequested?: boolean;
};
const terminal = new Set(['completed', 'failed', 'incomplete', 'cancelled']);
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sceneHash = (scene: SceneSpec) => hash(JSON.stringify(scene));
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('tool arguments must be an object');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`tool requires exactly: ${keys.join(', ')}`);
}
export function toolsFor(task: 'repair' | 'generate') {
  const object = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const tools: Record<string, unknown>[] = [
    { type: 'code_execution' },
    {
      type: 'function',
      name: 'evaluate_fleet',
      description:
        'Register immutable standalone JS source and evaluate it in the current scene. Maximum three candidates.',
      parameters: object({ source: { type: 'string' }, scenario_id: { type: 'string' } }, [
        'source',
        'scenario_id',
      ]),
    },
    {
      type: 'function',
      name: 'render_candidate',
      description:
        'Render actual evaluated trajectory as PNG and attach the image to this conversation.',
      parameters: object({ candidate_id: { type: 'string' } }, ['candidate_id']),
    },
    {
      type: 'function',
      name: 'submit_candidate',
      description:
        'Independently rerun registered candidate against the current scene and hidden holdouts. Only all-pass is accepted.',
      parameters: object({ candidate_id: { type: 'string' } }, ['candidate_id']),
    },
  ];
  if (task === 'generate')
    tools.push({
      type: 'function',
      name: 'propose_scene',
      description:
        'Validate an 8×8 SceneSpec and independently prove bounded feasibility. Generation runs only; at most three proposals.',
      parameters: object({ scene: { type: 'object' } }, ['scene']),
    });
  return tools;
}

export class ManagedRunner {
  readonly client: ManagedClient;
  private readonly options: RunnerOptions;
  private readonly directory: string;
  private readonly runs = new Map<string, StoredRun>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly cancellations = new Map<string, Promise<void>>();
  constructor(options: RunnerOptions) {
    this.options = options;
    this.client = options.client;
    this.directory = resolve(options.artifactsDir ?? 'artifacts/runs');
  }
  private public(run: StoredRun): AgentRun {
    const {
      toolCache: _cache,
      candidates: _candidates,
      attempts: _attempts,
      proposals: _proposals,
      acceptedId: _accepted,
      request: _request,
      cancelRequested: _cancel,
      ...publicRun
    } = run;
    return structuredClone(publicRun);
  }
  private async save(run: StoredRun) {
    run.updatedAt = new Date().toISOString();
    // Serial snapshots prevent a slow write from replacing newer cancellation state.
    const contents = JSON.stringify(run, null, 2);
    const previous = this.writes.get(run.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const destination = join(this.directory, `${run.id}.json`);
        const temp = `${destination}.${randomUUID()}.tmp`;
        await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, destination);
      });
    this.writes.set(run.id, next);
    await next;
  }
  private event(
    run: StoredRun,
    message: string,
    kind: AgentRun['events'][number]['kind'] = 'info',
  ) {
    run.events.push({ at: new Date().toISOString(), message, kind });
    if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
  }
  async get(id: string): Promise<AgentRun | undefined> {
    if (!idPattern.test(id)) return undefined;
    let run = this.runs.get(id);
    if (!run) {
      try {
        run = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')) as StoredRun;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      if (run.id !== id) throw new Error('Stored run identity mismatch');
      // A process restart never silently resubmits a potentially paid background job.
      if (!terminal.has(run.status)) {
        run.status = 'incomplete';
        run.phase = 'interrupted';
        run.error =
          'Server restarted. Remote interaction may still be running; its saved ID is retained.';
        this.event(run, run.error, 'error');
        await this.save(run);
      }
      this.runs.set(id, run);
    }
    return this.public(run);
  }
  async start(input: {
    scenarioId: string;
    task: 'repair' | 'generate';
    request?: string;
  }): Promise<AgentRun> {
    const selected = this.options.scenes.find((scene) => scene.scenario.id === input.scenarioId);
    if (!selected) throw new Error('Unknown scenario');
    if (!['repair', 'generate'].includes(input.task)) throw new Error('Unknown task');
    if (
      input.request !== undefined &&
      (typeof input.request !== 'string' || input.request.length > 4000)
    )
      throw new Error('request must be at most 4000 characters');
    const now = new Date().toISOString(),
      scene = structuredClone(selected);
    const run: StoredRun = {
      id: randomUUID(),
      status: 'queued',
      phase: 'queued',
      task: input.task,
      scenarioId: input.scenarioId,
      scene,
      sceneHash: sceneHash(scene),
      events: [],
      createdAt: now,
      updatedAt: now,
      toolCache: Object.create(null),
      candidates: Object.create(null),
      attempts: 0,
      proposals: 0,
      request: input.request,
    };
    this.event(run, 'Managed Gemini job queued; independent verification is required.');
    this.runs.set(run.id, run);
    await this.save(run);
    this.jobs.set(run.id, this.execute(run));
    return this.public(run);
  }
  async wait(id: string) {
    await this.jobs.get(id);
  }
  async cancel(id: string): Promise<AgentRun | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const run = this.runs.get(id)!;
    if (terminal.has(run.status) && !(run.status === 'incomplete' && run.interactionId))
      return this.public(run);
    if (run.status === 'incomplete' && run.interactionId)
      this.cancellations.delete(`${run.id}:${run.interactionId}`);
    run.error = undefined;
    run.cancelRequested = true;
    run.status = 'cancelling';
    run.phase = 'cancelling';
    this.event(run, 'Cancellation requested.');
    await this.save(run);
    if (run.interactionId) await this.cancelRemote(run, run.interactionId);
    else {
      run.status = 'cancelled';
      run.phase = 'cancelled';
      await this.save(run);
    }
    return this.public(run);
  }
  private cancelRemote(run: StoredRun, id: string): Promise<void> {
    const key = `${run.id}:${id}`;
    const existing = this.cancellations.get(key);
    if (existing) return existing;
    const job = this.confirmCancellation(run, id);
    this.cancellations.set(key, job);
    return job;
  }
  private async confirmCancellation(run: StoredRun, id: string) {
    try {
      let result = await this.client.interactions.cancel(id);
      for (
        let attempt = 0;
        attempt < 3 &&
        !['cancelled', 'completed', 'failed', 'incomplete', 'budget_exceeded'].includes(
          result.status,
        );
        attempt++
      ) {
        run.status = 'cancelling';
        this.event(run, `Remote cancellation returned ${result.status}; checking confirmation.`);
        await this.save(run);
        await delay(this.options.pollIntervalMs ?? 2500);
        result = await this.client.interactions.get(id);
      }
      if (result.status === 'cancelled') {
        run.status = 'cancelled';
        run.phase = 'cancelled';
        this.event(run, 'Remote cancellation confirmed.');
      } else if (['completed', 'failed', 'incomplete', 'budget_exceeded'].includes(result.status)) {
        run.status = 'cancelled';
        run.phase = 'cancelled';
        this.event(
          run,
          `Remote job already ended ${result.status}; its result is ignored after cancellation.`,
        );
      } else
        throw new Error(
          `remote interaction remains ${result.status} after bounded confirmation checks`,
        );
    } catch (error) {
      run.status = 'incomplete';
      run.phase = 'cancellation-unconfirmed';
      run.error = `Cancellation unconfirmed: ${errorMessage(error)}`;
      this.event(run, run.error, 'error');
    }
    await this.save(run);
  }
  private request(run: StoredRun, input: unknown, previous?: Interaction) {
    if (previous && !run.environmentId)
      throw new Error(
        'Managed continuation omitted environment ID; refusing to lose environment state',
      );
    return {
      agent: AGENT,
      agent_config: { type: 'antigravity', model: MODEL, max_total_tokens: '25000' },
      environment: run.environmentId ?? 'remote',
      ...(previous ? { previous_interaction_id: previous.id } : {}),
      input,
      tools: toolsFor(run.task),
      background: true,
      store: true,
      system_instruction:
        'Use only the provided FleetForge tools to transfer code. The application alone decides acceptance. Maximum three candidate evaluations. Do not request developer filesystem or shell access.',
    };
  }
  private async capture(run: StoredRun, current: Interaction) {
    if (!current?.id || typeof current.id !== 'string')
      throw new Error('Managed API returned no interaction ID');
    run.interactionId = current.id;
    if (current.environment_id) run.environmentId = current.environment_id;
    run.phase = current.status;
    this.event(run, `Managed interaction ${current.id}: ${current.status}.`);
    await this.save(run);
  }
  private async execute(run: StoredRun) {
    const deadline = Date.now() + (this.options.deadlineMs ?? 8 * 60_000);
    const maxPolls = this.options.maxPolls ?? 180;
    const interval = this.options.pollIntervalMs ?? 2500;
    let networkErrors = 0;
    try {
      run.status = 'running';
      run.phase = 'starting';
      await this.save(run);
      let current = await this.client.interactions.create(this.request(run, buildPrompt(run)));
      await this.capture(run, current);
      for (let poll = 0; poll < maxPolls; poll++) {
        if (run.cancelRequested) {
          if (current.status === 'cancelled') {
            run.status = 'cancelled';
            run.phase = 'cancelled';
            await this.save(run);
            return;
          }
          await this.cancelRemote(run, current.id);
          return;
        }
        if (Date.now() >= deadline)
          throw new Error(
            'Managed run deadline reached; remote job status remains inspectable by interaction ID',
          );
        if (current.status === 'requires_action') {
          const input = await this.dispatch(run, current);
          if (run.cancelRequested) {
            await this.cancelRemote(run, current.id);
            return;
          }
          // Never retry create after an ambiguous network error: it could duplicate a paid interaction.
          current = await this.client.interactions.create(this.request(run, input, current));
          await this.capture(run, current);
          continue;
        }
        if (current.status === 'completed') {
          run.status = run.acceptedId ? 'completed' : 'incomplete';
          run.phase = run.acceptedId ? 'verified' : 'unsubmitted';
          if (!run.acceptedId)
            run.error =
              'Managed interaction completed without an independently passing submitted candidate.';
          this.event(
            run,
            run.acceptedId
              ? 'Candidate passed independent current-scene and holdout checks.'
              : run.error!,
            run.acceptedId ? 'success' : 'error',
          );
          await this.save(run);
          return;
        }
        if (['failed', 'cancelled', 'incomplete', 'budget_exceeded'].includes(current.status)) {
          run.status =
            current.status === 'budget_exceeded'
              ? 'incomplete'
              : (current.status as AgentRun['status']);
          run.phase = current.status;
          if (current.status !== 'cancelled')
            run.error = `Managed interaction ended ${current.status}${current.errors?.length ? `: ${JSON.stringify(current.errors).slice(0, 1000)}` : ''}`;
          this.event(
            run,
            run.error ?? 'Remote job cancelled.',
            current.status === 'cancelled' ? 'info' : 'error',
          );
          await this.save(run);
          return;
        }
        if (!['queued', 'in_progress'].includes(current.status))
          throw new Error(`Unknown managed API status: ${current.status}`);
        await delay(
          interval === 0 ? 0 : Math.min(5000, interval + Math.floor(Math.random() * 250)),
        );
        if (run.cancelRequested) {
          await this.cancelRemote(run, current.id);
          return;
        }
        try {
          current = await this.client.interactions.get(current.id);
          networkErrors = 0;
          await this.capture(run, current);
        } catch (error) {
          networkErrors++;
          this.event(
            run,
            `Could not retrieve saved interaction (${networkErrors}): ${errorMessage(error)}`,
            'error',
          );
          await this.save(run);
          if (networkErrors >= (this.options.maxNetworkErrors ?? 3))
            throw new Error(
              'Network unavailable; saved interaction may still be running. No replacement job was created.',
            );
        }
      }
      throw new Error(
        'Managed polling/continuation limit reached; saved remote interaction may still be running',
      );
    } catch (error) {
      if (run.cancelRequested && run.status === 'cancelled') return;
      run.status = /reused|Unknown managed API status|omitted environment/.test(errorMessage(error))
        ? 'failed'
        : 'incomplete';
      run.phase = 'stopped';
      run.error = errorMessage(error);
      this.event(run, run.error, 'error');
      await this.save(run);
    }
  }
  private async dispatch(run: StoredRun, current: Interaction): Promise<unknown[]> {
    const steps = current.steps ?? [];
    const completed = new Set(
      steps
        .filter(
          (s): s is { type: string; call_id: string } =>
            !!s && typeof s === 'object' && (s as { type?: string }).type === 'function_result',
        )
        .map((s) => s.call_id),
    );
    const allowed = new Set(
      toolsFor(run.task)
        .filter((t) => t.type === 'function')
        .map((t) => t.name),
    );
    // Environment-owned tools appear as function calls too. Never dispatch those on the host.
    const calls = steps.filter(
      (s): s is ToolCall =>
        !!s &&
        typeof s === 'object' &&
        (s as ToolCall).type === 'function_call' &&
        !completed.has((s as ToolCall).id) &&
        allowed.has((s as ToolCall).name),
    );
    // A repair-time propose_scene is explicitly rejected, so attempted mutation is visible.
    const forbidden = steps.filter(
      (s): s is ToolCall =>
        !!s &&
        typeof s === 'object' &&
        (s as ToolCall).type === 'function_call' &&
        !completed.has((s as ToolCall).id) &&
        (s as ToolCall).name === 'propose_scene' &&
        !allowed.has('propose_scene'),
    );
    const pending = [...calls, ...forbidden];
    if (!pending.length)
      throw new Error('requires_action contained no pending allowed FleetForge tools');
    if (pending.length > 16 || Object.keys(run.toolCache).length + pending.length > 64)
      throw new Error('Tool-call budget exceeded');
    const input: unknown[] = [];
    for (const call of pending) {
      if (run.cancelRequested) break;
      if (typeof call.id !== 'string' || !call.id || call.id.length > 300)
        throw new Error('Invalid tool call ID');
      const fingerprint = hash(JSON.stringify([call.name, call.arguments]));
      let cached = Object.hasOwn(run.toolCache, call.id) ? run.toolCache[call.id] : undefined;
      if (cached && cached.fingerprint !== fingerprint)
        throw new Error(`Tool call ID ${call.id} was reused with different arguments`);
      if (!cached) {
        let result: Record<string, unknown>, image: CachedTool['image'];
        try {
          const outcome = await this.tool(run, call);
          result = outcome.result;
          image = outcome.image;
        } catch (error) {
          result = { ok: false, error: errorMessage(error) };
        }
        cached = {
          fingerprint,
          result: { type: 'function_result', name: call.name, call_id: call.id, result },
          ...(image ? { image } : {}),
        };
        Object.defineProperty(run.toolCache, call.id, {
          value: cached,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        this.event(
          run,
          `${call.name}: ${result.ok === false ? String(result.error) : 'completed'}`,
          'tool',
        );
        await this.save(run);
      }
      input.push(cached.result);
      if (cached.image) input.push(cached.image);
    }
    return input;
  }
  private async tool(
    run: StoredRun,
    call: ToolCall,
  ): Promise<{ result: Record<string, unknown>; image?: CachedTool['image'] }> {
    let args: Record<string, unknown>;
    try {
      args = record(
        typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments,
      );
    } catch {
      throw new Error('Invalid JSON tool arguments');
    }
    if (call.name === 'propose_scene') {
      if (run.task !== 'generate') throw new Error('Scene is frozen during repair');
      exactKeys(args, ['scene']);
      if (++run.proposals > 3) throw new Error('Scene proposal budget exhausted');
      const proposed = parseScene(args.scene);
      const feasibility = findFeasibleTrace(proposed.scenario, 25000);
      if (feasibility.status !== 'feasible')
        throw new Error(`Scene rejected: ${feasibility.status}`);
      run.scene = structuredClone(proposed);
      run.scenarioId = proposed.scenario.id;
      run.sceneHash = sceneHash(proposed);
      run.acceptedId = undefined;
      run.candidate = undefined;
      run.evaluation = undefined;
      return {
        result: {
          ok: true,
          scene: proposed,
          scene_hash: run.sceneHash,
          feasibility: { status: feasibility.status, explored: feasibility.explored },
        },
      };
    }
    if (call.name === 'evaluate_fleet') {
      exactKeys(args, ['source', 'scenario_id']);
      validateCandidateSource(args.source);
      if (args.scenario_id !== run.scenarioId)
        throw new Error('scenario_id must match the current registered scene');
      const id = hash(args.source);
      let candidate = Object.hasOwn(run.candidates, id) ? run.candidates[id] : undefined;
      if (candidate && candidate.sceneHash !== run.sceneHash) candidate = undefined;
      if (!candidate) {
        if (++run.attempts > 3) throw new Error('Maximum three candidate evaluations reached');
        const evaluation = await this.options.evaluateSource(
          args.source,
          structuredClone(run.scene.scenario),
          id,
        );
        candidate = { id, source: args.source, sceneHash: run.sceneHash, evaluation };
        run.candidates[id] = candidate;
      }
      run.acceptedId = undefined;
      run.candidate = { id, source: candidate.source, provenance: 'gemini-managed' };
      run.evaluation = candidate.evaluation;
      return {
        result: {
          ok: true,
          candidate_id: id,
          source_hash: id,
          scene_hash: run.sceneHash,
          report: candidate.evaluation.report,
        },
      };
    }
    exactKeys(args, ['candidate_id']);
    const candidate =
      typeof args.candidate_id === 'string' && Object.hasOwn(run.candidates, args.candidate_id)
        ? run.candidates[args.candidate_id]
        : undefined;
    if (!candidate) throw new Error('Unknown candidate');
    if (candidate.sceneHash !== run.sceneHash)
      throw new Error('Candidate belongs to a stale scene; evaluate it again');
    if (call.name === 'render_candidate') {
      const image = await this.options.renderEvaluation(
        candidate.evaluation,
        structuredClone(run.scene),
      );
      if (
        image.mimeType !== 'image/png' ||
        !image.data ||
        Buffer.byteLength(image.data, 'base64') > 4 * 1024 * 1024 ||
        !Buffer.from(image.data, 'base64')
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error('Renderer returned invalid or oversized PNG');
      return {
        result: {
          ok: true,
          candidate_id: candidate.id,
          mime_type: image.mimeType,
          description: 'Attached PNG renders the measured trajectory.',
        },
        image: { type: 'image', mime_type: image.mimeType, data: image.data },
      };
    }
    if (call.name === 'submit_candidate') {
      if (sceneHash(run.scene) !== run.sceneHash) throw new Error('Frozen scene hash mismatch');
      const canonical = await this.options.evaluateSource(
        candidate.source,
        structuredClone(run.scene.scenario),
        candidate.id,
      );
      const holdouts: Evaluation[] = [];
      for (const scenario of this.options.holdouts) {
        if (run.cancelRequested) throw new Error('Run cancelled during verification');
        holdouts.push(
          await this.options.evaluateSource(
            candidate.source,
            structuredClone(scenario),
            candidate.id,
          ),
        );
      }
      const accepted =
        canonical.report.status === 'passed' &&
        holdouts.length > 0 &&
        holdouts.every((result) => result.report.status === 'passed');
      run.evaluation = canonical;
      if (accepted) {
        run.acceptedId = candidate.id;
        run.candidate = {
          id: candidate.id,
          source: candidate.source,
          provenance: 'gemini-managed',
        };
      } else run.acceptedId = undefined;
      return {
        result: {
          ok: true,
          accepted,
          candidate_id: candidate.id,
          report: canonical.report,
          holdouts: {
            total: holdouts.length,
            passed: holdouts.filter((result) => result.report.status === 'passed').length,
          },
        },
      };
    }
    throw new Error('Tool not allowed');
  }
}
