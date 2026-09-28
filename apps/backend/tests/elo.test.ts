import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchLichessElo,
  resolveMatchMultiplier,
  selectRating,
  RATING_VARIANT_PREFERENCE,
} from '../src/services/elo.js';
import { MIN_ELO, MAX_ELO, BASE_MULTIPLIER } from '../src/services/elo-multiplier.js';

/**
 * Tests for the Lichess ELO lookup — issue #122 / #1801.
 *
 * The `get` dependency is injected rather than mocking `axios`, so these tests
 * exercise the real URL construction, the real error handling and the real
 * null-fallback policy without any module mocking.
 */

/** Build a Lichess user payload with ratings for the named variants. */
function user(perfs: Record<string, { rating: number }>) {
  return { id: 'u', username: 'u', perfs };
}

describe('selectRating', () => {
  it('prefers the first variant in the preference order', () => {
    expect(selectRating({ blitz: { rating: 1700 }, bullet: { rating: 2400 } })).toBe(1700);
  });

  it('falls through to the next variant when the preferred one is absent', () => {
    // A bullet-only account is common and must still be priced.
    expect(selectRating({ bullet: { rating: 2400 }, rapid: { rating: 1500 } })).toBe(2400);
  });

  it('returns null when the account has no rated games', () => {
    // A brand-new account. Null is a normal outcome, not an error.
    expect(selectRating({})).toBeNull();
    expect(selectRating(undefined)).toBeNull();
  });

  it('ignores a variant whose rating is missing or non-numeric', () => {
    expect(selectRating({ blitz: {}, classical: { rating: 2000 } })).toBe(2000);
  });

  it('ignores ratings for variants outside the preference list', () => {
    // Not a real variant; must not be used.
    expect(selectRating({ crazyhouse: { rating: 2900 } })).toBeNull();
  });

  it('exposes a non-empty preference list', () => {
    expect(RATING_VARIANT_PREFERENCE.length).toBeGreaterThan(0);
  });
});

describe('fetchLichessElo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the rating from the user endpoint', async () => {
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: 1820 } }));
    await expect(fetchLichessElo('alice', { get })).resolves.toBe(1820);
  });

  it('requests the documented endpoint for the username', async () => {
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: 1500 } }));
    await fetchLichessElo('alice', { get });
    expect(get).toHaveBeenCalledWith('https://lichess.org/api/user/alice');
  });

  it('URL-encodes the username', async () => {
    // A username with a slash must not be able to redirect the request to a
    // different path.
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: 1500 } }));
    await fetchLichessElo('a/b', { get });
    expect(get).toHaveBeenCalledWith('https://lichess.org/api/user/a%2Fb');
  });

  it('returns null for an unknown user instead of throwing', async () => {
    // The critical failure path: a 404 must degrade the stake, not abort
    // match creation.
    const get = vi.fn().mockRejectedValue(new Error('Lichess user not found: ghost'));
    await expect(fetchLichessElo('ghost', { get })).resolves.toBeNull();
  });

  it('returns null on a rate limit', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Lichess API rate limit exceeded (429)'));
    await expect(fetchLichessElo('alice', { get })).resolves.toBeNull();
  });

  it('returns null on a network error', async () => {
    const get = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchLichessElo('alice', { get })).resolves.toBeNull();
  });

  it('returns null for an empty username without making a request', async () => {
    const get = vi.fn();
    await expect(fetchLichessElo('', { get })).resolves.toBeNull();
    await expect(fetchLichessElo('   ', { get })).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('returns null for a user with no rated games', async () => {
    const get = vi.fn().mockResolvedValue(user({}));
    await expect(fetchLichessElo('newbie', { get })).resolves.toBeNull();
  });
});

describe('resolveMatchMultiplier', () => {
  it('prices a match between two rated players', async () => {
    const get = vi.fn(async (url: string) =>
      url.includes('alice') ? user({ blitz: { rating: 2000 } }) : user({ blitz: { rating: 2400 } }),
    );
    // average 2200 -> 1.7
    const result = await resolveMatchMultiplier('alice', 'bob', { get });
    expect(result.multiplier).toBe(1.7);
    expect(result.degraded).toBe(false);
  });

  it('degrades to the base multiplier when one lookup fails', async () => {
    const get = vi.fn(async (url: string) => {
      if (url.includes('bob')) throw new Error('404');
      return user({ blitz: { rating: 2800 } });
    });
    // The surviving 2800 must NOT lift the price — half the input is missing.
    const result = await resolveMatchMultiplier('alice', 'bob', { get });
    expect(result.multiplier).toBe(BASE_MULTIPLIER);
    expect(result.degraded).toBe(true);
  });

  it('degrades to the base multiplier when both lookups fail', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Lichess down'));
    const result = await resolveMatchMultiplier('alice', 'bob', { get });
    expect(result.multiplier).toBe(BASE_MULTIPLIER);
    expect(result.degraded).toBe(true);
  });

  it('reaches the ceiling for two maximum-rated players', async () => {
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: MAX_ELO } }));
    const result = await resolveMatchMultiplier('alice', 'bob', { get });
    expect(result.multiplier).toBe(2.0);
  });

  it('charges nothing extra at the floor', async () => {
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: MIN_ELO } }));
    const result = await resolveMatchMultiplier('alice', 'bob', { get });
    expect(result.multiplier).toBe(BASE_MULTIPLIER);
  });

  it('looks up both players', async () => {
    const get = vi.fn().mockResolvedValue(user({ blitz: { rating: 1500 } }));
    await resolveMatchMultiplier('alice', 'bob', { get });
    const urls = get.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('alice'))).toBe(true);
    expect(urls.some((u) => u.includes('bob'))).toBe(true);
  });

  it('never returns a multiplier below 1, whatever the ratings', async () => {
    for (const rating of [0, 100, MIN_ELO, 1500, MAX_ELO, 5000]) {
      const get = vi.fn().mockResolvedValue(user({ blitz: { rating } }));
      const result = await resolveMatchMultiplier('alice', 'bob', { get });
      expect(result.multiplier).toBeGreaterThanOrEqual(1);
    }
  });
});
