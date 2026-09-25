/**
 * Game polling worker for monitoring chess games until completion.
 *
 * This worker:
 * 1. Monitors active matches waiting for game results
 * 2. Polls the chess platform API at configurable intervals
 * 3. Re-enqueues in-progress games with backoff
 * 4. Submits completed games to the oracle contract
 * 5. Handles errors with exponential backoff (retry/DLQ logic)
 *
 * Configuration:
 * - POLLING_INTERVAL_MS: Base polling interval (default 30s)
 * - MAX_POLLING_ATTEMPTS: Max retry attempts before DLQ (default 1440 = 12 hours)
 * - POLLING_BACKOFF_MULTIPLIER: Backoff multiplier for retries (default 1.0 = no backoff)
 */

import logger from '../logger.js';
import type { MatchResult, GameResult } from '../fetchers/lichess.js';

export interface PollJob {
  id: string;
  matchId: number;
  gameId: string;
  platform: 'lichess' | 'chessdotcom';
  username?: string; // Required for Chess.com
  pollingAttempt: number;
  createdAt: number;
  lastPolledAt: number | null;
}

export interface PollJobStatus {
  status: 'pending' | 'completed' | 'failed' | 'in_progress';
  result?: MatchResult;
  reason?: string;
}

export interface GamePoller {
  poll: (job: PollJob) => Promise<PollJobStatus>;
}

export interface PollingConfig {
  /** Base polling interval in milliseconds. Defaults to 30 000. */
  pollingIntervalMs?: number;
  /** Maximum polling attempts before the job is moved to DLQ. Defaults to 1440 (~12 h at 30 s intervals). */
  maxPollingAttempts?: number;
  /** Backoff multiplier applied to the interval on each retry. Defaults to 1.0 (no backoff). */
  backoffMultiplier?: number;

  /**
   * Called when a game finishes and a result is available.
   * Use this to trigger oracle submission.
   *
   * @param job    - The polling job that completed
   * @param result - The game outcome reported by the chess platform
   */
  onGameCompleted: (job: PollJob, result: MatchResult) => Promise<void>;

  /**
   * Called when a polling job exceeds maxPollingAttempts.
   * Use this to write the job to a dead-letter queue and fire an alert.
   *
   * @param job    - The polling job that exhausted all attempts
   * @param reason - Optional failure reason from the last poll response
   */
  onMaxAttemptsExceeded: (job: PollJob, reason?: string) => Promise<void>;
}

/**
 * Calculate the delay for the next polling attempt using exponential backoff.
 *
 * Formula: baseInterval * (backoffMultiplier ^ attempt)
 * Examples:
 *   - No backoff (multiplier=1.0): always 30s
 *   - Linear backoff (multiplier=1.1): 30s, 33s, 36.3s, ...
 *   - Exponential backoff (multiplier=1.5): 30s, 45s, 67.5s, ...
 */
function calculateNextPollDelay(
  attempt: number,
  baseIntervalMs: number,
  backoffMultiplier: number,
): number {
  return Math.round(baseIntervalMs * Math.pow(backoffMultiplier, attempt));
}

/**
 * Polling job store — tracks active polling jobs.
 * Swap the backing store (Map → Redis/DB) for persistence across restarts.
 */
export class PollingJobStore {
  private jobs = new Map<string, PollJob>();
  private matchIdToJobId = new Map<number, string>();

