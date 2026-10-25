import { describe, expect, it } from 'vitest';
import { validateControllerSource, validateDecision } from '../../src/controller/validation';

describe('untrusted controller boundary', () => {
  it('allows a standalone JavaScript controller and rejects imported capabilities', () => {
    const source = 'export function decide(observation, state) { return {moves:{},state:null}; }';
    expect(validateControllerSource(source)).toBe(source);
    expect(() => validateControllerSource('import fs from "node:fs"; ' + source)).toThrow(
      /import/i,
    );
    expect(() =>
      validateControllerSource(source + '\nimport("https://example.com/code.js")'),
    ).toThrow(/import/i);
    expect(() => validateControllerSource(source + 'x'.repeat(65537))).toThrow(/64/i);
  });
  it('rejects invalid moves, unexpected robot IDs and oversized mutable state', () => {
    expect(validateDecision({ moves: { A: 'N' }, state: null }, ['A', 'B'])).toEqual({
      moves: { A: 'N', B: 'WAIT' },
      state: null,
    });
    expect(() => validateDecision({ moves: { A: 'FLY' }, state: null }, ['A'])).toThrow();
    expect(() => validateDecision({ moves: { C: 'N' }, state: null }, ['A'])).toThrow();
    expect(() => validateDecision({ moves: { A: 'N' }, state: 'x'.repeat(16385) }, ['A'])).toThrow(
      /16/i,
    );
  });
  it('rejects shared-reference state before its JSON expansion can stall the host', () => {
    const leaf = { value: 'same node' };
    expect(() =>
      validateDecision({ moves: { A: 'WAIT' }, state: { left: leaf, right: leaf } }, ['A']),
    ).toThrow(/tree|shared|repeated/i);
  });
  it('rejects excessive depth and non-JSON numeric values', () => {
    let deep: unknown = null;
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(() => validateDecision({ moves: { A: 'WAIT' }, state: deep }, ['A'])).toThrow(
      /depth|deep/i,
    );
    expect(() =>
      validateDecision({ moves: { A: 'WAIT' }, state: { score: Infinity } }, ['A']),
    ).toThrow(/finite|JSON/i);
  });
  it('rejects moves that merely coerce to a valid string', () => {
    expect(() => validateDecision({ moves: { A: ['E'] }, state: null }, ['A'])).toThrow(
      /Invalid move/,
    );
  });
  it('defaults omitted prototype-named robot actions to WAIT', () => {
    expect(validateDecision({ moves: {}, state: null }, ['toString'])).toEqual({
      moves: { toString: 'WAIT' },
      state: null,
    });
  });
  it('counts sparse array length before serialization can expand holes', () => {
    expect(() => validateDecision({ moves: { A: 'WAIT' }, state: new Array(4097) }, ['A'])).toThrow(
      /nodes|sparse/i,
    );
  });
  it('rejects nested sparse arrays rather than undercounting their holes', () => {
    expect(() =>
      validateDecision({ moves: { A: 'WAIT' }, state: [new Array(10), new Array(10)] }, ['A']),
    ).toThrow(/sparse/i);
  });
});
