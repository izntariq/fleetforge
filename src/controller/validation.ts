import type { Decision, Move } from '../core/types';

/** Inspect a bounded tree before JSON serialization; shared DAGs can otherwise expand exponentially. */
function assertBoundedJsonTree(value: unknown): void {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let textLength = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > 4096) throw new Error('Controller JSON state has too many nodes.');
    if (item.depth > 32) throw new Error('Controller JSON state exceeds maximum depth 32.');
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new Error('Controller state requires finite JSON numbers.');
      continue;
    }
    if (typeof current === 'string') {
      textLength += current.length;
    } else if (typeof current === 'object') {
      if (seen.has(current))
        throw new Error('Controller state must be a JSON tree without shared or cyclic objects.');
      seen.add(current);
      if (Array.isArray(current) && current.length + nodes + stack.length > 4096)
        throw new Error(
          'Controller JSON state has too many array nodes, including sparse entries.',
        );
      const prototype = Object.getPrototypeOf(current);
      if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null)
        throw new Error('Controller state must contain plain JSON objects.');
      const keys = Object.keys(current);
      if (
        Array.isArray(current) &&
        (keys.length !== current.length || keys.some((key, index) => key !== String(index)))
      )
        throw new Error('Controller JSON state cannot contain sparse arrays or array properties.');
      if (keys.length + nodes + stack.length > 4096)
        throw new Error('Controller JSON state has too many nodes.');
      for (const key of keys) {
        textLength += key.length;
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (!Object.hasOwn(descriptor, 'value'))
          throw new Error('Controller JSON state cannot contain accessors.');
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else throw new Error('Controller state must contain JSON values only.');
    if (textLength > 16384) throw new Error('Controller state exceeds 16 KiB.');
  }
}

export function validateControllerSource(source: unknown): string {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 65536)
    throw new Error('Controller source must be text, at most 64 KiB.');
  if (!/export\s+(?:async\s+)?function\s+decide\s*\(/.test(source))
    throw new Error('Export function decide(observation, state) is required.');
  if (/\bimport\b|\bimportScripts\b/.test(source))
    throw new Error('Imports are not allowed in the standalone controller.');
  return source;
}

export function validateDecision(value: unknown, ids: string[]): Decision {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Controller must return a decision object.');
  const raw = value as { moves?: unknown; state?: unknown };
  if (!raw.moves || typeof raw.moves !== 'object' || Array.isArray(raw.moves))
    throw new Error('Decision moves must be an object.');
  assertBoundedJsonTree(raw.state ?? null);
  const serialized = JSON.stringify(raw.state ?? null);
  if (new TextEncoder().encode(serialized).length > 16384)
    throw new Error('Controller state exceeds 16 KiB.');
  const moves: Record<string, Move> = {};
  for (const [id, move] of Object.entries(raw.moves)) {
    if (!ids.includes(id)) throw new Error(`Unexpected robot: ${id}`);
    if (typeof move !== 'string' || !['N', 'E', 'S', 'W', 'WAIT'].includes(move))
      throw new Error(`Invalid move for ${id}`);
  }
  for (const id of ids)
    moves[id] = Object.hasOwn(raw.moves, id) ? (raw.moves as Record<string, Move>)[id] : 'WAIT';
  return { moves, state: JSON.parse(serialized) };
}