  /**
   * Create a new polling job.
   *
   * @throws Error if a job already exists for this matchId
   */
  createJob(
    matchId: number,
    gameId: string,
    platform: 'lichess' | 'chessdotcom',
    username?: string,
  ): PollJob {
    if (this.matchIdToJobId.has(matchId)) {
      throw new Error(`Polling job already exists for match ${matchId}`);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: PollJob = {
      id,
      matchId,
      gameId,
      platform,
      username,
      pollingAttempt: 0,
      createdAt: Date.now(),
      lastPolledAt: null,
    };

    this.jobs.set(id, job);
    this.matchIdToJobId.set(matchId, id);

    logger.info(
      { match_id: matchId, game_id: gameId, platform },
      'polling_job_created',
    );

    return job;
  }

  /**
   * Get a polling job by ID.
   */
  getJob(jobId: string): PollJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get the polling job for a match ID.
   */
  getJobByMatchId(matchId: number): PollJob | null {
    const jobId = this.matchIdToJobId.get(matchId);
    return jobId ? this.jobs.get(jobId) ?? null : null;
  }

  /**
   * List all pending polling jobs.
   */
  listPendingJobs(): PollJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Increment the polling attempt counter.
   */
  incrementAttempt(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.pollingAttempt += 1;
      job.lastPolledAt = Date.now();
    }
  }

  /**
   * Complete and remove a polling job.
   */
  completeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      this.matchIdToJobId.delete(job.matchId);
      this.jobs.delete(jobId);
      logger.info(
        { match_id: job.matchId, polling_attempts: job.pollingAttempt },
        'polling_job_completed',
      );
    }
  }

  /**
   * Remove a polling job (e.g., when moved to DLQ).
   */
  removeJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      this.matchIdToJobId.delete(job.matchId);
      this.jobs.delete(jobId);
    }
  }

  /**
   * Clear all jobs (for testing).
   */
  clear(): void {
    this.jobs.clear();
    this.matchIdToJobId.clear();
  }
}

/**
 * Polling worker that periodically polls chess games and re-enqueues as needed.
 *
 * Usage:
 *   const store = new PollingJobStore();
 *   const worker = new PollingWorker(store, gamePoller, config);
 *   const cleanup = worker.start();
 *   // Later...
 *   cleanup();
 */
