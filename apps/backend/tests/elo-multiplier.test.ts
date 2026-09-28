import { describe, it, expect } from 'vitest';
import {
  calculateEloMultiplier,
  resolveMultiplier,
  applyEloMultiplier,
  MIN_ELO,
  MAX_ELO,
  BASE_MULTIPLIER,
  MAX_MULTIPLIER,
  UNKNOWN_ELO,
} from '../src/services/elo-multiplier.js';

/**
 * Tests for the ELO stake multiplier â€” issue #122 / #1801.
 *
 * The formula is pure, so these are exact-equality assertions on hand-computed
 * values rather than range checks. The boundary cases are the point: this
 * function decides how much real money is escrowed, and an off-by-one at
 * `MIN_ELO`/`MAX_ELO` would silently over- or under-charge every match played
 * at that level.
 */

describe('calculateEloMultiplier â€” boundaries', () => {
  it('returns exactly the base multiplier at MIN_ELO', () => {
    expect(calculateEloMultiplier(MIN_ELO, MIN_ELO)).toBe(BASE_MULTIPLIER);
  });

  it('returns exactly the base multiplier below MIN_ELO', () => {
    // Clamped, not extrapolated: a 100-rated player must not drag the
    // multiplier below 1, which would discount the pot.
    expect(calculateEloMultiplier(100, 100)).toBe(BASE_MULTIPLIER);
    expect(calculateEloMultiplier(0, 0)).toBe(BASE_MULTIPLIER);
  });

  it('returns exactly the max multiplier at MAX_ELO', () => {
    expect(calculateEloMultiplier(MAX_ELO, MAX_ELO)).toBe(MAX_MULTIPLIER);
  });

  it('never exceeds the max multiplier above MAX_ELO', () => {
    // The 3000-rated case is the one that would over-charge a player if the
    // clamp were missing.
    expect(calculateEloMultiplier(3000, 3000)).toBe(MAX_MULTIPLIER);
    expect(calculateEloMultiplier(5000, 5000)).toBe(MAX_MULTIPLIER);
  });

  it('is linear at the exact midpoint', () => {
    // (800 + 2800) / 2 = 1800 -> exactly half the range -> 1.5
    expect(calculateEloMultiplier(1800, 1800)).toBe(1.5);
  });

  it('is symmetric â€” argument order does not matter', () => {
    // Average is commutative, so swapping players cannot change the price.
    // Getting this wrong would let a player choose which slot to take.
    expect(calculateEloMultiplier(1200, 2400)).toBe(calculateEloMultiplier(2400, 1200));
  });

  it('depends on the average, not the difference', () => {
    // Two strong players, very different ratings, are priced like two players
    // at their shared average â€” not like a mismatch.
    expect(calculateEloMultiplier(2000, 2400)).toBe(calculateEloMultiplier(2200, 2200));
  });

  it('is monotonically non-decreasing as ratings rise', () => {
    let previous = 0;
    for (let elo = 0; elo <= 3200; elo += 25) {
      const current = calculateEloMultiplier(elo, elo);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('calculateEloMultiplier â€” known values', () => {
  it.each([
    [800, 1.0],
    [1000, 1.1],
    [1200, 1.2],
    [1400, 1.3],
    [1600, 1.4],
    [1800, 1.5],
    [2000, 1.6],
    [2200, 1.7],
    [2400, 1.8],
    [2600, 1.9],
    [2800, 2.0],
  ])('gives %i/%i a multiplier of %f', (elo, expected) => {
    // Each 200 rating points is 1/10 of the 800..2800 range, and the range
    // spans 1.0 of multiplier, so each step is exactly 0.1.
    expect(calculateEloMultiplier(elo as number, elo as number)).toBe(expected);
  });

  it('rounds down to two decimals rather than to nearest', () => {
    // 1700 average -> headroom (1700-800)/2000 = 0.45 -> 1 + 0.45 = 1.45.
    // A value that does not divide evenly proves the truncation path.
    expect(calculateEloMultiplier(1700, 1700)).toBe(1.45);

    // 1300 -> headroom 0.25 -> 1.25
    expect(calculateEloMultiplier(1300, 1300)).toBe(1.25);
  });
});

describe('calculateEloMultiplier â€” custom configuration', () => {
  it('honours a custom min/max ELO range', () => {
    const config = { minElo: 1000, maxElo: 2000 };
    expect(calculateEloMultiplier(1000, 1000, config)).toBe(1.0);
    expect(calculateEloMultiplier(2000, 2000, config)).toBe(2.0);
    expect(calculateEloMultiplier(1500, 1500, config)).toBe(1.5);
  });

  it('honours a custom multiplier ceiling', () => {
    const config = { maxMultiplier: 3.0 };
    expect(calculateEloMultiplier(MAX_ELO, MAX_ELO, config)).toBe(3.0);
    expect(calculateEloMultiplier(1800, 1800, config)).toBe(2.0);
  });

  it('does not divide by zero when the range is degenerate', () => {
    // minElo === maxElo would make the headroom term 0/0. Emitting NaN here
    // would propagate into a stake amount and break the match silently.
    const config = { minElo: 1500, maxElo: 1500 };
    const result = calculateEloMultiplier(1500, 1500, config);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(MAX_MULTIPLIER);
  });

  it('treats an inverted range as degenerate rather than negative', () => {
    const config = { minElo: 2000, maxElo: 1000 };
    const result = calculateEloMultiplier(1500, 1500, config);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveMultiplier â€” missing ratings', () => {
  it('returns the base multiplier when both ratings are null', () => {
    const result = resolveMultiplier(null, null);
    expect(result.multiplier).toBe(BASE_MULTIPLIER);
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('player1');
    expect(result.reason).toContain('player2');
  });

  it('returns the base multiplier when a rating is undefined', () => {
    expect(resolveMultiplier(undefined, undefined).multiplier).toBe(BASE_MULTIPLIER);
  });

  it('returns the base multiplier when a rating is NaN or infinite', () => {
    // A non-finite rating would otherwise poison the average into NaN and
    // produce a stake the contract cannot represent.
    expect(resolveMultiplier(Number.NaN, 2000).multiplier).toBe(BASE_MULTIPLIER);
    expect(resolveMultiplier(2000, Number.POSITIVE_INFINITY).multiplier).toBe(BASE_MULTIPLIER);
  });

  it('does NOT inflate the pot when only one rating is known', () => {
    // The important asymmetric case: a 2800-rated opponent whose own rating
    // is unknown must not produce the 2x ceiling. Half the input is missing,
    // so the match is priced at base.
    const result = resolveMultiplier(2800, null);
    expect(result.multiplier).toBe(BASE_MULTIPLIER);
    expect(result.degraded).toBe(true);
  });

  it('substitutes UNKNOWN_ELO for a missing rating and records it', () => {
    const result = resolveMultiplier(null, 2400);
    expect(result.player1Elo).toBe(UNKNOWN_ELO);
    expect(result.player2Elo).toBe(2400);
    expect(result.averageElo).toBe((UNKNOWN_ELO + 2400) / 2);
  });

  it('is not degraded when both ratings are present', () => {
    const result = resolveMultiplier(1500, 2100);
    expect(result.degraded).toBe(false);
    expect(result.reason).toBeUndefined();
    // average 1800 -> the midpoint -> 1.5
    expect(result.multiplier).toBe(1.5);
  });

  it('records a zero rating as a real rating, not a missing one', () => {
    // 0 is a legitimate (if extreme) rating. Treating falsy as missing would
    // silently mis-price it.
    const result = resolveMultiplier(0, 2800);
    expect(result.degraded).toBe(false);
    expect(result.player1Elo).toBe(0);
  });
});

describe('applyEloMultiplier', () => {
  it('scales the stake by the multiplier', () => {
    expect(applyEloMultiplier(1_000_000, 1.5)).toBe(1_500_000);
    expect(applyEloMultiplier(1_000_000, 2.0)).toBe(2_000_000);
  });

  it('leaves the stake unchanged at the base multiplier', () => {
    expect(applyEloMultiplier(1_000_000, 1.0)).toBe(1_000_000);
  });

  it('truncates to a whole stroop rather than rounding up', () => {
    // Rounding up would ask the contract to move more than the multiplier
    // authorises, which is the one direction that must never happen.
    expect(applyEloMultiplier(101, 1.5)).toBe(151);
    expect(applyEloMultiplier(3, 1.5)).toBe(4);
  });

  it('rejects a non-positive or non-finite base stake', () => {
    expect(() => applyEloMultiplier(0, 1.5)).toThrow(RangeError);
    expect(() => applyEloMultiplier(-1, 1.5)).toThrow(RangeError);
    expect(() => applyEloMultiplier(Number.NaN, 1.5)).toThrow(RangeError);
  });

  it('rejects a multiplier below 1', () => {
    // A sub-1 multiplier would discount the escrowed stake.
    expect(() => applyEloMultiplier(1000, 0.5)).toThrow(RangeError);
    expect(() => applyEloMultiplier(1000, Number.NaN)).toThrow(RangeError);
  });

  it('end-to-end: fetch ratings, price, then scale', () => {
    // average 2200 -> headroom 0.7 -> 1.7
    const { multiplier } = resolveMultiplier(2000, 2400);
    expect(multiplier).toBe(1.7);
    expect(applyEloMultiplier(10_000_000, multiplier)).toBe(17_000_000);
  });

  it('end-to-end: a degraded lookup leaves the stake at base', () => {
    const { multiplier } = resolveMultiplier(null, null);
    expect(applyEloMultiplier(10_000_000, multiplier)).toBe(10_000_000);
  });
});
