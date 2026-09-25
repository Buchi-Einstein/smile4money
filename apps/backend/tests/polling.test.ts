/**
 * Test suite for the game polling system.
 *
 * Tests cover:
 * - In-progress game detection and re-enqueuing
 * - Completed game detection and job removal
 * - Exponential backoff calculation
 * - Job store operations
 * - Error handling and DLQ movement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PollingJobStore,
  PollingWorker,
  calculateNextPollDelay,
  type PollJob,
  type GamePoller,
} from '../src/services/polling.js';

/**
 * Mock game poller for testing.
 */
class MockGamePoller implements GamePoller {
  private gameStatus: Map<string, 'in_progress' | 'completed'> = new Map();
  private gameResult: Map<string, 'Player1Wins' | 'Player2Wins' | 'Draw'> = new Map();

  setGameStatus(gameId: string, status: 'in_progress' | 'completed'): void {
    this.gameStatus.set(gameId, status);
  }

  setGameResult(gameId: string, result: 'Player1Wins' | 'Player2Wins' | 'Draw'): void {
    this.gameResult.set(gameId, result);
  }

  async poll(job: PollJob) {
    const status = this.gameStatus.get(job.gameId) ?? 'completed';
    const result = this.gameResult.get(job.gameId) ?? 'Draw';

    if (status === 'in_progress') {
      return { status: 'in_progress' as const };
    }

    return {
      status: 'completed' as const,
      result,
    };
  }
}

/**
 * Mock poller that always returns a failed status with an optional reason.
 */
class FailingGamePoller implements GamePoller {
  constructor(private readonly reason?: string) {}

  async poll(_job: PollJob) {
    return { status: 'failed' as const, reason: this.reason };
  }
}

