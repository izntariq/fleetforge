import { describe, expect, it } from 'vitest';
import { validateCandidateSource } from '../../server/source';
describe('managed controller transfer format', () => {
  it('accepts a standalone named decide export with helper functions', () => {
    expect(() =>
      validateCandidateSource(
        'const wait = () => "WAIT"; export function decide(o,s) { return {moves:{a:wait()},state:s}; }',
      ),
    ).not.toThrow();
  });
  it.each([
    'import x from "node:fs"; export function decide() {}',
    'export { x } from "node:fs"; export function decide() {}',
    'export function decide() { return import("node:fs"); }',
    'export function decide() { return require("node:fs"); }',
    'export default function decide() {}',
    'export const decide = () => ({moves:{}});',
    'export function decide() {',
    'export function decide(o: string) {}',
  ])('rejects unsupported JavaScript module source %s', (source) =>
    expect(() => validateCandidateSource(source)).toThrow(),
  );
  it('bounds UTF-8 bytes rather than character count', () =>
    expect(() =>
      validateCandidateSource('export function decide(){}\n/*' + '🦊'.repeat(20000) + '*/'),
    ).toThrow(/64 KiB/));
});
