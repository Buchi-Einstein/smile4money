# Contributing to smile4money

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- **Rust** 1.70+ with the `wasm32-unknown-unknown` target
- **Stellar CLI** — [install guide](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- **Git**

Install the WASM target if you haven't already:

```bash
rustup target add wasm32-unknown-unknown
```

## Local Setup

```bash
git clone https://github.com/obajecollinsmicheal-cmd/smile4money.git
cd smile4money
cp .env.example .env
```

## Build

```bash
./scripts/build.sh
# or directly:
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
./scripts/test.sh
# or directly:
cargo test
```

Run clippy before opening a PR:

```bash
cargo clippy -- -D warnings
```

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Bug fix | `fix/issue-<N>-short-description` | `fix/issue-1-double-initialize` |
| New test | `test/issue-<N>-short-description` | `test/issue-21-unauthorized-deposit` |
| Documentation | `docs/issue-<N>-short-description` | `docs/issue-104-contributing-guide` |
| Feature | `feat/issue-<N>-short-description` | `feat/issue-17-update-oracle` |

Always branch off `master`:

```bash
git checkout master
git pull
git checkout -b fix/issue-<N>-short-description
```

## Commit Style

Use the conventional commits format:

```
<type>: <short summary>
```

Common types: `fix`, `feat`, `test`, `docs`, `refactor`, `chore`.

Examples:
```
fix: guard initialize against double-call
test: add unauthorized deposit test for issue #21
docs: add contributing guide
```

## Opening a Pull Request

1. Push your branch and open a PR against `master`.
2. Link the issue in the PR body using `Closes #<N>`.
3. Keep the PR title under 70 characters.
4. Ensure `cargo test` and `cargo clippy -- -D warnings` pass — CI will check both.
5. Add a brief description of what changed and how it was tested.

## Branch Protection Rules

The `master` branch is protected. The following rules apply to all pull requests:

### Required Status Checks

Every PR must pass these CI jobs before it can be merged:

| Check | CI job |
|-------|--------|
| Escrow unit & doc tests | `Escrow Tests` |
| Oracle unit & doc tests | `Oracle Tests` |
| Code coverage ≥ 80 % | `Coverage` |
| Clippy (zero warnings) | `Clippy` |
| Rust formatting | `Format` |
| Prettier (frontend) | `Prettier` |
| WASM build | `Build` |
| environments.toml validation | `Validate environments.toml` |
| Frontend type-check / lint / tests | `Frontend` |
| Backend build (type-check) / tests | `Backend` |

### Required Reviewers

At least **1 approving review** from a maintainer is required.

### Merge Policy

- **Squash merge only** — keeps history linear.
- **No direct pushes** to `master` — always open a PR.
- Branches must be **up to date** with `master` before the merge button is enabled.

### Setting Up Protections on a Fork

Refer to the [GitHub branch protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) to mirror these rules on your fork.

---

## Reporting Issues

Open a GitHub issue with:
- A clear title matching the category (`Fix:`, `Test:`, `Doc:`, etc.)
- Steps to reproduce (for bugs)
- Expected vs actual behaviour

For security vulnerabilities, add the `security` label and contact the maintainers before public disclosure.
