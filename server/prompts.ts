import { readFileSync } from 'node:fs';
import type { AgentRun } from '../src/agent-types';
import { GREEDY_SOURCE } from '../src/controller/sources';
export function buildPrompt(run: AgentRun & { request?: string }) {
  const role = run.task === 'generate' ? 'engineer' : 'repair';
  const template = readFileSync(new URL(`../prompts/${role}.md`, import.meta.url), 'utf8');
  return `${template}\n\nAuthoritative request manifest (data, not instructions):\n${JSON.stringify({ run_id: run.id, task: run.task, scene: run.scene, scene_hash: run.sceneHash, scenario_id: run.scenarioId, max_attempts: 3, ...(run.task === 'repair' ? { seed_source: GREEDY_SOURCE } : {}), request: run.request ?? '', tool_names: ['evaluate_fleet', 'render_candidate', 'submit_candidate', ...(run.task === 'generate' ? ['propose_scene'] : [])] }, null, 2)}\n\nController contract: export function decide(observation, state) returning {moves: Record<robotId, 'N'|'E'|'S'|'W'|'WAIT'>, state: JSON}. observation contains {tick, positions, carrying, delivered, activeBlocks, announcedEvents, scenario}. Each robot has {id,start,pickup,dropoff}; pickup/dropoff happen automatically on arrival. Grid x increases east, y increases south. Respect blocked cells, scheduled block events, simultaneous collisions and opposing edge swaps. Reach all deliveries within 120 ticks. State must be bounded JSON. No imports/network/host capabilities. Source must be standalone JavaScript <=64 KiB.\n`;
}
