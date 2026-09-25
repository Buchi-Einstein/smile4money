//! Canonical ledger-duration and identifier constants shared by the
//! escrow and oracle Soroban contracts.
//!
//! # Why this module exists
//!
//! Ledger counts are *policy*, not implementation details: the escrow contract,
//! the oracle contract and the frontend must all agree on how long a dispute
//! window or a TTL is, otherwise a countdown rendered in the UI will disagree
//! with the on-chain deadline. Every value therefore lives here exactly once and
//! is re-exported by each contract's own `constants` module.
//!
//! # Sources
//!
//! - Average time to close a ledger (≈ 5 s) and the fact that it is a *target*
//!   rather than a guarantee: <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy>
//! - `extend_ttl` / `bump` semantics and the meaning of the *threshold* and
//!   *extend-to* arguments: <https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes>
//! - Maximum entry TTL (`max_entry_ttl`, 6 months): <https://developers.stellar.org/docs/network/limits>
//! - Soroban environment configuration for the ledger timestamp: <https://developers.stellar.org/docs/build/guides/environment-factors>

/// Average number of seconds it takes Stellar to close one ledger.
///
/// **Source:** the Stellar ledger anatomy guide states that a new ledger closes
/// roughly every 5 seconds on average, and that the value is a network *target*
/// rather than a hard guarantee. Actual close times vary with network
/// conditions, so every ledger-derived deadline in this repository is an
/// *estimate*.
///
/// <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy>
///
/// Used to convert between ledger counts and wall-clock seconds for TTLs,
/// dispute windows and timeouts.
pub const SECONDS_PER_LEDGER: u32 = 5;

/// Seconds in one day (24 h).
///
/// **Source:** defined by SI time; used here only as the arithmetic bridge
/// between [`SECONDS_PER_LEDGER`] and the human-facing day/week windows below.
pub const SECONDS_PER_DAY: u32 = 86_400;

/// Seconds in one week (7 days).
///
/// **Source:** defined by SI time; used here only as the arithmetic bridge
/// between [`SECONDS_PER_LEDGER`] and the human-facing day/week windows below.
pub const SECONDS_PER_WEEK: u32 = 604_800;

/// Number of ledgers in ~1 day at [`SECONDS_PER_LEDGER`] (`86_400 / 5`).
///
/// **Source:** derived from the Stellar 5 s/ledger average documented on
/// [`SECONDS_PER_LEDGER`].
///
/// <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy>
pub const LEDGERS_PER_DAY: u32 = 17_280;

/// Number of ledgers in ~1 week at [`SECONDS_PER_LEDGER`] (`604_800 / 5`).
///
/// **Source:** derived from the Stellar 5 s/ledger average documented on
/// [`SECONDS_PER_LEDGER`].
///
/// <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy>
pub const LEDGERS_PER_WEEK: u32 = 120_960;

/// TTL applied to persistent match/result entries: ~30 days (`518_400` ledgers).
///
/// **Source:** chosen by this repository as a 30-day retention window — the
/// platform's documented support/DLQ retention period — expressed in ledgers
/// using the Stellar 5 s/ledger average. It is well under the protocol's
/// `max_entry_ttl` of 6 months (31_536_000 ledgers), so an entry can never be
/// extended beyond the network maximum.
///
/// <https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes>
/// <https://developers.stellar.org/docs/network/limits>
pub const MATCH_TTL_LEDGERS: u32 = 518_400;

/// Dispute window: ~24 hours (`17_280` ledgers) after the oracle submits a result.
///
/// **Source:** policy decided in ADR-001
/// (`docs/adr/001-dispute-window.md`) as `SECONDS_PER_DAY / SECONDS_PER_LEDGER`.
/// The reasoning for 24 h over 7 days is recorded in that ADR.
pub const DISPUTE_WINDOW_LEDGERS: u32 = LEDGERS_PER_DAY;

/// Match timeout: ~7 days (`120_960` ledgers) without an oracle result.
///
/// **Source:** policy decided in ADR-001 (`docs/adr/001-dispute-window.md`) as
/// `SECONDS_PER_WEEK / SECONDS_PER_LEDGER`. It is the trustless fallback that
/// lets players reclaim stakes if the oracle never reports a result, so it is
/// deliberately much longer than the dispute window and than the backend's
/// default polling budget.
pub const TIMEOUT_LEDGERS: u32 = LEDGERS_PER_WEEK;

/// Maximum allowed byte length of a `game_id` string.
///
/// **Source:** policy decided by this repository; mirrors the maximum ledger
/// key component length allowed by Soroban `String` (32 bytes) plus headroom.
/// See `docs/api-reference.md` for the accepted character set.
pub const MAX_GAME_ID_LEN: u32 = 64;
