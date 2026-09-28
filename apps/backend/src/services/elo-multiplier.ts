/**
 * ELO-based stake multiplier.
 *
 * ## Why this is off-chain
 *
 * The multiplier is computed **off-chain** and stored as match metadata rather
 * than being re-derived by the escrow contract. Two reasons:
 *
 * 1. The escrow contract has no way to reach the Lichess API. Anything that
 *    needs an external HTTP call has to happen before the transaction is built.
 * 2. Making the contract re-derive a multiplier would put a third-party API's
 *    availability and a float formula in the payout path. The payout should
 *    depend only on values that were committed on-chain at match creation.
 *
 * The stake is therefore *already multiplied* by the time it reaches
 * `create_match`; this module decides what that multiplied value is, and the
 * inputs it used are recorded alongside it so the decision is auditable
 * after the fact.
 *
 * ## The formula
 *
 * Multipliers scale with the **average** of the two players' ratings, not the
 * difference. The difference is what *decides* a game; the level is what
 * determines how much a game is worth. Rating two equally strong players at
 * 2600 should carry a bigger pot than the same two players at 800, even though
 * the outcome is a coin flip in both cases.
 *
 * ```text
 * average    = (elo1 + elo2) / 2
 * headroom   = clamp((average - MIN_ELO) / (MAX_ELO - MIN_ELO), 0, 1)
 * multiplier = 1 + headroom * (MAX_MULTIPLIER - 1)
 * ```
 *
 * At or below `MIN_ELO` the multiplier is exactly `1` (no uplift). At or above
 * `MAX_ELO` it is exactly `MAX_MULTIPLIER`, and it rises linearly in between.
 * The result is truncated to two decimal places so the multiplier is
 * reproducible: floating-point rounding is deterministic given the same
 * inputs, but truncating to a fixed precision makes the stored value easy to
 * re-verify by hand and keeps it out of the ambiguity of full float output.
 *
 * ## Failure policy
 *
 * When a rating cannot be fetched, the match is priced at the **base** stake
 * (multiplier 1). This is the conservative direction: a player must never lose
 * money because an external API was slow, and defaulting *up* would let an
 * outage inflate stakes. See `resolveMultiplier` for the per-rating fallback.
 */

/** Lowest average rating that still earns any uplift. */
export const MIN_ELO = 800;

/** Average rating at which the maximum multiplier is reached. */
export const MAX_ELO = 2800;

/** Multiplier applied at or below `MIN_ELO`, and the fallback on fetch failure. */
export const BASE_MULTIPLIER = 1.0;

/** Multiplier ceiling at or above `MAX_ELO`. */
export const MAX_MULTIPLIER = 2.0;

/**
 * Rating assumed for a player whose rating could not be determined.
 *
 * Deliberately `MIN_ELO` rather than a realistic-looking number: substituting
 * 1500 for a player we failed to look up would hand them a 1.25x uplift they
 * did not earn. Assuming the floor means an unknown player is treated exactly
 * like a beginner, which is the direction that never over-charges anyone.
 */
export const UNKNOWN_ELO = MIN_ELO;

/** Tuning knobs. Every field has a default so the formula is always callable. */
export interface EloMultiplierConfig {
  /** Average rating at or below which the multiplier stays at 1. */
  minElo?: number;
  /** Average rating at or above which the multiplier is capped. */
  maxElo?: number;
  /** Multiplier at `minElo`. */
  baseMultiplier?: number;
  /** Multiplier at `maxElo`. */
  maxMultiplier?: number;
}

/** Fully-resolved configuration, with every default applied. */
export interface ResolvedEloConfig {
  minElo: number;
  maxElo: number;
  baseMultiplier: number;
  maxMultiplier: number;
}

/** The result of pricing a match, including the inputs it was derived from. */
export interface EloMultiplierResult {
  /** Multiplier applied to the base stake. Always `>= 1`. */
  multiplier: number;
  /** Average of the two ratings used. */
  averageElo: number;
  /** Rating assumed for a player whose rating was unavailable. */
  player1Elo: number;
  player2Elo: number;
  /** True when either rating was substituted rather than fetched. */
  degraded: boolean;
  /** Human-readable reason, present only when `degraded` is true. */
  reason?: string;
}

