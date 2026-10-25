import type { Cell, Move, Scenario, Transition, WorldState } from './types';
const offsets: Record<Move, Cell> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0], WAIT: [0, 0] };
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
function events(scenario: Scenario, state: WorldState): void {
  scenario.events.forEach((event, i) => {
    if (event.tick > state.tick) return;
    if (!state.announcedEvents.includes(i)) state.announcedEvents.push(i);
    if (
      !Object.values(state.positions).some((c) => same(c, event.cell)) &&
      !state.activeBlocks.some((c) => same(c, event.cell))
    )
      state.activeBlocks.push([...event.cell]);
  });
}
function orders(scenario: Scenario, state: WorldState): void {
  for (const robot of scenario.robots) {
    const id = robot.id;
    if (state.delivered[id]) continue;
    if (same(state.positions[id], robot.pickup)) state.carrying[id] = true;
    if (state.carrying[id] && same(state.positions[id], robot.dropoff)) {
      state.delivered[id] = true;
      state.carrying[id] = false;
    }
  }
}
export function initialState(scenario: Scenario): WorldState {
  const state: WorldState = {
    tick: 0,
    positions: {},
    carrying: {},
    delivered: {},
    activeBlocks: [],
    announcedEvents: [],
  };
  for (const robot of scenario.robots) {
    state.positions[robot.id] = [...robot.start];
    state.carrying[robot.id] = false;
    state.delivered[robot.id] = false;
  }
  orders(scenario, state);
  events(scenario, state);
  return state;
}
/** A rejected joint action advances the clock but moves neither robot. */
export function step(
  scenario: Scenario,
  state: WorldState,
  moves: Record<string, Move>,
): Transition {
  const before = structuredClone(state),
    after = structuredClone(state),
    errors: string[] = [];
  const normalized: Record<string, Move> = {};
  const destinations: Record<string, Cell> = {};
  const ids = scenario.robots.map((r) => r.id);
  if (!moves || typeof moves !== 'object' || Array.isArray(moves)) {
    errors.push('Moves must be an object');
    moves = {};
  }
  for (const id of Object.keys(moves))
    if (!ids.includes(id)) {
      errors.push(`Unknown robot ${id}`);
      normalized[id] = moves[id];
    }
  for (const id of ids) {
    const action = Object.hasOwn(moves, id) ? moves[id] : 'WAIT';
    normalized[id] = action;
    if (typeof action !== 'string' || !Object.hasOwn(offsets, action)) {
      errors.push(`${id}: invalid move`);
      destinations[id] = [...state.positions[id]];
      continue;
    }
    const delta = offsets[action],
      from = state.positions[id],
      to: Cell = [from[0] + delta[0], from[1] + delta[1]];
    destinations[id] = to;
    if (to[0] < 0 || to[1] < 0 || to[0] >= scenario.width || to[1] >= scenario.height)
      errors.push(`${id}: move leaves the world`);
    if ([...scenario.blocked, ...state.activeBlocks].some((c) => same(c, to)))
      errors.push(`${id}: destination is blocked`);
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i],
        b = ids[j];
      if (same(destinations[a], destinations[b])) errors.push(`${a}/${b}: shared destination`);
      if (same(destinations[a], state.positions[b]) && same(destinations[b], state.positions[a]))
        errors.push(`${a}/${b}: opposing edge swap`);
    }
  if (state.tick >= scenario.horizon) errors.push('Horizon exceeded');
  const valid = errors.length === 0;
  if (valid) after.positions = destinations;
  after.tick = Math.min(scenario.horizon, state.tick + 1);
  orders(scenario, after);
  events(scenario, after);
  return { before, after, moves: normalized, valid, errors };
}
