/**
 * Unit tests for health-service.ts
 *
 * These tests exercise the service function in isolation — no HTTP server,
 * no real Stellar RPC calls. External dependencies are vi.mock'd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runHealthCheck } from '../../src/services/health-service.js';

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------
vi.mock('../../src/services/stellar.js', () => ({
  checkStellarRpc: vi.fn(),
}));

vi.mock('../../src/services/bottleneck-limiters.js', () => ({
  getAllLimiterStats: vi.fn(() => ({
    lichess: { queued: 0, executing: 0 },
    chessdotcom: { queued: 2, executing: 1 },
  })),
}));

import { checkStellarRpc } from '../../src/services/stellar.js';
import { getAllLimiterStats } from '../../src/services/bottleneck-limiters.js';

const mockCheckRpc = vi.mocked(checkStellarRpc);
const mockGetLimiterStats = vi.mocked(getAllLimiterStats);

// ---------------------------------------------------------------------------
// runHealthCheck
// ---------------------------------------------------------------------------
describe('runHealthCheck', () => {
  const BASE_OPTIONS = {
    uptimeSeconds: 42,
    version: '1.2.3',
  };

  beforeEach(() => vi.clearAllMocks());

  it('returns ok:true with status, uptime, and version by default', async () => {
    const result = await runHealthCheck(BASE_OPTIONS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.status).toBe('ok');
      expect(result.payload.uptime).toBe(42);
      expect(result.payload.version).toBe('1.2.3');
      expect(result.payload.limiters).toBeUndefined();
    }
    // Stellar RPC should NOT be called unless deepCheck is true
    expect(mockCheckRpc).not.toHaveBeenCalled();
  });

  it('does not call checkStellarRpc when deepCheck is false', async () => {
    await runHealthCheck({ ...BASE_OPTIONS, deepCheck: false });
    expect(mockCheckRpc).not.toHaveBeenCalled();
  });

  it('calls checkStellarRpc when deepCheck is true', async () => {
    mockCheckRpc.mockResolvedValue(undefined);
    const result = await runHealthCheck({ ...BASE_OPTIONS, deepCheck: true });

    expect(mockCheckRpc).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when deepCheck is true and RPC check fails', async () => {
    mockCheckRpc.mockRejectedValue(new Error('connection refused'));

    const result = await runHealthCheck({ ...BASE_OPTIONS, deepCheck: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.payload.status).toBe('error');
      expect(result.payload.uptime).toBe(42);
      expect(result.payload.version).toBe('1.2.3');
      expect(result.payload.error).toContain('connection refused');
    }
  });

  it('returns ok:false with rpc unreachable message for non-Error throws', async () => {
    mockCheckRpc.mockRejectedValue('some string error');

    const result = await runHealthCheck({ ...BASE_OPTIONS, deepCheck: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.payload.error).toBe('rpc unreachable');
    }
  });

  it('includes limiter stats when includeLimiters is true', async () => {
    const result = await runHealthCheck({ ...BASE_OPTIONS, includeLimiters: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.limiters).toBeDefined();
      expect(mockGetLimiterStats).toHaveBeenCalledOnce();
    }
  });

  it('does not include limiter stats when includeLimiters is false', async () => {
    const result = await runHealthCheck({ ...BASE_OPTIONS, includeLimiters: false });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.limiters).toBeUndefined();
    }
    expect(mockGetLimiterStats).not.toHaveBeenCalled();
  });

  it('propagates the exact version string passed in', async () => {
    const result = await runHealthCheck({ uptimeSeconds: 0, version: 'unknown' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.version).toBe('unknown');
    }
  });

  it('can succeed on deepCheck and also include limiters', async () => {
    mockCheckRpc.mockResolvedValue(undefined);

    const result = await runHealthCheck({
      ...BASE_OPTIONS,
      deepCheck: true,
      includeLimiters: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.limiters).toBeDefined();
    }
    expect(mockCheckRpc).toHaveBeenCalledOnce();
    expect(mockGetLimiterStats).toHaveBeenCalledOnce();
  });
});
