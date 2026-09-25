//! Policy constants for the oracle contract.
//!
//! The ledger durations and identifier limits are defined once in
//! [`smile4money_common::constants`] and re-exported here, so the oracle can
//! never drift away from the escrow contract's deadlines. `lib.rs` does
//! `pub use constants::*`, which keeps the existing `crate::MATCH_TTL_LEDGERS`
//! path used by the unit tests working unchanged.

pub use smile4money_common::constants::{
    LEDGERS_PER_DAY, LEDGERS_PER_WEEK, MATCH_TTL_LEDGERS, MAX_GAME_ID_LEN, SECONDS_PER_DAY,
    SECONDS_PER_LEDGER, SECONDS_PER_WEEK,
};

/// Maximum number of entries returned by `list_results` in a single call.
///
/// **Source:** policy decided by this repository to bound the response size of a
/// single read so that listing can never exceed a Soroban transaction's
/// resource limits. See `docs/api-reference.md`.
pub const MAX_LIST_LIMIT: u32 = 100;
