# Deployment Guide

This document covers end-to-end deployment of smile4money contracts to Stellar testnet and mainnet.

## Verifying CI Build Artifacts

Every CI build on the `master` branch uploads the compiled WASM binaries as a downloadable artifact. This allows you to verify that a deployed contract matches a specific commit's source code.

### Reproducible Builds

All WASM builds use a pinned Docker image (`stellar/soroban-rust:21.0.0`) to ensure reproducibility. This means:

- The same source code will always produce identical WASM bytecode
- Different machines will produce the same hashes
- Contract users can verify deployed bytecode matches the source

### Downloading an artifact

1. Navigate to the [Actions tab](https://github.com/{{repo}}/actions) on GitHub.
2. Select the CI run for the commit you want to verify.
3. In the **Artifacts** section, download the `wasm-<commit-sha>` archive.
4. Extract the archive to get the `.wasm` files.

### Verifying a deployed contract

Compare the WASM hash from the artifact against the deployed contract:

```bash
# Download and extract the artifact for the target commit
unzip wasm-<sha>.zip -d wasm-artifact

# Compute the hash of the local artifact
sha256sum wasm-artifact/*.wasm

# On-chain: use stellar contract inspect to get the contract's WASM hash
stellar contract inspect \
  --id <CONTRACT_ID> \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"
```

The WASM hash displayed by `stellar contract inspect` should match the `sha256sum` output for the corresponding artifact file, confirming the deployed bytecode matches the source at that commit.

### Local Reproducible Build

To reproduce the build locally and verify it matches CI:

```bash
# Checkout the target commit
git checkout <commit-sha>

# Build using the same pinned Docker image as CI
docker run --rm -v "$(pwd):/workspace" -w /workspace stellar/soroban-rust:21.0.0 cargo build --release --target wasm32-unknown-unknown

# Compare the hash with the CI artifact
sha256sum target/wasm32-unknown-unknown/release/*.wasm
```

The local build should produce identical hashes to the CI artifact.

## Prerequisites

- **Rust toolchain** (1.70+) with `wasm32-unknown-unknown` target:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI** — install from the [official docs](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- **Stellar deployer account** funded with XLM (testnet XLM is free via Friendbot; mainnet requires real XLM)
- **`git`** checkout of the repository at the commit to deploy

## Testnet Deployment

### 1. Create and fund a deployer identity

```bash
stellar keys generate deployer --network testnet
```

This creates a local keypair named `deployer` and registers it for the `testnet` network. To view the public address:

```bash
stellar keys address deployer
```

If the account has not been used before, it needs a minimum XLM balance. The deploy script funds it automatically via Friendbot, but you can also fund it manually:

```bash
curl -sf "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

**Expected output:**
```json
{"message": "Account created!", "hash": "..."}
```

### 2. Run the deploy script

```bash
./scripts/deploy_testnet.sh
```

The script performs these steps in order:

1. Verifies the `stellar` CLI is installed and the `deployer` identity exists.
2. Funds the deployer via Friendbot (no-op if already funded).
3. Builds both contracts (`escrow.wasm`, `oracle.wasm`) in release mode.
4. Deploys the escrow contract to testnet.
5. Deploys the oracle contract to testnet.
6. Initializes the oracle contract (admin = deployer address).
7. Initializes the escrow contract (oracle = oracle contract address, admin = deployer address).
8. Writes `CONTRACT_ESCROW` and `CONTRACT_ORACLE` to `.env`.

**Expected output:**
```
Deployer: GABCDEF123...
Funding deployer account via friendbot...
Building contracts...
Deploying escrow contract...
Escrow contract: CC123...
Deploying oracle contract...
Oracle contract: CC456...
Initializing oracle contract...
Initializing escrow contract...

Deployment complete.
  Escrow:  CC123...
  Oracle:  CC456...
Contract IDs written to .env
```

### 3. Verify the deployment

Check that contract IDs were written to `.env`:

```bash
grep -E "^(CONTRACT_ESCROW|CONTRACT_ORACLE)=" .env
```

Verify the contracts are live and responsive:

```bash
# Check escrow contract is queryable (should return match count 0)
stellar contract invoke \
  --id "$(grep CONTRACT_ESCROW .env | cut -d= -f2)" \
  --source deployer \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- get_match \
  --match_id 0

# Check oracle contract is queryable
stellar contract invoke \
  --id "$(grep CONTRACT_ORACLE .env | cut -d= -f2)" \
  --source deployer \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- has_result \
  --match_id 0
```

If the contracts are deployed correctly, `has_result` returns `false` and `get_match` returns `Error::MatchNotFound` (the contract is live and rejecting invalid queries properly).

### 4. Configure the off-chain oracle

After deployment, populate the remaining `.env` fields:

```env
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ESCROW=<contract-id-from-deploy>
CONTRACT_ORACLE=<contract-id-from-deploy>
LICHESS_API_TOKEN=<your-lichess-api-token>
CHESSDOTCOM_API_KEY=<your-chessdotcom-api-key>
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

These values are used by the off-chain oracle service and the frontend.

## Mainnet Deployment

Mainnet deployment follows the same steps but with additional precautions because transactions are irreversible and consume real XLM.

### Pre-deploy review checklist

- [ ] All CI jobs pass on the commit being deployed (test, clippy, fmt, build).
- [ ] Security audit (`cargo audit`) reports zero unresolved advisories.
- [ ] Contracts have been live on testnet for at least one full test cycle.
- [ ] A dedicated deployer key is used — never a personal or shared key.
- [ ] The deployer account is funded with sufficient XLM to cover deploy + init fees (approximately 10–20 XLM).
- [ ] The commit to deploy has been reviewed and approved by at least one other team member.
- [ ] A rollback plan exists (redeploying previous contract IDs).
- [ ] The `.env` file from the previous testnet deploy is backed up separately (not overwritten).

### 1. Create a mainnet deployer identity

```bash
stellar keys generate deployer --network mainnet
```

### 2. Fund the deployer account

Send real XLM to the deployer address:

```bash
stellar keys address deployer
# Send XLM to the output address from a funded Stellar account or exchange
```

The account needs enough for:
- Escrow contract deploy fee
- Oracle contract deploy fee
- Two initialization invocations
- Minimum account balance (~1 XLM)

10–20 XLM is a comfortable buffer.

### 3. Run the deploy script

```bash
./scripts/deploy_mainnet.sh
```

The script is identical to the testnet version except:
- Targets `mainnet` network and RPC endpoints.
- Does **not** call Friendbot (no Friendbot exists for mainnet).
- Prompts for confirmation before proceeding.
- Updates all `STELLAR_NETWORK` and `VITE_STELLAR_NETWORK` fields in `.env` to `mainnet`.

**Expected output:**
```
Deployer: GXYZ...
Network:  mainnet (PUBLIC — real XLM will be spent)

WARNING: This will deploy contracts to the Stellar PUBLIC network.
         Transactions are irreversible and will consume real XLM.

Type exactly "yes" to confirm mainnet deployment: yes
Building contracts...
Deploying escrow contract...
Escrow contract: CC789...
Deploying oracle contract...
Oracle contract: CC012...
Initializing oracle contract...
Initializing escrow contract...

Mainnet deployment complete.
  Escrow:  CC789...
  Oracle:  CC012...
Contract IDs written to .env
```

### 4. Post-deploy verification

Run the same verification as testnet (step 3 above), but use mainnet RPC and passphrase:

```bash
MAINNET_RPC="https://soroban-mainnet.stellar.org"
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"

stellar contract invoke \
  --id "$CONTRACT_ESCROW" \
  --source deployer \
  --network mainnet \
  --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" \
  -- get_match \
  --match_id 0

stellar contract invoke \
  --id "$CONTRACT_ORACLE" \
  --source deployer \
  --network mainnet \
  --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" \
  -- has_result \
  --match_id 0
```

Additionally:

- [ ] Record contract IDs in a secure, durable location (e.g., a password manager, team wiki, or a GitHub release).
- [ ] Verify the admin and oracle addresses stored on-chain are correct with `stellar contract inspect`.
- [ ] Run a smoke test: create a test match, deposit stake, and cancel it to verify the full flow.
- [ ] Update the frontend configuration with the new mainnet contract IDs and network.

## Rollback Procedure (Mainnet)

Soroban contract IDs are immutable. A rollback therefore means deploying the previously
approved WASM again as new contract instances and switching clients to those new IDs; it does
not replace the faulty instances or restore their storage. Do not start this procedure until the
previous release's WASM artifacts, commit, SHA-256 hashes, contract IDs, and initialization
parameters have been recovered from the deployment record.

### 1. Declare the incident and freeze writes

1. Pause the affected escrow contract using the procedure in [the incident runbook](runbook.md).
2. Stop the oracle worker and frontend writes so no new match or result transactions are submitted.
3. Preserve logs, transaction hashes, the current `deployments/mainnet.json`, and a copy of `.env`.
4. Post an incident notice in the status channel and any user-facing support channel:

   ```text
   [INCIDENT] Mainnet rollback started at <UTC time>.
   Affected release: <commit/hash>
   Impact: new wagers and result submissions are temporarily paused.
   Funds already recorded on-chain remain on-chain; do not submit duplicate deposits.
   Next update: <time or cadence>
   ```

   Update the notice when the rollback is complete, include the replacement contract IDs, and
   explicitly tell users when creating matches and submitting results is safe again. Keep the
   incident notice and final resolution available for users who were offline during the event.

### 2. Recover and verify the previous WASM

Download the `wasm-<commit-sha>` CI artifact for the last approved commit, or build that exact
commit with the pinned reproducible-build image. Verify both hashes before spending mainnet XLM:

```bash
git show <approved-commit>:Cargo.toml >/dev/null
unzip wasm-<approved-commit>.zip -d rollback-wasm
sha256sum rollback-wasm/*.wasm
```

Compare the result with the hashes recorded for that release. If an artifact or hash is missing,
stop and investigate; never roll back using an unverified local build.

### 3. Deploy new instances from the previous WASM

The normal deployment script builds the current checkout, so do not run it for a rollback unless
the checkout has first been pinned to the approved commit. From that clean checkout, run the
script after confirming its mainnet prompt, or use the equivalent commands below when the
artifact has been independently verified:

```bash
MAINNET_RPC="https://soroban-mainnet.stellar.org"
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
DEPLOYER="deployer"
ADMIN="<admin-address>"

ROLLBACK_ORACLE=$(stellar contract deploy \
  --wasm rollback-wasm/oracle.wasm --source "$DEPLOYER" --network mainnet \
  --rpc-url "$MAINNET_RPC" --network-passphrase "$MAINNET_PASSPHRASE")

stellar contract invoke --id "$ROLLBACK_ORACLE" --source "$DEPLOYER" \
  --network mainnet --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" -- initialize --admin "$ADMIN"

ROLLBACK_ESCROW=$(stellar contract deploy \
  --wasm rollback-wasm/escrow.wasm --source "$DEPLOYER" --network mainnet \
  --rpc-url "$MAINNET_RPC" --network-passphrase "$MAINNET_PASSPHRASE")

stellar contract invoke --id "$ROLLBACK_ESCROW" --source "$DEPLOYER" \
  --network mainnet --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" -- initialize \
  --oracle "$ROLLBACK_ORACLE" --admin "$ADMIN"
```

Fund the replacement escrow with the same 1.5 XLM reserve buffer used by the deployment
scripts, then run the [WASM hash check](#verify-deployment--wasm-hash-check) against both new
IDs. Existing matches and balances are not migrated by this procedure. Reconcile or drain any
affected state according to the incident plan before directing users to the replacement.

### 4. Update the registry and configuration

Back up the current configuration, then update the `CONTRACT_ESCROW` and `CONTRACT_ORACLE`
values to the replacement IDs and record them in `deployments/mainnet.json`. If the registry is
deployed, use its admin identity to remove and re-register the affected service entries, or use
`update_contract` for an existing entry when the registry integration supports that operation:

```bash
REGISTRY_ID="<contract-registry-id>"

stellar contract invoke --id "$REGISTRY_ID" --source "$DEPLOYER" \
  --network mainnet --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" -- deregister_contract \
  --caller "$ADMIN" --contract_id escrow
stellar contract invoke --id "$REGISTRY_ID" --source "$DEPLOYER" \
  --network mainnet --rpc-url "$MAINNET_RPC" \
  --network-passphrase "$MAINNET_PASSPHRASE" -- register_contract \
  --caller "$ADMIN" --contract_id escrow
```

Repeat the two calls with `oracle` as the service symbol. The current registry contract stores
service symbols, not Stellar contract addresses, and `update_contract` only refreshes the
existing entry. Therefore the registry integration or its backing configuration must also be
updated with `ROLLBACK_ESCROW` and `ROLLBACK_ORACLE`; verify the values returned to clients
before resuming traffic. Do not deregister an entry until the replacement configuration is ready.

### 5. Verify, resume, and communicate

- Inspect both replacement contracts and compare their WASM hashes with the approved release.
- Verify the registry/configuration resolves to the replacement IDs.
- Run a small end-to-end smoke test, then restart the oracle worker and frontend with the updated
  configuration.
- Unpause the replacement escrow only after the smoke test succeeds.
- Post the final user notice with the UTC completion time, replacement IDs, resolved impact, and
  any action users must take. Keep the faulty IDs blocked from new traffic and retain the full
  incident timeline.

### Testnet rollback rehearsal

Run this rehearsal before every mainnet release using two successive testnet deployments. Save
the old and replacement IDs, transaction hashes, WASM hashes, registry query output, and the
user-notification timestamps in the release record. A successful rehearsal must show:

| Check | Result to record |
| --- | --- |
| Previous release WASM hashes match the downloaded artifacts | Pass / hash values |
| Replacement oracle and escrow initialize with the expected admin and oracle | Pass / transaction hashes |
| Replacement escrow reserve is funded and both contracts respond to read-only calls | Pass / IDs |
| Registry/configuration resolves to the replacement IDs after the update | Pass / query output |
| Pause, user notice, resume, and final notice were completed in order | Pass / UTC timestamps |

The repository-level registry authorization and update behavior can be checked with:

```bash
cargo test -p contract-registry
```

Do not mark the rehearsal complete from this unit test alone: the release record must contain the
actual testnet transaction hashes and query results from the commands above.

## Verify Deployment — WASM Hash Check

After deploying to either testnet or mainnet, confirm that the on-chain bytecode matches the
locally compiled artifact. This is a critical step for financial contracts: it proves that no
substitution occurred between build and deploy.

### Step 1 — Compute the local hash

Build the contracts in release mode (or locate the build output from CI):

```bash
cargo build --target wasm32-unknown-unknown --release
```

The compiled artifacts are written to:

```
target/wasm32-unknown-unknown/release/escrow.wasm
target/wasm32-unknown-unknown/release/oracle.wasm
```

Compute their SHA-256 hashes:

```bash
sha256sum \
  target/wasm32-unknown-unknown/release/escrow.wasm \
  target/wasm32-unknown-unknown/release/oracle.wasm
```

Example output:

```
a3f1...  target/wasm32-unknown-unknown/release/escrow.wasm
9c02...  target/wasm32-unknown-unknown/release/oracle.wasm
```

### Step 2 — Retrieve the on-chain hash

Use `stellar contract inspect` to read the WASM hash stored on-chain for each deployed
contract. Replace `<CONTRACT_ID>` and network flags as appropriate.

**Testnet:**

```bash
stellar contract inspect \
  --id "$CONTRACT_ESCROW" \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

stellar contract inspect \
  --id "$CONTRACT_ORACLE" \
  --network testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

**Mainnet:**

```bash
stellar contract inspect \
  --id "$CONTRACT_ESCROW" \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"

stellar contract inspect \
  --id "$CONTRACT_ORACLE" \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"
```

The command prints the WASM hash reported by the ledger, for example:

```
wasm_hash: a3f1...
```

### Step 3 — Compare

The `sha256sum` output for `escrow.wasm` must match the `wasm_hash` field returned by
`stellar contract inspect` for `CONTRACT_ESCROW`, and likewise for the oracle contract.

**If the hashes match**: the deployed bytecode is byte-for-byte identical to the local build.

**If the hashes do not match**: do not proceed. The on-chain contract does not correspond to the
audited source. Investigate whether the wrong build artifact was uploaded, or whether the
contract was upgraded after deployment without updating the local copy.

Add this check to your post-deploy checklist:

```
- [ ] sha256sum of escrow.wasm matches CONTRACT_ESCROW wasm_hash on-chain
- [ ] sha256sum of oracle.wasm matches CONTRACT_ORACLE wasm_hash on-chain
```

## Troubleshooting

### `stellar: command not found`

The Stellar CLI is not installed or not in `PATH`.

**Fix:** Install from https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

### `identity 'deployer' not found`

The deployer keypair has not been created yet.

**Fix:**
```bash
stellar keys generate deployer --network testnet
```

### `Account does not exist` or `insufficient funds`

The deployer account has no XLM balance.

**Fix (testnet):** The deploy script funds via Friendbot automatically. If it fails, run manually:
```bash
curl -sf "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

**Fix (mainnet):** Send real XLM to the deployer address from a funded account.

### `wasm file not found after build`

The WASM build failed or produced output in an unexpected location.

**Fix:** Run the build separately to see errors:
```bash
cargo build --target wasm32-unknown-unknown --release
```
Common causes:
- Missing `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Rust toolchain too old: `rustup update`
- Compilation errors in contract code

### `Invoke failed: Error::AlreadyInitialized`

One of the contracts was already initialized. This happens if the deploy script was run twice without deploying new contracts.

**Fix:** Deploy fresh contracts (the script deploys new instances each run). If you want to re-use existing contracts, skip initialization and just update `.env` with the existing IDs.

### `Invoke failed: error decoding response: ...`

The contract invocation succeeded but the response format was unexpected. This usually means the contract is live and responding — check that the function name and arguments match the contract interface.

**Fix:** Verify you are using the correct function name and parameter types. See `docs/api-reference.md` for the full contract API.

### Timeout during deploy or invoke

Network congestion or RPC endpoint issues.

**Fix:** Retry the command. If the problem persists, verify the RPC endpoint is healthy:
```bash
curl -s <rpc-url> | head -20
```
You can also increase timeouts with the `--timeout` flag on `stellar` commands.
