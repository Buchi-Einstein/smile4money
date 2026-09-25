use soroban_sdk::contracterror;

pub use smile4money_common::SharedError;

/// Errors returned by the oracle contract.
///
/// Variants shared with the escrow contract (same semantic meaning, same numeric code)
/// are also defined in [`smile4money_common::SharedError`]. The [`From<SharedError>`]
/// implementation allows propagating shared errors with the `?` operator.
///
/// Each variant carries a stable numeric code (the discriminant) that is
/// encoded on-chain and surfaced to clients. Do **not** renumber existing
/// variants — doing so is a breaking change for any client that inspects the
/// raw error code.
///
/// # Error code table
///
/// | Code | Variant            | Shared? | Meaning                                                  |
/// |------|--------------------|---------|----------------------------------------------------------|
/// |  2   | AlreadySubmitted   |         | A result has already been recorded for this match_id     |
/// |  3   | ResultNotFound     |         | No result has been submitted for the given match_id      |
/// |  4   | Unauthorized       | ✓       | Caller is not the registered admin                       |
/// |  7   | AlreadyInitialized | ✓       | Contract has already been initialized                    |
/// | 10   | InvalidAmount      | ✓       | withdraw amount must be greater than zero                |
/// | 11   | InvalidGameId      | ✓       | game_id is empty, exceeds 64 bytes, or contains invalid chars |
/// | 15   | TransferFailed     | ✓       | Token transfer in withdraw failed                        |
/// | 23   | InvalidAdmin       | ✓       | new_admin is the zero/burn address                       |
///
/// > **Note**: Error codes for shared variants were unified with the escrow contract.
/// > Previously `Unauthorized` was 1, `AlreadyInitialized` was 4, `InvalidGameId` was 5,
/// > `TransferFailed` was 6, `InvalidAmount` was 7, and `InvalidAdmin` was 8.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// [E002] A result has already been recorded for this `match_id`.
    /// Results are immutable once submitted to prevent tampering.
    AlreadySubmitted = 2,

    /// [E003] No result has been submitted for the given `match_id` yet.
    ResultNotFound = 3,

    /// [E004] Caller is not the registered admin (the trusted off-chain oracle service).
    /// **Shared** — same code as [`SharedError::Unauthorized`].
    Unauthorized = 4,

    /// [E007] `initialize` has already been called; the contract cannot be re-initialized.
    /// **Shared** — same code as [`SharedError::AlreadyInitialized`].
    AlreadyInitialized = 7,

    /// [E010] Invalid amount supplied to `withdraw` (amount must be > 0).
    /// **Shared** — same code as [`SharedError::InvalidAmount`].
    InvalidAmount = 10,

    /// [E011] `game_id` is empty, exceeds the 64-byte maximum length, or contains
    /// characters outside the allowed set `[A-Za-z0-9_-]`.
    /// **Shared** — same code as [`SharedError::InvalidGameId`].
    InvalidGameId = 11,

    /// [E015] Token transfer failed during `withdraw`.
    /// **Shared** — same code as [`SharedError::TransferFailed`].
    TransferFailed = 15,

    /// [E023] `new_admin` is the zero/burn address. Storing it would permanently
    /// brick the contract because the zero address can never sign a transaction.
    /// **Shared** — same code as [`SharedError::InvalidAdmin`].
    InvalidAdmin = 23,
}

/// Convert a [`SharedError`] into an oracle [`Error`].
///
/// This enables the `?` operator when calling helper functions that return
/// `Result<_, SharedError>`, propagating them as the equivalent local variant.
impl From<SharedError> for Error {
    fn from(e: SharedError) -> Self {
        match e {
            SharedError::Unauthorized => Error::Unauthorized,
            SharedError::AlreadyInitialized => Error::AlreadyInitialized,
            SharedError::InvalidAmount => Error::InvalidAmount,
            SharedError::InvalidGameId => Error::InvalidGameId,
            SharedError::TransferFailed => Error::TransferFailed,
            SharedError::InvalidAdmin => Error::InvalidAdmin,
        }
    }
}
