# fix(oracle): reject zero address in transfer_admin

## Description

`oracle::transfer_admin` previously accepted any address as `new_admin` without
validation, including the all-zeroes contract address
(`CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM`). That address can
never sign a transaction, so storing it as admin would permanently brick the
contract — no subsequent `transfer_admin`, `submit_result`, or `withdraw` call
could ever succeed.

### Changes

**`contracts/oracle/src/errors.rs`**
- Added `InvalidAdmin = 8` variant with a stable numeric code and doc comment
  explaining the brick-risk. Existing codes are untouched — no breaking change
  for clients that inspect raw error codes.

**`contracts/oracle/src/lib.rs`**
- `transfer_admin`: added a zero-address guard using `Address::from_strkey`
  against the canonical all-zeroes C-address strkey. Returns
  `Err(Error::InvalidAdmin)` before any state is written.
- Updated `transfer_admin` doc comment to document the new `InvalidAdmin` error
  alongside the existing `Unauthorized` case.
- Added test `test_transfer_admin_zero_address_returns_invalid_admin` that:
  - asserts `try_transfer_admin` returns `Err(Ok(Error::InvalidAdmin))` for the
    zero address
  - confirms the contract remains fully operational after the rejected call (i.e.
    `submit_result` still succeeds, verifying the admin slot was not overwritten)

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

The new test to look for:

```
test tests::test_transfer_admin_zero_address_returns_invalid_admin ... ok
```

All pre-existing oracle tests must continue to pass.

- [x] Tests added or updated
- [ ] Manual testing performed

## Contract Changes

The `Error` enum gains a new variant (`InvalidAdmin = 8`). The numeric
discriminants of all existing variants are unchanged.

- [ ] ABI breaking? (requires re-deployment of existing contracts)
- [ ] Storage migration needed?
- [x] ABI reviewed for breaking changes

> The new error code `8` is additive. Clients that switch on raw error codes and
> use a catch-all for unknown values are unaffected. Clients with exhaustive
> matches on the `Error` enum (generated bindings) will need to handle the new
> variant — this is expected and safe.

## Security

- [x] No secrets committed
- [x] Security implications considered and documented

This fix closes a contract-bricking vector: a malicious or mistaken admin could
have called `transfer_admin(zero_address)`, irrecoverably locking all admin-gated
functionality (`submit_result`, `withdraw`, future `transfer_admin`). The guard is
applied before `require_auth` writes any state, so no partial update is possible.

## Documentation

- [ ] Relevant docs updated (docs/ folder, README, etc.)

The `transfer_admin` doc comment in `lib.rs` has been updated inline. No separate
docs-folder changes are needed for this fix.
