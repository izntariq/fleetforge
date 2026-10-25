import type { Cell, Robot, Scenario, SceneSpec } from './types';
import { DEFAULT_SCENE } from './fixtures';
type Obj = Record<string, unknown>;
function object(value: unknown, keys: string[], where: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${where} must be an object`);
  const obj = value as Obj;
  for (const key of Object.keys(obj))
    if (!keys.includes(key)) throw new Error(`${where}: unsupported field ${key}`);
  return obj;
}
function text(value: unknown, where: string, max = 80, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw new Error(`${where} must be a bounded string`);
  return value;
}
function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  return value;
}
function cell(value: unknown, where: string): Cell {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => Number.isInteger(n) && n >= 0 && n < 8)
  )
    throw new Error(`${where} must be an integer cell inside the 8×8 world`);
  return [value[0] as number, value[1] as number];
}
const key = (c: Cell) => c.join(',');
export function parseScenario(value: unknown): Scenario {
  const s = object(
    value,
    [
      'schemaVersion',
      'id',
      'name',
      'description',
      'width',
      'height',
      'blocked',
      'robots',
      'events',
      'horizon',
    ],
    'scenario',
  );
  if (s.schemaVersion !== 1 || s.width !== 8 || s.height !== 8 || s.horizon !== 120)
    throw new Error('Scenario requires schemaVersion 1, 8×8 dimensions and horizon 120');
  const id = text(s.id, 'scenario.id', 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('scenario.id must be a simple identifier');
  const blocked = list(s.blocked, 'blocked').map((v, i) => cell(v, `blocked[${i}]`));
  const walls = new Set(blocked.map(key));
  if (walls.size !== blocked.length) throw new Error('Duplicate blocked cells');
  if (64 - walls.size > 24) throw new Error('Scenario permits at most 24 free cells');
  const robots: Robot[] = list(s.robots, 'robots').map((value, i) => {
    const r = object(value, ['id', 'start', 'pickup', 'dropoff', 'color'], `robot[${i}]`);
    const robotId = text(r.id, 'robot.id', 32);
    if (
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(robotId) ||
      ['__proto__', 'constructor', 'prototype'].includes(robotId)
    )
      throw new Error('Unsafe robot id');
    const robot: Robot = {
      id: robotId,
      start: cell(r.start, 'start'),
      pickup: cell(r.pickup, 'pickup'),
      dropoff: cell(r.dropoff, 'dropoff'),
    };
    for (const c of [robot.start, robot.pickup, robot.dropoff])
      if (walls.has(key(c))) throw new Error('Robot start, pickup and dropoff must be traversable');
    if (r.color !== undefined) {
      if (typeof r.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.color))
        throw new Error('Robot color must be a hex color');
      robot.color = r.color;
    }
    return robot;
  });
  if (robots.length !== 2) throw new Error('Exactly two robots are supported');
  if (new Set(robots.map((r) => r.id)).size !== 2) throw new Error('Duplicate robot ids');
  if (key(robots[0].start) === key(robots[1].start)) throw new Error('Duplicate robot starts');
  const events = list(s.events, 'events').map((value, i) => {
    const e = object(value, ['tick', 'type', 'cell'], `event[${i}]`);
    if (
      e.type !== 'block' ||
      !Number.isInteger(e.tick) ||
      (e.tick as number) < 0 ||
      (e.tick as number) > 120
    )
      throw new Error('Block event tick must be an integer from 0 to 120');
    const c = cell(e.cell, 'event.cell');
    if (walls.has(key(c))) throw new Error('Block events must address initially traversable cells');
    return { tick: e.tick as number, type: 'block' as const, cell: c };
  });
  if (events.length > 8) throw new Error('At most eight block events are supported');
  if (new Set(events.map((e) => key(e.cell))).size !== events.length)
    throw new Error('Duplicate event cells');
  return {
    schemaVersion: 1,
    id,
    name: text(s.name, 'scenario.name'),
    description: text(s.description, 'description', 500, true),
    width: 8,
    height: 8,
    blocked,
    robots,
    events,
    horizon: 120,
  };
}
export function parseScene(value: unknown): SceneSpec {
  const s = object(value, ['schemaVersion', 'scenario', 'style', 'decorations'], 'scene');
  if (s.schemaVersion !== 1) throw new Error('Scene requires schemaVersion 1');
  const scenario = parseScenario(s.scenario);
  const style = object(s.style, ['palette', 'tileScale'], 'style');
  if (!['cloud-workshop', 'industrial'].includes(style.palette as string) || style.tileScale !== 1)
    throw new Error('Unsupported scene style');
  const walls = new Set(scenario.blocked.map(key));
  const decorations: SceneSpec['decorations'] = list(s.decorations, 'decorations').map(
    (value, i) => {
      const d = object(value, ['id', 'kind', 'cell', 'height'], `decoration[${i}]`);
      const c = cell(d.cell, 'decoration.cell');
      if (!walls.has(key(c))) throw new Error('Decorations must be on blocked cells');
      if (
        !['crate', 'cloud', 'feather'].includes(d.kind as string) ||
        ![0.25, 0.5].includes(d.height as number)
      )
        throw new Error('Unsupported decoration');
      return {
        id: text(d.id, 'decoration.id', 64),
        kind: d.kind as 'crate' | 'cloud' | 'feather',
        cell: c,
        height: d.height as 0.25 | 0.5,
      };
    },
  );
  if (decorations.length > 24 || new Set(decorations.map((d) => d.id)).size !== decorations.length)
    throw new Error('At most 24 decorations with unique ids are supported');
  return {
    schemaVersion: 1,
    scenario,
    style: { palette: style.palette as SceneSpec['style']['palette'], tileScale: 1 },
    decorations,
  };
}
export function createDefaultScene(): SceneSpec {
  return structuredClone(DEFAULT_SCENE);
}
