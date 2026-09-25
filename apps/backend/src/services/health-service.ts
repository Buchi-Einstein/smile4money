/**
 * Health Service
 *
 * Contains the business logic for the health-check endpoint. The route
 * handler in routes/health.ts delegates here so the logic can be tested
 * independently of HTTP concerns.
 */

import { checkStellarRpc } from './stellar.js';
import { getAllLimiterStats } from './bottleneck-limiters.js';

export interface HealthCheckOptions {
  /** When true, performs a live connectivity check against the Stellar RPC. */
  deepCheck?: boolean;
  /** When true, appends rate-limiter statistics to the response payload. */
  includeLimiters?: boolean;
  /** Uptime in seconds (passed in from the route so the timer origin is preserved). */
  uptimeSeconds: number;
  /** Application version string. */
  version: string;
}

export interface HealthOk {
  ok: true;
  payload: {
    status: 'ok';
    uptime: number;
    version: string;
    limiters?: ReturnType<typeof getAllLimiterStats>;
  };
}

export interface HealthError {
  ok: false;
  payload: {
    status: 'error';
    uptime: number;
    version: string;
    error: string;
  };
}

export type HealthCheckResult = HealthOk | HealthError;

/**
 * Execute the health-check logic.
 *
 * When `deepCheck` is true, makes a live call to the Stellar RPC. If the
 * call fails the returned result has `ok: false` and the route handler should
 * respond with HTTP 503.
 *
 * When `includeLimiters` is true the response payload includes Bottleneck
 * limiter statistics (queued / executing counts).
 */
export async function runHealthCheck(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const { deepCheck, includeLimiters, uptimeSeconds, version } = options;

  if (deepCheck) {
    try {
      await checkStellarRpc();
    } catch (error) {
      return {
        ok: false,
        payload: {
          status: 'error',
          uptime: uptimeSeconds,
          version,
          error: error instanceof Error ? error.message : 'rpc unreachable',
        },
      };
    }
  }

  const payload: HealthOk['payload'] = {
    status: 'ok',
    uptime: uptimeSeconds,
    version,
  };

  if (includeLimiters) {
    payload.limiters = getAllLimiterStats();
  }

  return { ok: true, payload };
}
