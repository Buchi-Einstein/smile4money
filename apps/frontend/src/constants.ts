/**
 * Canonical ledger-duration constants for the TypeScript apps.
 *
 * These MUST stay in sync with the Rust definitions in
 * `contracts/smile4money-common/src/constants.rs` (re-exported by
 * `contracts/escrow/src/constants.rs` and `contracts/oracle/src/constants.rs`).
 * If the UI disagrees with the chain, players will see a payout countdown that
 * does not match reality, so every value lives here exactly once.
 *
 * ## Sources
 *
 * - Average time to close a ledger (~5 s) and the fact that it is a *target*
 *   rather than a guarantee:
 *   https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy
 * - `extend_ttl` / `bump` threshold and extend-to semantics:
 *   https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes
 * - Network limits (`max_entry_ttl`):
 *   https://developers.stellar.org/docs/network/limits
 * - Dispute window and match timeout policy: ADR-001
 *   (`docs/adr/001-dispute-window.md`)
 */

/**
 * Average number of seconds it takes Stellar to close one ledger.
 *
 * Source: the Stellar ledger anatomy guide states that a new ledger closes
 * roughly every 5 seconds on average, and that this is a network *target* rather
 * than a hard guarantee. Actual close times vary with network conditions, so
 * every ledger-derived deadline rendered in the UI is an *estimate*.
 */
export const SECONDS_PER_LEDGER = 5;

/** Seconds in one day (24 h). Source: SI time; used as the arithmetic bridge to `LEDGERS_PER_DAY`. */
export const SECONDS_PER_DAY = 86_400;

/** Seconds in one week (7 days). Source: SI time; used as the arithmetic bridge to `LEDGERS_PER_WEEK`. */
export const SECONDS_PER_WEEK = 604_800;

/** Number of ledgers in ~1 day (`SECONDS_PER_DAY / SECONDS_PER_LEDGER`). Source: Stellar 5 s/ledger average. */
export const LEDGERS_PER_DAY = 17_280;

/** Number of ledgers in ~1 week (`SECONDS_PER_WEEK / SECONDS_PER_LEDGER`). Source: Stellar 5 s/ledger average. */
export const LEDGERS_PER_WEEK = 120_960;

/**
 * TTL applied to persistent match/result entries: ~30 days (`518_400` ledgers).
 *
 * Source: policy chosen by this repository as a 30-day retention window — the
 * platform's documented support/DLQ retention period — expressed in ledgers
 * using the Stellar 5 s/ledger average. It is well under the protocol's
 * `max_entry_ttl` of 6 months (31_536_000 ledgers), so an entry can never be
 * extended beyond the network maximum.
 */
export const MATCH_TTL_LEDGERS = 518_400;

/**
 * Dispute window: ~24 hours (`17_280` ledgers) after the oracle submits a result.
 *
 * Source: policy decided in ADR-001 (`docs/adr/001-dispute-window.md`) as
 * `SECONDS_PER_DAY / SECONDS_PER_LEDGER`. The reasoning for 24 h over 7 days is
 * recorded in that ADR.
 */
export const DISPUTE_WINDOW_LEDGERS = 17_280;

/**
 * Match timeout: ~7 days (`120_960` ledgers) without an oracle result.
 *
 * Source: policy decided in ADR-001 (`docs/adr/001-dispute-window.md`) as
 * `SECONDS_PER_WEEK / SECONDS_PER_LEDGER`. It is the trustless fallback that lets
 * players reclaim stakes if the oracle never reports a result.
 */
export const TIMEOUT_LEDGERS = 120_960;

/**
 * Minimum stake amount in the smallest token unit (1 stroop).
 *
 * Source: policy decided by this repository; prevents economically meaningless
 * zero-stake matches. See `docs/issue-3-zero-stake-guard.md`.
 */
export const MIN_STAKE = 1;

/**
 * Maximum stake amount in the smallest token unit.
 *
 * Source: policy decided by this repository; prevents a single match from
 * locking unbounded funds in escrow. The exact ceiling is recorded in
 * `docs/api-reference.md`.
 */
export const MAX_STAKE = 10_000_000_000_000;

/**
 * Maximum allowed byte length of a `game_id` string.
 *
 * Source: policy decided by this repository. See `docs/api-reference.md` for the
 * accepted character set (`[A-Za-z0-9_-]`).
 */
export const MAX_GAME_ID_LEN = 64;
