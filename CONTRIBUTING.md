# Contributing to smile4money

Thank you for your interest in contributing! This document covers environment setup, running tests, and PR guidelines.

## Prerequisites

- **Rust** 1.88.0 (pinned via `rust-toolchain.toml`) — [rustup.rs](https://rustup.rs)
  ```bash
  # Install rustup (if not already installed)
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  
  # The project's rust-toolchain.toml will automatically install Rust 1.88.0
  # and the wasm32-unknown-unknown target when you first run cargo commands
  ```
- **wasm32 target** (required for Soroban contracts): `rustup target add wasm32-unknown-unknown`
  - **Note**: This target is automatically installed when you build if `rust-toolchain.toml` is present
- **Stellar CLI** — [install guide](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- **Git**

## Local Setup

```bash
git clone https://github.com/obajecollinsmicheal-cmd/smile4money.git
cd smile4money
cp .env.example .env
# Edit .env with your testnet credentials
```

## Build

```bash
./scripts/build.sh
# or
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
./scripts/test.sh
# or
cargo test
```

Run lints before opening a PR:

```bash
cargo clippy -- -D warnings
```

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Bug fix | `fix/issue-<N>-short-description` | `fix/issue-1-double-initialize` |
| New test | `test/issue-<N>-short-description` | `test/issue-22-cancel-partial-refund` |
| Documentation | `docs/issue-<N>-short-description` | `docs/issue-220-contributing-guide` |
| Feature | `feat/issue-<N>-short-description` | `feat/issue-17-update-oracle` |
| Refactor | `refactor/issue-<N>-short-description` | `refactor/issue-221-workspace-deps` |

Always branch off `master`:

```bash
git checkout master && git pull
git checkout -b fix/issue-<N>-short-description
```

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short summary (≤72 chars)>
```

Types: `fix`, `feat`, `test`, `docs`, `refactor`, `chore`.

Examples:
```
fix: guard initialize against double-call
test: cancel_match refunds only player1 when only player1 deposited
docs: add CONTRIBUTING.md with dev setup and PR guidelines
refactor: move shared deps to workspace-level Cargo.toml
```

## Pull Request Checklist

Before submitting a PR, confirm:

- [ ] `cargo test` passes
- [ ] `cargo clippy -- -D warnings` passes
- [ ] Branch is up to date with `master`
- [ ] PR title is under 70 characters
- [ ] PR body contains `Closes #<N>` for each linked issue
- [ ] New behaviour is covered by tests
- [ ] No secrets or `.env` files are committed

## CI Security: Action Pinning

All third-party GitHub Actions used in `.github/workflows/*.yml` **must** be pinned to their full immutable commit SHA, not to a version tag. This prevents supply-chain attacks where a tag is silently moved to a malicious commit.

```
# ✅ Correct — pinned by SHA with a version comment
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

# ❌ Incorrect — mutable tag reference
- uses: actions/checkout@v4
```

When adding or updating an action:

1. Resolve the SHA by querying the upstream repository.
2. Use the full 40-character SHA after `@`.
3. Append the original version as a trailing comment (e.g. `# v4`).

To resolve the SHA for a tagged action:

```bash
git ls-remote https://github.com/<owner>/<repo>.git refs/tags/<tag>
```

---

## Branch Protection Rules

The `master` branch is protected. The following rules are enforced for all pull requests:

### Required Status Checks

All of the jobs below must pass before a PR can be merged:

| Check | Job name in CI |
|-------|---------------|
| Escrow unit & doc tests | `Escrow Tests` |
| Oracle unit & doc tests | `Oracle Tests` |
| Code coverage ≥ 80 % | `Coverage` |
| Clippy (zero warnings) | `Clippy` |
| Rust formatting | `Format` |
| Prettier (frontend) | `Prettier` |
| WASM build | `Build` |
| environments.toml valid | `Validate environments.toml` |
| Frontend type-check / lint / tests | `Frontend` |
| Backend build (type-check) / tests | `Backend` |

### Required Reviewers

At least **1 approving review** from a repository maintainer is required before merge.

### Merge Policy

- Only **squash merges** are allowed — this keeps the commit history linear and readable.
- Direct pushes to `master` are **blocked** for all contributors, including maintainers.
- Branches must be **up to date** with `master` before merging.

### Setting Up Branch Protection on a Fork

If you are working on a personal fork, you can replicate these rules by following the
[GitHub branch protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

---

## Reporting Issues

Open a GitHub issue with:
- A clear title prefixed with the category (`Fix:`, `Test:`, `Docs:`, `Feat:`)
- Steps to reproduce (for bugs)
- Expected vs actual behaviour

For security vulnerabilities, see [SECURITY.md](SECURITY.md).
