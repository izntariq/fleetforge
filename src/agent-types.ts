import type { Evaluation, SceneSpec } from './core/types';
export type RunStatus =
  'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'incomplete' | 'cancelled';
export type RunEvent = { at: string; message: string; kind: 'info' | 'tool' | 'success' | 'error' };
export type AgentRun = {
  id: string;
  status: RunStatus;
  phase: string;
  task: 'repair' | 'generate';
  scenarioId: string;
  events: RunEvent[];
  candidate?: { id: string; source: string; provenance: 'gemini-managed' };
  evaluation?: Evaluation;
  scene: SceneSpec;
  sceneHash: string;
  error?: string;
  interactionId?: string;
  environmentId?: string;
  createdAt: string;
  updatedAt: string;
};