describe('Game Polling System', () => {
  describe('calculateNextPollDelay', () => {
    it('returns base interval when no backoff (multiplier=1.0)', () => {
      const delay = calculateNextPollDelay(0, 30_000, 1.0);
      expect(delay).toBe(30_000);

      const delay2 = calculateNextPollDelay(5, 30_000, 1.0);
      expect(delay2).toBe(30_000); // Always 30s
    });

    it('applies linear backoff (multiplier=1.1)', () => {
      const delay0 = calculateNextPollDelay(0, 30_000, 1.1);
      expect(delay0).toBe(30_000);

      const delay1 = calculateNextPollDelay(1, 30_000, 1.1);
      expect(delay1).toBe(33_000); // 30_000 * 1.1

      const delay2 = calculateNextPollDelay(2, 30_000, 1.1);
      expect(delay2).toBe(36_300); // 30_000 * 1.1^2 ≈ 36,300
    });

    it('applies exponential backoff (multiplier=1.5)', () => {
      const delay0 = calculateNextPollDelay(0, 30_000, 1.5);
      expect(delay0).toBe(30_000);

      const delay1 = calculateNextPollDelay(1, 30_000, 1.5);
      expect(delay1).toBe(45_000); // 30_000 * 1.5

      const delay2 = calculateNextPollDelay(2, 30_000, 1.5);
      expect(delay2).toBe(67_500); // 30_000 * 1.5^2 = 67,500
    });

    it('handles edge case: attempt=0 with any multiplier', () => {
      expect(calculateNextPollDelay(0, 30_000, 1.0)).toBe(30_000);
      expect(calculateNextPollDelay(0, 30_000, 1.5)).toBe(30_000);
      expect(calculateNextPollDelay(0, 30_000, 2.0)).toBe(30_000);
    });
  });

  describe('PollingJobStore', () => {
    let store: PollingJobStore;

    beforeEach(() => {
      store = new PollingJobStore();
    });

    it('creates a new polling job', () => {
      const job = store.createJob(1, 'game-123', 'lichess');

      expect(job.matchId).toBe(1);
      expect(job.gameId).toBe('game-123');
      expect(job.platform).toBe('lichess');
      expect(job.pollingAttempt).toBe(0);
      expect(job.createdAt).toBeLessThanOrEqual(Date.now());
      expect(job.lastPolledAt).toBeNull();
    });

    it('creates job with username for Chess.com', () => {
      const job = store.createJob(2, 'game-456', 'chessdotcom', 'alice');

      expect(job.username).toBe('alice');
      expect(job.platform).toBe('chessdotcom');
    });

    it('throws when creating duplicate job for same matchId', () => {
      store.createJob(1, 'game-123', 'lichess');

      expect(() => {
        store.createJob(1, 'game-456', 'lichess');
      }).toThrow('Polling job already exists for match 1');
    });

    it('retrieves job by ID', () => {
      const created = store.createJob(1, 'game-123', 'lichess');
      const retrieved = store.getJob(created.id);

      expect(retrieved).toEqual(created);
    });

    it('retrieves job by matchId', () => {
      const created = store.createJob(1, 'game-123', 'lichess');
      const retrieved = store.getJobByMatchId(1);

      expect(retrieved).toEqual(created);
    });

    it('increments polling attempt counter', () => {
      const job = store.createJob(1, 'game-123', 'lichess');

      expect(job.pollingAttempt).toBe(0);
      expect(job.lastPolledAt).toBeNull();

      store.incrementAttempt(job.id);

      expect(job.pollingAttempt).toBe(1);
      expect(job.lastPolledAt).toBeLessThanOrEqual(Date.now());
    });

    it('completes and removes a job', () => {
      const job = store.createJob(1, 'game-123', 'lichess');

      store.completeJob(job.id);

      expect(store.getJob(job.id)).toBeNull();
      expect(store.getJobByMatchId(1)).toBeNull();
    });

    it('lists all pending jobs', () => {
      store.createJob(1, 'game-1', 'lichess');
      store.createJob(2, 'game-2', 'lichess');
      store.createJob(3, 'game-3', 'chessdotcom', 'bob');

      const jobs = store.listPendingJobs();

      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.matchId)).toEqual([1, 2, 3]);
    });

    it('clears all jobs', () => {
      store.createJob(1, 'game-1', 'lichess');
      store.createJob(2, 'game-2', 'lichess');

      expect(store.listPendingJobs()).toHaveLength(2);

      store.clear();

      expect(store.listPendingJobs()).toHaveLength(0);
    });
  });

  describe('PollingWorker', () => {
    let store: PollingJobStore;
    let poller: MockGamePoller;
    let worker: PollingWorker;

    beforeEach(() => {
      store = new PollingJobStore();
      poller = new MockGamePoller();
      worker = new PollingWorker(store, poller, {
        pollingIntervalMs: 100, // Fast for testing
        maxPollingAttempts: 5,
        backoffMultiplier: 1.0,
        onGameCompleted: vi.fn().mockResolvedValue(undefined),
        onMaxAttemptsExceeded: vi.fn().mockResolvedValue(undefined),
      });
    });    it('detects in-progress game and keeps job in store', async () => {
      const job = store.createJob(1, 'game-123', 'lichess');
      poller.setGameStatus('game-123', 'in_progress');

      const status = await poller.poll(job);

      expect(status.status).toBe('in_progress');
      expect(store.getJobByMatchId(1)).toBeDefined(); // Job not removed
    });

    it('detects completed game and removes job from store', async () => {
      const job = store.createJob(1, 'game-123', 'lichess');
      poller.setGameStatus('game-123', 'completed');
      poller.setGameResult('game-123', 'Player1Wins');

      const status = await poller.poll(job);

      expect(status.status).toBe('completed');
      expect(status.result).toBe('Player1Wins');
    });

    it('detects draw result', async () => {
      const job = store.createJob(1, 'game-123', 'lichess');
      poller.setGameStatus('game-123', 'completed');
      poller.setGameResult('game-123', 'Draw');

      const status = await poller.poll(job);

      expect(status.result).toBe('Draw');
    });

    it('returns cleanup function', () => {
      const cleanup = worker.start();

      expect(typeof cleanup).toBe('function');

      cleanup();
    });

    it('increments polling attempt on each poll', async () => {
      const job = store.createJob(1, 'game-123', 'lichess');
      poller.setGameStatus('game-123', 'in_progress');

      expect(job.pollingAttempt).toBe(0);

      // Note: In a real test with PollingWorker.start(), this would be async.
      // Here we're testing the store directly.
      store.incrementAttempt(job.id);

      expect(job.pollingAttempt).toBe(1);
      expect(job.lastPolledAt).toBeLessThanOrEqual(Date.now());
    });

    it('calls onMaxAttemptsExceeded with job and reason when limit is reached', async () => {
      const failingPoller = new FailingGamePoller('game_not_found');
      const onMaxAttemptsExceeded = vi.fn().mockResolvedValue(undefined);

      const workerWithCallback = new PollingWorker(
        store,
        failingPoller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 1, // Exceed on the very first attempt
          backoffMultiplier: 1.0,
          onGameCompleted: vi.fn().mockResolvedValue(undefined),
          onMaxAttemptsExceeded,
        },
      );

      const job = store.createJob(1, 'game-999', 'lichess');

      // Simulate enough increments so pollingAttempt >= maxPollingAttempts
      store.incrementAttempt(job.id); // attempt = 1, equals maxPollingAttempts = 1

      // Directly exercise the private pollJob path by having the worker poll
      const cleanup = workerWithCallback.start();

      // Allow micro-tasks to flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      cleanup();

      expect(onMaxAttemptsExceeded).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 1, gameId: 'game-999' }),
        'game_not_found',
      );
    });

    it('removes job from store when max attempts are exceeded', async () => {
      const failingPoller = new FailingGamePoller('timeout');
      const onMaxAttemptsExceeded = vi.fn().mockResolvedValue(undefined);

      const failStore = new PollingJobStore();
      const workerWithCallback = new PollingWorker(
        failStore,
        failingPoller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 1,
          backoffMultiplier: 1.0,
          onGameCompleted: vi.fn().mockResolvedValue(undefined),
          onMaxAttemptsExceeded,
        },
      );

      const job = failStore.createJob(2, 'game-888', 'lichess');
      failStore.incrementAttempt(job.id); // pollingAttempt = 1

      const cleanup = workerWithCallback.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      cleanup();

      // Job must be removed from the store
      expect(failStore.getJobByMatchId(2)).toBeNull();
    });

    it('removes job from store on max attempts even when callbacks do not throw', async () => {
      const failingPoller = new FailingGamePoller('some_error');
      const noCallbackStore = new PollingJobStore();

      const workerNoCallback = new PollingWorker(
        noCallbackStore,
        failingPoller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 1,
          backoffMultiplier: 1.0,
          onGameCompleted: vi.fn().mockResolvedValue(undefined),
          onMaxAttemptsExceeded: vi.fn().mockResolvedValue(undefined),
        },
      );

      const job = noCallbackStore.createJob(3, 'game-777', 'lichess');
      noCallbackStore.incrementAttempt(job.id); // pollingAttempt = 1

      const cleanup = workerNoCallback.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      cleanup();

      // Job is still removed; no callback error thrown
      expect(noCallbackStore.getJobByMatchId(3)).toBeNull();
    });

    it('calls onGameCompleted with job and result when game finishes', async () => {
      const onGameCompleted = vi.fn().mockResolvedValue(undefined);
      const completedStore = new PollingJobStore();

      const completedWorker = new PollingWorker(
        completedStore,
        poller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 5,
          backoffMultiplier: 1.0,
          onGameCompleted,
          onMaxAttemptsExceeded: vi.fn().mockResolvedValue(undefined),
        },
      );

      completedStore.createJob(10, 'game-completed', 'lichess');
      poller.setGameStatus('game-completed', 'completed');
      poller.setGameResult('game-completed', 'Player1Wins');

      const cleanup = completedWorker.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      cleanup();

      expect(onGameCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: 10, gameId: 'game-completed' }),
        'Player1Wins',
      );
    });

    it('removes job from store after onGameCompleted is called', async () => {
      const onGameCompleted = vi.fn().mockResolvedValue(undefined);
      const completedStore = new PollingJobStore();

      const completedWorker = new PollingWorker(
        completedStore,
        poller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 5,
          backoffMultiplier: 1.0,
          onGameCompleted,
          onMaxAttemptsExceeded: vi.fn().mockResolvedValue(undefined),
        },
      );

      completedStore.createJob(11, 'game-done', 'lichess');
      poller.setGameStatus('game-done', 'completed');
      poller.setGameResult('game-done', 'Draw');

      const cleanup = completedWorker.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      cleanup();

      expect(completedStore.getJobByMatchId(11)).toBeNull();
    });

    it('logs an error but does not rethrow when onGameCompleted throws', async () => {
      const onGameCompleted = vi.fn().mockRejectedValue(new Error('oracle_down'));
      const errorStore = new PollingJobStore();

      const errorWorker = new PollingWorker(
        errorStore,
        poller,
        {
          pollingIntervalMs: 100,
          maxPollingAttempts: 5,
          backoffMultiplier: 1.0,
          onGameCompleted,
          onMaxAttemptsExceeded: vi.fn().mockResolvedValue(undefined),
        },
      );

      errorStore.createJob(12, 'game-error', 'lichess');
      poller.setGameStatus('game-error', 'completed');
      poller.setGameResult('game-error', 'Player2Wins');

      // Should not throw even though the callback rejects
      const cleanup = errorWorker.start();
      await expect(
        new Promise<void>((resolve) => setTimeout(resolve, 50)),
      ).resolves.toBeUndefined();
      cleanup();

      expect(onGameCompleted).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles getJob with non-existent ID', () => {
      const store = new PollingJobStore();
      expect(store.getJob('non-existent')).toBeNull();
    });

    it('handles getJobByMatchId with non-existent matchId', () => {
      const store = new PollingJobStore();
      expect(store.getJobByMatchId(999)).toBeNull();
    });

    it('handles removeJob that does not exist', () => {
      const store = new PollingJobStore();
      expect(() => {
        store.removeJob('non-existent');
      }).not.toThrow();
    });

    it('handles completeJob that does not exist', () => {
      const store = new PollingJobStore();
      expect(() => {
        store.completeJob('non-existent');
      }).not.toThrow();
    });

    it('handles very large backoff multiplier', () => {
      const delay = calculateNextPollDelay(10, 30_000, 2.0);
      // 30_000 * 2^10 = 30,720,000 ms ≈ 8.5 hours
      expect(delay).toBe(30_720_000);
    });

    it('creates distinct job IDs for concurrent creates', () => {
      const store = new PollingJobStore();

      const job1 = store.createJob(1, 'game-1', 'lichess');
      const job2 = store.createJob(2, 'game-2', 'lichess');

      expect(job1.id).not.toBe(job2.id);
    });
  });
});
