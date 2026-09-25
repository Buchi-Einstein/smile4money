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
6. Fetches each deployed WASM hash with `stellar contract inspect` and compares it to the local artifact SHA-256.
7. Initializes the oracle contract (admin = deployer address).
8. Initializes the escrow contract (oracle = oracle contract address, admin = deployer address).
9. Writes `CONTRACT_ESCROW` and `CONTRACT_ORACLE` to `.env`.

The script stops with an error if either on-chain hash does not match the local build artifact. Successful checks log both hash values.

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
