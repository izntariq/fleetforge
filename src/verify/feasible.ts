import type { FeasibilityResult, Move, Scenario, WorldState } from '../core/types';
import { initialState, step } from '../core/engine';
const actions: Move[] = ['N', 'E', 'S', 'W', 'WAIT'];
/** Exhaustive joint-state BFS. The visited key saturates time after the last event. */
export function findFeasibleTrace(scenario: Scenario, maxStates = 100000): FeasibilityResult {
  if (!Number.isInteger(maxStates) || maxStates < 1)
    return { status: 'budget_exhausted', actions: [], explored: 0 };
  const ids = scenario.robots.map((r) => r.id),
    lastEvent = Math.max(0, ...scenario.events.map((e) => e.tick));
  const key = (s: WorldState) =>
    `${Math.min(s.tick, lastEvent)}|${ids.map((id) => `${s.positions[id].join(',')}:${+s.carrying[id]}:${+s.delivered[id]}`).join('|')}|${s.activeBlocks
      .map((c) => c.join(','))
      .sort()
      .join(';')}`;
  type Node = { state: WorldState; parent: number; moves: Record<string, Move> };
  const nodes: Node[] = [{ state: initialState(scenario), parent: -1, moves: {} }],
    seen = new Set([key(nodes[0].state)]);
  let head = 0;
  while (head < nodes.length) {
    if (head >= maxStates) return { status: 'budget_exhausted', actions: [], explored: head };
    const index = head++,
      node = nodes[index];
    if (ids.every((id) => node.state.delivered[id])) {
      const plan: Record<string, Move>[] = [];
      let cursor = index;
      while (nodes[cursor].parent !== -1) {
        plan.push(nodes[cursor].moves);
        cursor = nodes[cursor].parent;
      }
      return { status: 'feasible', actions: plan.reverse(), explored: head };
    }
    if (node.state.tick >= scenario.horizon) continue;
    for (const a of actions)
      for (const b of actions) {
        const moves = { [ids[0]]: a, [ids[1]]: b },
          next = step(scenario, node.state, moves);
        if (!next.valid) continue;
        const k = key(next.after);
        if (seen.has(k)) continue;
        seen.add(k);
        nodes.push({ state: next.after, parent: index, moves });
      }
  }
  return { status: 'infeasible', actions: [], explored: head };
}
