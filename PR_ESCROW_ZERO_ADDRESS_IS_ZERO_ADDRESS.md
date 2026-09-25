# fix(escrow): replace string-based zero-address check in create_match with is_zero_address helper

## Description

`create_match` was validating player addresses against the zero/burn address by
constructing a Soroban `String` from the strkey literal
`"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"` and calling
`player.to_string()` on each player address to compare. The contract already has
an `is_zero_address(&env, addr)` helper that constructs the zero address directly
from XDR and performs a byte-level `Address` equality check.

The string-comparison approach has two problems:
1. **Compute budget**: converting an `Address` to its strkey string and comparing
   two strings costs significantly more on-chain compute than comparing `Address`
   objects directly.
2. **Fragility**: the check silently breaks if the strkey encoding changes or if
   the wrong literal is copied (e.g. the C-address variant vs the G-address
   variant used here).

### Change

**`contracts/escrow/src/lib.rs`** — `create_match` (single block replaced):

```rust
// Before
let zero_address = String::from_str(
    &env,
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
);
if player1.to_string() == zero_address || player2.to_string() == zero_address {
    return Err(Error::InvalidAddress);
}

// After
if is_zero_address(&env, &player1) || is_zero_address(&env, &player2) {
    return Err(Error::InvalidAddress);
}
```

No logic change — `InvalidAddress` is still returned for the same inputs. The
existing tests (`test_create_match_player1_zero_address_fails` and
`test_create_match_player2_zero_address_fails`) cover both paths without
modification.

## Type of Change

- [x] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Refactor (code change that neither fixes a bug nor adds a feature)
- [ ] Documentation update

## Testing

Run the escrow test suite (requires Rust 1.88.0 — same toolchain as CI):

```bash
cargo test -p smile4money-escrow --lib --verbose
```

Relevant existing tests that must pass:

```
test tests::test_create_match_player1_zero_address_fails ... ok
test tests::test_create_match_player2_zero_address_fails ... ok
```

All other escrow tests must continue to pass unchanged.

- [ ] Tests added or updated
- [x] Manual testing performed

> No new tests needed — the two existing zero-address tests provide full
> coverage of the changed code path. Their assertions and inputs are identical;
> only the internal implementation changed.

## Contract Changes

No ABI changes. No new functions, error codes, or storage keys. This is an
internal implementation replacement with identical observable behaviour.

- [ ] ABI breaking? (requires re-deployment of existing contracts)
- [ ] Storage migration needed?
- [x] ABI reviewed for breaking changes

## Security

- [x] No secrets committed
- [x] Security implications considered and documented

The fix is strictly an improvement: the `is_zero_address` helper uses XDR-based
`Address` construction and object equality, which is both more efficient and more
correct than a string comparison. The security property (rejecting the zero/burn
address as a player) is preserved.

## Documentation

- [ ] Relevant docs updated (docs/ folder, README, etc.)

No documentation changes needed. The public API and error behaviour are
unchanged.
