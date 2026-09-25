# fix(oracle): validate game_id character set in submit_result

## Description

`oracle::submit_result` checked `game_id` length (1–64 bytes) but not its
character content. The escrow contract enforces `[A-Za-z0-9_-]` for `game_id`
on its side. If the oracle stored a `game_id` containing null bytes, control
characters, whitespace, or non-ASCII sequences, the stored `ResultEntry.game_id`
would permanently diverge from the escrow's accepted format, triggering an
irrecoverable `GameIdMismatch` error that locks player funds.

### Changes

**`contracts/oracle/src/lib.rs`**
- Added `is_valid_game_id` free function at module scope. It copies the string
  into a fixed 64-byte stack buffer (no heap allocation in the WASM guest) and
  checks every byte against `[A-Za-z0-9_-]`. The implementation is a verbatim
  mirror of the identical helper in the escrow contract, guaranteeing the two
  contracts always agree on what constitutes a valid `game_id`.
- `submit_result`: added the character-set check immediately after the length
  check. Both failures return `Error::InvalidGameId` — no new error code needed,
  and no ABI break.
- Updated `submit_result` doc comment to document the charset constraint and
  expand the `InvalidGameId` error description.
- Added 7 focused tests (see Testing section).

**`contracts/oracle/src/errors.rs`**
- Updated the `InvalidGameId = 5` table row and doc comment to describe the
  full validation rule: empty, over-length, _or_ characters outside
  `[A-Za-z0-9_-]`. No numeric code change — fully backwards compatible.

## Type of Change

- [x] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Refactor (code change that neither fixes a bug nor adds a feature)
- [ ] Documentation update

## Testing

Run the oracle test suite (requires Rust 1.88.0 — same toolchain as CI):

```bash
cargo test -p smile4money-oracle --lib --verbose
```

New tests to look for:

```
test tests::submit_result_game_id_with_null_byte_returns_invalid   ... ok
test tests::submit_result_game_id_with_space_returns_invalid       ... ok
test tests::submit_result_game_id_with_slash_returns_invalid       ... ok
test tests::submit_result_game_id_with_at_symbol_returns_invalid   ... ok
test tests::submit_result_game_id_valid_charset_accepted           ... ok
test tests::submit_result_game_id_single_char_accepted             ... ok
test tests::submit_result_game_id_max_length_valid_charset_accepted ... ok
```

All pre-existing oracle tests must continue to pass.

- [x] Tests added or updated
- [ ] Manual testing performed

## Contract Changes

No new error codes. `InvalidGameId = 5` now covers three conditions (empty,
over-length, invalid characters) instead of two, which is a strictly additive
clarification.

- [ ] ABI breaking? (requires re-deployment of existing contracts)
- [ ] Storage migration needed?
- [x] ABI reviewed for breaking changes

> No ABI break. The error variant discriminant `5` is unchanged. Clients that
> already handle `InvalidGameId` will handle the expanded condition correctly
> without modification.

## Security

- [x] No secrets committed
- [x] Security implications considered and documented

This fix closes a fund-locking vector: a malicious or buggy oracle submission
containing a non-printable character (e.g. a null byte injected via a crafted
API response) would pass the old length check, get stored on-chain, and then
permanently mismatch against the escrow's validated `game_id`, making the
match unresolvable. The fix brings the oracle into parity with the escrow's
existing character-set enforcement at the earliest possible point in the call.

## Documentation

- [ ] Relevant docs updated (docs/ folder, README, etc.)

The `submit_result` doc comment in `lib.rs` and the `InvalidGameId` entry in
`errors.rs` have been updated inline. No separate docs-folder changes are
needed for this fix.
