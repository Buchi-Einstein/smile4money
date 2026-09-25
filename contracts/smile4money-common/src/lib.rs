//! # smile4money-common
//!
//! Shared types and error variants used by the escrow and oracle Soroban contracts.
//!
//! ## Error codes
//!
//! Error codes are **stable on-chain identifiers**. Do **not** renumber existing variants —
//! doing so is a breaking change for any client that inspects the raw error code.
//!
//! Each contract has its own `Error` enum (required by `#[contracterror]`) but imports
//! shared variants from [`SharedError`] and implements `From<SharedError>` to allow
//! transparent conversion with the `?` operator.

#![no_std]

use soroban_sdk::contracterror;

/// Error variants that are shared across the escrow and oracle contracts.
///
/// These codes are the **canonical** values for each shared concept. Both contracts
/// must use the same numeric discriminant for the same semantic error.
///
/// # Shared error code table
///
/// | Code | Variant            | Meaning                                                        |
/// |------|--------------------|----------------------------------------------------------------|
/// |  4   | Unauthorized       | Caller is not permitted to perform this action                 |
/// |  7   | AlreadyInitialized | Contract has already been initialized                          |
/// | 10   | InvalidAmount      | Amount must be greater than zero                               |
/// | 11   | InvalidGameId      | game_id is empty, exceeds 64 bytes, or contains invalid chars  |
/// | 15   | TransferFailed     | Token transfer failed                                          |
/// | 23   | InvalidAdmin       | The admin address is invalid (zero address or same as current) |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SharedError {
    /// [E004] Caller is not the oracle, admin, or an authorised player for this operation.
    Unauthorized = 4,

    /// [E007] `initialize` has already been called; the contract cannot be re-initialized.
    AlreadyInitialized = 7,

    /// [E010] Amount must be a positive integer greater than zero.
    InvalidAmount = 10,

    /// [E011] `game_id` is empty, exceeds the 64-byte maximum length, or contains
    /// characters outside the allowed set `[A-Za-z0-9_-]`.
    InvalidGameId = 11,

    /// [E015] Token transfer failed.
    TransferFailed = 15,

    /// [E023] The admin address is invalid (e.g. zero address or same as current admin).
    InvalidAdmin = 23,
}
