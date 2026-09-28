# Oracle Contract

A Soroban smart contract that records verified chess match results on-chain. It acts as the trusted bridge between off-chain chess platforms (Lichess, Chess.com) and the [Escrow Contract](../escrow/README.md), which reads these results to execute stake payouts.

---

## Table of Contents

- [Overview](#overview)
- [Authorization Model](#authorization-model)
- [Integration with Escrow](#integration-with-escrow)
- [Types](#types)
  - [MatchResult](#matchresult)
  - [ResultEntry](#resultentry)
- [Errors](#errors)
- [Public Functions](#public-functions)
  - [initialize](#initialize)
  - [submit_result](#submit_result)
  - [get_result](#get_result)
  - [has_result](#has_result)
- [Events](#events)
- [Storage](#storage)
- [Security Notes](#security-notes)

---

## Overview

The oracle contract is a simple, append-only result registry. The off-chain oracle service is the only entity that can write to it. Once a result is stored it is immutable — no update or deletion is possible.

```
Off-chain Oracle Service
        │
        │  submit_result(match_id, game_id, result)
        ▼
  Oracle Contract  ──── stores ResultEntry ────► on-chain event
        │
        │  (oracle service then calls escrow)
        ▼
  Escrow Contract
        │  verifies caller == stored oracle address
        │  executes token payout
        ▼
     Players
```

---

## Authorization Model

The oracle contract uses a single **admin** address as its trust anchor. This admin is the keypair controlled by the off-chain oracle service.

- `initialize` sets the admin once and permanently.
- `submit_result` requires `admin.require_auth()` — only a transaction signed by the admin key is accepted.
- There is no admin rotation function on the oracle contract itself. If the admin key needs to change, a new oracle contract must be deployed and the escrow contract's oracle address updated via `escrow.update_oracle()`.
- All other functions (`get_result`, `has_result`) are read-only and require no authorization.

```
                ┌─────────────────────┐
                │  Off-chain Service  │
                │  (holds admin key)  │
                └──────────┬──────────┘
                           │ signs submit_result tx
                           ▼
                ┌─────────────────────┐
                │   Oracle Contract   │
                │  admin.require_auth │
                └──────────┬──────────┘
                           │ result stored
                           ▼
                ┌─────────────────────┐
                │  Escrow Contract    │
                │  caller == oracle?  │
                └─────────────────────┘
```

The escrow contract independently verifies the caller against its own stored oracle address. A compromised oracle contract does not grant direct access to escrow funds — the escrow always performs its own authorization check.

---

## Integration with Escrow

The oracle and escrow contracts are separate deployments that work in sequence. The off-chain oracle service coordinates both calls:

### Full Result Submission Flow

```
1. Escrow emits ("match", "activated") event
        │
        ▼
2. Oracle service detects event, reads match.game_id and match.platform
        │
        ▼
3. Oracle service polls chess platform API until game is finished
        │
        ▼
4. oracle_contract.submit_result(match_id, game_id, MatchResult)
        │  stores result on-chain, emits ("oracle", "result")
        ▼
5. escrow_contract.submit_result(match_id, game_id, Winner, oracle_address)
        │  verifies oracle address, verifies game_id, executes payout
        ▼
6. Escrow emits ("match", "completed"), funds transferred to winner(s)
```

### Result Mapping

| Oracle `MatchResult` | Escrow `Winner` | Payout |
|----------------------|-----------------|--------|
| `Player1Wins` | `Player1` | Winner receives `stake_amount × 2` |
| `Player2Wins` | `Player2` | Winner receives `stake_amount × 2` |
| `Draw` | `Draw` | Each player refunded `stake_amount` |

### Deployment Wiring

The oracle contract address must be registered in the escrow contract at deploy time:

```bash
stellar contract invoke --id $ESCROW_CONTRACT_ID \
  -- initialize \
  --oracle $ORACLE_CONTRACT_ADMIN_ADDRESS \
  --admin $ESCROW_ADMIN_ADDRESS
```

> Note: the escrow contract stores the oracle **service address** (the admin keypair), not the oracle contract address. The oracle contract is an independent on-chain record; the escrow does not call it directly.

---

## Types

### MatchResult

```rust
pub enum MatchResult {
    Player1Wins,
    Player2Wins,
    Draw,
}
```

The outcome of a chess game as determined by the off-chain oracle service.

### ResultEntry

```rust
pub struct ResultEntry {
    pub game_id: String,
    pub result: MatchResult,
}
```

The value stored on-chain for each match result. `game_id` is stored alongside the result so callers can verify which game the result corresponds to.

---

## Errors

| Code | Name | Description |
|------|------|-------------|
| 1 | `Unauthorized` | Caller is not the registered admin |
| 2 | `AlreadySubmitted` | A result has already been stored for this `match_id` |
| 3 | `ResultNotFound` | No result exists for the given `match_id` |
| 4 | `AlreadyInitialized` | Contract has already been initialized |
| 5 | `InvalidGameId` | `game_id` exceeds the 64-byte maximum length |

---

## Public Functions

### `initialize`

Initializes the contract with a trusted admin address. Must be called exactly once before any other function.

```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), Error>
```

**Parameters**

| Name | Type | Description |
|------|------|-------------|
| `admin` | `Address` | The oracle service address; the only address authorized to call `submit_result` |

**Returns** `Ok(())` on success.

**Errors**

| Error | Condition |
|-------|-----------|
| `AlreadyInitialized` | Contract has already been initialized |

**Events**

Emits `("oracle", "init")` with the `admin` address as data.

**Example**

```bash
stellar contract invoke --id $ORACLE_CONTRACT_ID \
  -- initialize \
  --admin $ORACLE_ADMIN_ADDRESS
```

```rust
client.initialize(&admin_address);
```

---

### `submit_result`

Records a verified match result on-chain. Only the registered admin can call this. Each `match_id` can only have one result — submissions are immutable.

```rust
pub fn submit_result(
    env: Env,
    match_id: u64,
    game_id: String,
    result: MatchResult,
) -> Result<(), Error>
```

**Parameters**

| Name | Type | Description |
|------|------|-------------|
| `match_id` | `u64` | The escrow match ID this result corresponds to |
| `game_id` | `String` | The chess platform game identifier (max 64 bytes) |
| `result` | `MatchResult` | The game outcome: `Player1Wins`, `Player2Wins`, or `Draw` |

**Returns** `Ok(())` on success.

**Authorization**

Requires the admin address to authorize the transaction (`admin.require_auth()`). Any other caller receives `Unauthorized`.

**Errors**

| Error | Condition |
|-------|-----------|
| `Unauthorized` | Caller is not the registered admin |
| `InvalidGameId` | `game_id` length exceeds 64 bytes |
| `AlreadySubmitted` | A result already exists for this `match_id` |

**Storage**

Stores a `ResultEntry { game_id, result }` keyed by `DataKey::Result(match_id)` in persistent storage with a TTL of ~30 days (518,400 ledgers).

**Events**

Emits `("oracle", "result")` with data `(match_id, result)`.

**Example**

```bash
stellar contract invoke --id $ORACLE_CONTRACT_ID \
  -- submit_result \
  --match_id 0 \
  --game_id "lichess-game-abc123" \
  --result '{"Player1Wins": {}}'
```

```rust
client.submit_result(
    &match_id,
    &String::from_str(&env, "lichess-game-abc123"),
    &MatchResult::Player1Wins,
);
```

---

### `get_result`

Returns the stored `ResultEntry` for a given match ID.

```rust
pub fn get_result(env: Env, match_id: u64) -> Result<ResultEntry, Error>
```

**Parameters**

| Name | Type | Description |
|------|------|-------------|
| `match_id` | `u64` | The match ID to look up |

**Returns** `Ok(ResultEntry)` containing the `game_id` and `result`.

**Errors**

| Error | Condition |
|-------|-----------|
| `ResultNotFound` | No result has been submitted for this `match_id` |

**Authorization**

None — this is a read-only function, callable by anyone.

**Example**

```bash
stellar contract invoke --id $ORACLE_CONTRACT_ID \
  -- get_result \
  --match_id 0
```

```rust
let entry = client.get_result(&match_id);
// entry.game_id  => "lichess-game-abc123"
// entry.result   => MatchResult::Player1Wins
```

---

### `has_result`

Returns whether a result has been submitted for a given match ID. Useful for checking before calling `get_result`.

```rust
pub fn has_result(env: Env, match_id: u64) -> bool
```

**Parameters**

| Name | Type | Description |
|------|------|-------------|
| `match_id` | `u64` | The match ID to check |

**Returns** `true` if a result exists, `false` otherwise. Never returns an error.

**Authorization**

None — this is a read-only function, callable by anyone.

**Example**

```bash
stellar contract invoke --id $ORACLE_CONTRACT_ID \
  -- has_result \
  --match_id 0
```

```rust
if client.has_result(&match_id) {
    let entry = client.get_result(&match_id);
}
```

---

## Events

| Topics | Data | Emitted By |
|--------|------|------------|
| `("oracle", "init")` | `admin: Address` | `initialize` |
| `("oracle", "result")` | `(match_id: u64, result: MatchResult)` | `submit_result` |

These events are consumed by the off-chain oracle service and any indexers monitoring the contract.

---

## Storage

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `DataKey::InstanceState` | `InstanceState` | Instance | Contract lifetime | The authorized oracle service address and total result count, loaded together on submission |
| `DataKey::Result(match_id)` | `ResultEntry` | Persistent | ~30 days (518,400 ledgers) | Stored result per match |

Persistent entries have their TTL refreshed to 518,400 ledgers on every write to prevent expiry during an active match window.

---

## Security Notes

- **Immutable results**: Once a result is submitted for a `match_id`, it cannot be overwritten or deleted. `AlreadySubmitted` is returned on any duplicate attempt.
- **Single admin**: Only the admin address set at initialization can submit results. There is no multi-sig or rotation mechanism on this contract — key management is the responsibility of the off-chain oracle service.
- **Independent from escrow**: The oracle contract only stores results. It does not hold funds and has no access to the escrow contract. A compromised oracle contract cannot directly move funds.
- **Escrow re-verifies**: The escrow contract independently checks that `caller == stored oracle address` before executing any payout. The oracle contract record is supplementary — the escrow's own authorization is the final gate.
- **game_id binding**: The `game_id` is stored in the `ResultEntry` and must match the escrow match's `game_id` when the oracle service calls `escrow.submit_result`. This prevents a result for one game being applied to a different match.
- **No admin rotation**: If the admin key is compromised, deploy a new oracle contract and call `escrow.update_oracle()` with the new address.
