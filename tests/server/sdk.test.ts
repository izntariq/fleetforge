import { describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'official-create', status: 'completed' })),
  get: vi.fn(async () => ({ id: 'official-get', status: 'completed' })),
  cancel: vi.fn(async () => ({ id: 'official-cancel', status: 'cancelled' })),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    interactions = sdk;
  },
}));
import { createManagedClient } from '../../server/app';
describe('official SDK boundary', () => {
  it('disables SDK create retries and uses documented positional get/cancel IDs', async () => {
    const client = createManagedClient('test-key-never-sent');
    const request = {
      agent: 'antigravity-preview-09-2026',
      background: true,
      store: true,
      input: 'test',
    };
    await client.interactions.create(request);
    await client.interactions.get('prior-id');
    await client.interactions.cancel('prior-id');
    expect(sdk.create).toHaveBeenCalledWith(request, { timeout: 30000, maxRetries: 0 });
    expect(sdk.get).toHaveBeenCalledWith('prior-id', undefined, { timeout: 30000, maxRetries: 0 });
    expect(sdk.cancel).toHaveBeenCalledWith('prior-id', undefined, {
      timeout: 30000,
      maxRetries: 0,
    });
  });
});
