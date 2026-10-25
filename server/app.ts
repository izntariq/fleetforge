import express from 'express';
import { GoogleGenAI, type Interactions, type GoogleGenAIRequestOptions } from '@google/genai';
import { SCENARIOS, HOLDOUT_SCENARIOS } from '../src/core/fixtures';
import type { SceneSpec } from '../src/core/types';
import { SANDBOX_HTML } from '../src/controller/sandbox';
import { evaluateSource, renderEvaluation } from './evaluator';
import {
  AGENT,
  MODEL,
  ManagedRunner,
  type ManagedClient,
  type RunnerOptions,
  type Interaction,
} from './managed';

export type AppOptions = Partial<RunnerOptions> & { apiKey?: string };
/** This is the sole SDK boundary; types are checked against the installed official SDK. */
export function createManagedClient(apiKey: string): ManagedClient {
  const sdk = new GoogleGenAI({ apiKey });
  const sdkOptions = { timeout: 30_000, maxRetries: 0 } satisfies GoogleGenAIRequestOptions;
  return {
    interactions: {
      create: async (request) =>
        (await sdk.interactions.create(
          request as Interactions.InteractionCreateParams.CreateAgentInteractionParamsNonStreaming,
          sdkOptions,
        )) as Interaction,
      get: async (id) => (await sdk.interactions.get(id, undefined, sdkOptions)) as Interaction,
      cancel: async (id) =>
        (await sdk.interactions.cancel(id, undefined, sdkOptions)) as Interaction,
    },
  };
}
export function createApp(options: AppOptions = {}) {
  const app = express();
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const configured = !!options.client || !!apiKey?.trim();
  const scenes =
    options.scenes ??
    SCENARIOS.map(
      (scenario) =>
        ({
          schemaVersion: 1,
          scenario,
          style: { palette: 'cloud-workshop', tileScale: 1 },
          decorations: [],
        }) as SceneSpec,
    );
  const unavailable = async (): Promise<Interaction> => {
    throw new Error('GEMINI_API_KEY is not configured');
  };
  const offlineClient: ManagedClient = {
    interactions: { create: unavailable, get: unavailable, cancel: unavailable },
  };
  const runner = new ManagedRunner({
    ...options,
    client: options.client ?? (configured ? createManagedClient(apiKey!) : offlineClient),
    scenes,
    holdouts: options.holdouts ?? HOLDOUT_SCENARIOS,
    evaluateSource: options.evaluateSource ?? evaluateSource,
    renderEvaluation: options.renderEvaluation ?? renderEvaluation,
  });
  app.locals.runner = runner;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '96kb' }));
  app.get('/api/status', (_request, response) =>
    response.json({ configured, model: MODEL, agent: AGENT }),
  );
  app.get('/sandbox.html', (_request, response) => {
    response.set(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; style-src 'unsafe-inline'",
    );
    response.type('html').send(SANDBOX_HTML);
  });
  app.post('/api/runs', async (request, response) => {
    if (!configured) {
      response
        .status(503)
        .json({
          error: 'Gemini Managed Agents is not configured. Set GEMINI_API_KEY on the server.',
        });
      return;
    }
    const body = request.body as Record<string, unknown> | undefined;
    if (
      !body ||
      typeof body.scenarioId !== 'string' ||
      !['repair', 'generate'].includes(String(body.task)) ||
      Object.keys(body).some((key) => !['scenarioId', 'task', 'request'].includes(key)) ||
      (body.request !== undefined && typeof body.request !== 'string')
    ) {
      response
        .status(400)
        .json({ error: 'Expected {scenarioId, task: repair|generate, request?: string}' });
      return;
    }
    try {
      const run = await runner.start({
        scenarioId: body.scenarioId,
        task: body.task as 'repair' | 'generate',
        request: body.request as string | undefined,
      });
      response.status(202).json(run);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get('/api/runs/:id', async (request, response) => {
    const run = await runner?.get(request.params.id);
    if (!run) {
      response.status(404).json({ error: 'Run not found' });
      return;
    }
    response.json(run);
  });
  app.post('/api/runs/:id/cancel', async (request, response) => {
    const run = await runner?.cancel(request.params.id);
    if (!run) {
      response.status(404).json({ error: 'Run not found' });
      return;
    }
    response.json(run);
  });
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response
        .status(error instanceof SyntaxError ? 400 : 500)
        .json({
          error: error instanceof SyntaxError ? 'Invalid JSON request' : 'Server request failed',
        });
    },
  );
  return app;
}