export class PollingWorker {
  private store: PollingJobStore;
  private poller: GamePoller;
  private config: Required<PollingConfig>;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    store: PollingJobStore,
    poller: GamePoller,
    config: PollingConfig,
  ) {
    this.store = store;
    this.poller = poller;
    this.config = {
      pollingIntervalMs: config.pollingIntervalMs ?? 30_000,
      maxPollingAttempts: config.maxPollingAttempts ?? 1440, // ~12 hours at 30s intervals
      backoffMultiplier: config.backoffMultiplier ?? 1.0, // No backoff by default
      onGameCompleted: config.onGameCompleted,
      onMaxAttemptsExceeded: config.onMaxAttemptsExceeded,
    };
  }

  /**
   * Start the polling worker.
   * Immediately polls all pending jobs, then sets up periodic polling.
   *
   * @returns A cleanup function that stops the worker
   */
  start(): () => void {
    logger.info(
      {
        interval_ms: this.config.pollingIntervalMs,
        max_attempts: this.config.maxPollingAttempts,
        backoff: this.config.backoffMultiplier,
      },
      'polling_worker_started',
    );

    // Trigger first poll immediately
    this.pollAllJobs();

    return () => this.stop();
  }

  /**
   * Stop the worker and clear all timers.
   */
  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    logger.info({}, 'polling_worker_stopped');
  }

  /**
   * Poll all pending jobs immediately.
   */
  private async pollAllJobs(): Promise<void> {
    const jobs = this.store.listPendingJobs();

    if (jobs.length === 0) {
      // Re-schedule the next polling cycle
      this.scheduleNextPoll();
      return;
    }

    logger.info(
      { count: jobs.length },
      'polling_worker_polling_all_jobs',
    );

    for (const job of jobs) {
      try {
        await this.pollJob(job);
      } catch (err) {
        logger.error(
          {
            match_id: job.matchId,
            game_id: job.gameId,
            attempt: job.pollingAttempt,
            error: err instanceof Error ? err.message : String(err),
          },
          'polling_job_error',
        );
      }
    }

    // Re-schedule the next polling cycle
    this.scheduleNextPoll();
  }

  /**
   * Poll a single job and handle the result.
   *
   * - If game is in progress: increment attempt, re-schedule this specific job
   * - If game is completed: call handler and remove job
   * - If error: increment attempt, check max attempts
   */
  private async pollJob(job: PollJob): Promise<void> {
    this.store.incrementAttempt(job.id);

    const status = await this.poller.poll(job);

    if (status.status === 'in_progress') {
      // Game still in progress — re-enqueue with backoff
      const nextDelay = calculateNextPollDelay(
        job.pollingAttempt,
        this.config.pollingIntervalMs,
        this.config.backoffMultiplier,
      );

      logger.info(
        {
          match_id: job.matchId,
          game_id: job.gameId,
          attempt: job.pollingAttempt,
          next_poll_ms: nextDelay,
        },
        'polling_job_game_in_progress_re_enqueuing',
      );

      // Schedule next poll for this specific job
      const timer = setTimeout(() => {
        this.pollJob(job).catch((err) => {
          logger.error(
            {
              match_id: job.matchId,
              game_id: job.gameId,
              error: err instanceof Error ? err.message : String(err),
            },
            'polling_job_requeue_failed',
          );
        });
      }, nextDelay);

      this.timers.set(job.id, timer);
    } else if (status.status === 'completed' && status.result) {
      // Game completed — remove from polling and invoke the completion handler
      logger.info(
        {
          match_id: job.matchId,
          game_id: job.gameId,
          result: status.result,
          polling_attempts: job.pollingAttempt,
        },
        'polling_job_game_completed',
      );

      this.store.completeJob(job.id);

      try {
        await this.config.onGameCompleted(job, status.result);
      } catch (callbackErr) {
        logger.error(
          {
            match_id: job.matchId,
            game_id: job.gameId,
            result: status.result,
            error:
              callbackErr instanceof Error
                ? callbackErr.message
                : String(callbackErr),
          },
          'polling_job_on_game_completed_callback_failed',
        );
      }
    } else if (status.status === 'failed') {
      // Polling failed — check if we should retry or move to DLQ
      if (job.pollingAttempt >= this.config.maxPollingAttempts) {
        logger.error(
          {
            match_id: job.matchId,
            game_id: job.gameId,
            attempt: job.pollingAttempt,
            max_attempts: this.config.maxPollingAttempts,
            reason: status.reason,
          },
          'polling_job_max_attempts_exceeded_moving_to_dlq',
        );

        this.store.removeJob(job.id);

        try {
          await this.config.onMaxAttemptsExceeded(job, status.reason);
        } catch (callbackErr) {
          logger.error(
            {
              match_id: job.matchId,
              game_id: job.gameId,
              error:
                callbackErr instanceof Error
                  ? callbackErr.message
                  : String(callbackErr),
            },
            'polling_job_on_max_attempts_callback_failed',
          );
        }
      } else {
        logger.warn(
          {
            match_id: job.matchId,
            game_id: job.gameId,
            attempt: job.pollingAttempt,
            max_attempts: this.config.maxPollingAttempts,
            reason: status.reason,
          },
          'polling_job_failed_will_retry',
        );

        // Will be retried in the next polling cycle
      }
    }
  }

  /**
   * Schedule the next full polling cycle.
   */
  private scheduleNextPoll(): void {
    const timer = setTimeout(() => {
      this.pollAllJobs().catch((err) => {
        logger.error(
          {
            error: err instanceof Error ? err.message : String(err),
          },
          'polling_worker_cycle_error',
        );
      });
    }, this.config.pollingIntervalMs);

    // Use a fixed key so we don't accumulate timers
    const oldTimer = this.timers.get('__cycle__');
    if (oldTimer) clearTimeout(oldTimer);
    this.timers.set('__cycle__', timer);
  }
}

export default {
  PollingJobStore,
  PollingWorker,
  calculateNextPollDelay,
};
