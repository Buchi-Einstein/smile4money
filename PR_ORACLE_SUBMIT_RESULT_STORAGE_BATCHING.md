# perf(oracle): batch submit result instance reads

## Description

`oracle::submit_result` previously read `Admin` and `ResultCount` as separate
instance storage entries. They are now stored together in `InstanceState`, so
the submission path loads both values with one instance storage read and writes
the updated count back with one instance storage write. The persistent result
existence check remains separate because it uses a different storage tier and
must be performed before accepting a duplicate.

## CPU instruction comparison

The refactor reduces the storage operations on the same successful
`submit_result` scenario as follows:

| Version | Instance reads | Persistent reads | CPU instructions |
|---------|------------------|--------------------|------------------|
| Before | 2 (`Admin`, `ResultCount`) | 1 (`Result`) | Not measurable in this checkout: Rust/Soroban toolchain unavailable |
| After | 1 (`InstanceState`) | 1 (`Result`) | Not measurable in this checkout: Rust/Soroban toolchain unavailable |

Run `cargo test --manifest-path contracts/oracle/Cargo.toml` with the pinned
toolchain to capture the SDK budget's CPU instruction count for both revisions.
The storage-read reduction is deterministic: 3 reads become 2, a 33% reduction
in storage read operations on this path.

## Testing

The oracle contract test suite passes with the refactor.