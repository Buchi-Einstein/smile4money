/**
 * Unit tests for oracle-service.ts
 *
 * These tests exercise the service functions in isolation — no HTTP server,
 * no real chess-platform API calls. External dependencies are vi.mock'd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSubmitResultInput,
  verifyGameResult,
} from '../../src/services/oracle-service.js';
import { MatchStore } from '../../src/store/match-store.js';

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------
vi.mock('../../src/fetchers/lichess.js', () => ({
  fetchLichessResult: vi.fn(),
  GameNotFoundError: class GameNotFoundError extends Error {
    constructor(gameId: string) {
      super(`Lichess game not found: ${gameId}`);
      this.name = 'GameNotFoundError';
    }
  },
}));

vi.mock('../../src/fetchers/chessdotcom.js', () => ({
  fetchChessDotComResult: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock('../../src/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { fetchLichessResult, GameNotFoundError } from '../../src/fetchers/lichess.js';
import { fetchChessDotComResult } from '../../src/fetchers/chessdotcom.js';

const mockFetchLichess = vi.mocked(fetchLichessResult);
const mockFetchChess = vi.mocked(fetchChessDotComResult);

const LICHESS_GAME = {
  gameId: 'lichess-game-abc',
  status: 'mate',
  whitePlayer: 'alice',
  blackPlayer: 'bob',
  result: 'Player1Wins' as const,
};

const P1 = 'GPLAYER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const P2 = 'GPLAYER2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

async function seedMatch(store: MatchStore, overrides: Partial<{
  gameId: string; player1Username: string; player2Username: string; platform: string;
}> = {}) {
  return store.createMatch({
    player1: P1,
    player2: P2,
    player1Username: overrides.player1Username ?? 'alice',
    player2Username: overrides.player2Username ?? 'bob',
    stakeAmount: 100,
    token: 'XLM',
    gameId: overrides.gameId ?? 'lichess-game-abc',
    platform: overrides.platform ?? 'lichess',
  });
}

// ---------------------------------------------------------------------------
// validateSubmitResultInput
// ---------------------------------------------------------------------------
describe('validateSubmitResultInput', () => {
  it('returns null for valid lichess input', () => {
    expect(validateSubmitResultInput({ matchId: 1, gameId: 'g', platform: 'lichess' })).toBeNull();
  });

  it('returns null for valid chessdotcom input with username', () => {
    expect(validateSubmitResultInput({
      matchId: 1, gameId: 'g', platform: 'chessdotcom', username: 'alice',
    })).toBeNull();
  });

  it('returns error when matchId is not a number', () => {
    expect(validateSubmitResultInput({ matchId: 'bad' as any, gameId: 'g', platform: 'lichess' }))
      .toBe('matchId must be a number');
  });

  it('returns error when matchId is NaN', () => {
    expect(validateSubmitResultInput({ matchId: NaN, gameId: 'g', platform: 'lichess' }))
      .toBe('matchId must be a number');
  });

  it('returns error when gameId is missing', () => {
    expect(validateSubmitResultInput({ matchId: 1, gameId: '', platform: 'lichess' }))
      .toBe('gameId is required');
  });

  it('returns error when platform is invalid', () => {
    expect(validateSubmitResultInput({ matchId: 1, gameId: 'g', platform: 'unknown' }))
      .toBe('platform must be lichess or chessdotcom');
  });

  it('returns error when chessdotcom is missing username', () => {
    expect(validateSubmitResultInput({ matchId: 1, gameId: 'g', platform: 'chessdotcom' }))
      .toBe('username is required for chessdotcom');
  });
});

// ---------------------------------------------------------------------------
// verifyGameResult
// ---------------------------------------------------------------------------
describe('verifyGameResult', () => {
  let store: MatchStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MatchStore();
  });

  it('returns ok:true with verified result when everything matches', async () => {
    await seedMatch(store);
    mockFetchLichess.mockResolvedValue(LICHESS_GAME);

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.result).toBe('Player1Wins');
      expect(result.whitePlayer).toBe('alice');
      expect(result.blackPlayer).toBe('bob');
      expect(result.message).toContain('verified');
    }
  });

  it('returns ok:false with 404 and persistence hint when store is empty', async () => {
    // Store is empty — do not seed anything
    const result = await verifyGameResult(store, {
      matchId: 1,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Match not found');
      expect(result.hint).toBe('persistence_loss_suspected');
      expect(result.details).toMatch(/QUEUE_STORE/i);
    }
  });

  it('returns ok:false with 404 (no hint) when store has records but gameId is unknown', async () => {
    await seedMatch(store, { gameId: 'some-other-game' });

    const result = await verifyGameResult(store, {
      matchId: 1,
      gameId: 'lichess-game-abc', // unknown gameId
      platform: 'lichess',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Match not found');
      expect(result.hint).toBeUndefined();
    }
  });

  it('returns ok:false with 400 when player identities were not captured', async () => {
    await store.createMatch({
      player1: P1,
      player2: P2,
      // Deliberately no usernames
      stakeAmount: 100,
      token: 'XLM',
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Player identities not recorded');
    }
  });

  it('returns ok:false with 404 when game not found on platform', async () => {
    await seedMatch(store);
    mockFetchLichess.mockRejectedValue(new GameNotFoundError('lichess-game-abc'));

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe('Game not found on platform');
    }
  });

  it('returns ok:false with 400 when player identities do not match', async () => {
    await seedMatch(store, { player1Username: 'alice', player2Username: 'bob' });
    mockFetchLichess.mockResolvedValue({
      ...LICHESS_GAME,
      whitePlayer: 'charlie', // different player
      blackPlayer: 'dave',
    });

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('Player identity verification failed');
    }
  });

  it('accepts swapped player colors (player2 is white, player1 is black)', async () => {
    await seedMatch(store, { player1Username: 'alice', player2Username: 'bob' });
    mockFetchLichess.mockResolvedValue({
      ...LICHESS_GAME,
      whitePlayer: 'bob',   // swapped
      blackPlayer: 'alice', // swapped
    });

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'lichess',
    });

    expect(result.ok).toBe(true);
  });

  it('uses chessdotcom fetcher when platform is chessdotcom', async () => {
    await seedMatch(store, { platform: 'chessdotcom' });
    mockFetchChess.mockResolvedValue({ ...LICHESS_GAME, gameId: 'lichess-game-abc' });

    const result = await verifyGameResult(store, {
      matchId: 0,
      gameId: 'lichess-game-abc',
      platform: 'chessdotcom',
      username: 'alice',
    });

    expect(result.ok).toBe(true);
    expect(mockFetchChess).toHaveBeenCalledWith('alice', 'lichess-game-abc');
    expect(mockFetchLichess).not.toHaveBeenCalled();
  });
});
