//! Policy constants for the escrow contract.
//!
//! # Single source of truth
//!
//! Every ledger duration in the escrow contract comes from
//! [`smile4money_common::constants`] and is re-exported here, so this module is
//! the only place a reader needs to look. `lib.rs` does `pub use constants::*`,
//! which keeps the existing `crate::MATCH_TTL_LEDGERS` / `crate::MIN_STAKE`
//! paths (used by the unit tests) working unchanged.
//!
//! # Sources
//!
//! - Stellar ledger close time (~5 s average) and ledger lifecycle:
//!   <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/ledger-anatomy>
//! - `extend_ttl` threshold / extend-to semantics:
//!   <https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes>
//! - Network limits (`max_entry_ttl`):
//!   <https://developers.stellar.org/docs/network/limits>
//! - Dispute window and match timeout policy: ADR-001
//!   (`docs/adr/001-dispute-window.md`)
//! - Minimum account balance / base reserve:
//!   <https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/minimum-account-balance>

// Shared ledger durations. Defined in `smile4money-common` so the oracle and the
// frontend can share them; re-exported here because the escrow contract is
// where these deadlines are actually enforced.
pub use smile4money_common::constants::{
    DISPUTE_WINDOW_LEDGERS, LEDGERS_PER_DAY, LEDGERS_PER_WEEK, MAX_GAME_ID_LEN, MATCH_TTL_LEDGERS, SECONDS_PER_DAY,
    SECONDS_PER_LEDGER, SECONDS_PER_WEEK, TIMEOUT_LEDGERS,
};

/// Minimum stake amount in the smallest token unit (1 stroop).
///
/// **Source:** policy decided by this repository; prevents economically
/// meaningless zero-stake matches. See `docs/issue-3-zero-stake-guard.md`.
pub const MIN_STAKE: i128 = 1;

/// Maximum stake amount in the smallest token unit.
///
/// **Source:** policy decided by this repository; prevents a single match from
/// locking unbounded funds in escrow, concentrating risk, and amplifying the
/// impact of any exploit. The exact ceiling is recorded in
/// `docs/api-reference.md`.
pub const MAX_STAKE: i128 = 10_000_000_000_000;

/// Instance-storage TTL threshold: ~30 days (`518_400` ledgers).
///
/// **Source:** uses the same 30-day retention window as
/// [`MATCH_TTL_LEDGERS`], expressed in ledgers via the Stellar 5 s/ledger
/// average. Instance entries (oracle, admin, token, paused, match_count) are
/// bumped on every write; without this they would expire and the contract would
/// fail with storage-not-found errors.
///
/// <https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes>
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = MATCH_TTL_LEDGERS;

/// Number of ledgers instance-storage entries are extended to.
///
/// **Source:** same 30-day window as [`INSTANCE_LIFETIME_THRESHOLD`] and
/// [`MATCH_TTL_LEDGERS`], so an instance entry and the persistent match entry
/// it describes always expire together.
///
/// <https://developers.stellar.org/docs/build/guides/storage/extend-bump-lifetimes>
pub const INSTANCE_BUMP_AMOUNT: u32 = MATCH_TTL_LEDGERS;

/// Reserve buffer (in stroops) the contract must always retain **after** a
/// payout, to satisfy Stellar's minimum-account-balance rule and leave a small
/// operational safety margin.
///
/// Every Stellar account (including the address backing a Soroban contract)
/// must hold at least 2 base reserves = **1 XLM** just to exist on the ledger.
/// If an escrow payout dropped the contract below that threshold, the underlying
/// `PAYMENT` / `transfer` op would abort and leave the match state machine
/// inconsistent (state not advanced, funds not sent).
///
/// **Source:** Stellar minimum account balance
/// (<https://developers.stellar.org/docs/encyclopedia/security-and-property-guides/minimum-account-balance>)
/// and the base-reserve value documented in `docs/deployment.md`. The 0.5 XLM of
/// slack on top of the 1 XLM minimum is a policy choice by this repository.
///
/// `15_000_000` stroops = 1.5 XLM (1 XLM minimum base reserve + 0.5 XLM slack).
/// For non-native tokens (e.g. USDC) the same constant still serves as a floor;
/// the real XLM minimum is provided by a separate admin-funded native top-up
/// (see `docs/deployment.md`).
pub const ESCROW_RESERVE_BUFFER_STROOPS: i128 = 15_000_000;