function resolveConfig(config: EloMultiplierConfig = {}): ResolvedEloConfig {
  return {
    minElo: config.minElo ?? MIN_ELO,
    maxElo: config.maxElo ?? MAX_ELO,
    baseMultiplier: config.baseMultiplier ?? BASE_MULTIPLIER,
    maxMultiplier: config.maxMultiplier ?? MAX_MULTIPLIER,
  };
}

/**
 * Round down to two decimal places.
 *
 * Truncation (not `toFixed`, which rounds to nearest) keeps the multiplier
 * from ever landing a hair *above* the configured maximum, and makes the
 * stored value independently checkable.
 */
function truncateToTwoDecimals(value: number): number {
  return Math.trunc(value * 100) / 100;
}

/** Clamp `value` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute the stake multiplier for a pair of ratings.
 *
 * Pure and synchronous: no I/O, no clock, no randomness. Everything
 * environment-dependent is passed in as an argument, which is what makes the
 * edge cases in the test suite (ratings at exactly the boundaries, inverted
 * orderings, unknown players) testable without stubbing anything.
 */
export function calculateEloMultiplier(
  player1Elo: number,
  player2Elo: number,
  config: EloMultiplierConfig = {},
): number {
  const { minElo, maxElo, baseMultiplier, maxMultiplier } = resolveConfig(config);

  // A zero-width range would divide by zero. Treat it as "always at the
  // ceiling" rather than emitting NaN, which would silently poison a stake.
  if (maxElo <= minElo) {
    return truncateToTwoDecimals(maxMultiplier);
  }

  const average = (player1Elo + player2Elo) / 2;
  const headroom = clamp((average - minElo) / (maxElo - minElo), 0, 1);
  const multiplier = baseMultiplier + headroom * (maxMultiplier - baseMultiplier);

  return truncateToTwoDecimals(multiplier);
}

/**
 * Resolve a multiplier from ratings that may be missing.
 *
 * A missing rating is replaced with `UNKNOWN_ELO` and flagged via `degraded`,
 * so the caller can log the degradation and still record an auditable
 * multiplier. The returned `multiplier` is the base stake in that case, which
 * is the correct outcome: an unrated player should not inflate the pot.
 */
export function resolveMultiplier(
  player1Elo: number | null | undefined,
  player2Elo: number | null | undefined,
  config: EloMultiplierConfig = {},
): EloMultiplierResult {
  const reasons: string[] = [];

  const hasP1 = typeof player1Elo === 'number' && Number.isFinite(player1Elo);
  const hasP2 = typeof player2Elo === 'number' && Number.isFinite(player2Elo);

  if (!hasP1) reasons.push('player1 rating unavailable');
  if (!hasP2) reasons.push('player2 rating unavailable');

  const effective1 = hasP1 ? (player1Elo as number) : UNKNOWN_ELO;
  const effective2 = hasP2 ? (player2Elo as number) : UNKNOWN_ELO;
  const degraded = reasons.length > 0;

  // When degraded, force the base multiplier regardless of what the surviving
  // rating would have produced. A 2800-rated opponent should not inflate the
  // pot when their own rating is unknown — the uplift is meant to price the
  // *match*, and half of that input is missing.
  const multiplier = degraded
    ? resolveConfig(config).baseMultiplier
    : calculateEloMultiplier(effective1, effective2, config);

  return {
    multiplier: truncateToTwoDecimals(multiplier),
    averageElo: (effective1 + effective2) / 2,
    player1Elo: effective1,
    player2Elo: effective2,
    degraded,
    ...(degraded ? { reason: reasons.join('; ') } : {}),
  };
}

/**
 * Apply a multiplier to a base stake amount.
 *
 * The base amount is in the token's smallest unit (stroops). The result is
 * truncated to a whole unit because a token transfer cannot move a fraction
 * of a stroop — rounding down means the contract is never asked to move more
 * than the multiplier authorises.
 */
export function applyEloMultiplier(baseStake: number, multiplier: number): number {
  if (!Number.isFinite(baseStake) || baseStake <= 0) {
    throw new RangeError(`baseStake must be a positive finite number, got ${baseStake}`);
  }
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new RangeError(`multiplier must be a finite number >= 1, got ${multiplier}`);
  }
  return Math.floor(baseStake * multiplier);
}
