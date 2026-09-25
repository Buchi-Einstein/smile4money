# Oracle Design

## Overview

The oracle is the bridge between off-chain chess platforms (Lichess, Chess.com) and the on-chain escrow contract. It is the only address authorised to call `submit_result` on the escrow contract.

## Components

### Oracle Contract (`contracts/oracle`)

An on-chain Soroban contract that:

- Stores verified results keyed by `match_id`
- Accepts result submissions only from the registered admin (the oracle service key)
- Prevents duplicate submissions for the same `match_id`
- Emits an on-chain event for every accepted result

### Off-chain Oracle Service

A backend process that:

1. Monitors the escrow contract for `("match", "activated")` events
2. Extracts `game_id` and `platform` from the match record
3. Polls the appropriate chess platform API until the game is finished
4. Submits the result to the Oracle Contract using the admin key
5. Calls `submit_result` on the Escrow Contract to trigger payout

## Result Submission Flow

```
Chess platform API
       │  game finished
       ▼
Oracle Service
  1. fetch game result
  2. map to MatchResult enum
  3. oracle_contract.submit_result(match_id, game_id, result)
  4. escrow_contract.submit_result(match_id, winner, oracle_address)
       │
       ▼
Escrow Contract
  - verifies caller == stored oracle address
  - verifies match state == Active
  - executes token payout
  - sets state = Completed
  - emits ("match", "completed") event
```

## Result Types

| Oracle `MatchResult` | Escrow `Winner` | Payout |
|----------------------|-----------------|--------|
| `Player1Wins` | `Player1` | Full pot to player1 |
| `Player2Wins` | `Player2` | Full pot to player2 |
| `Draw` | `Draw` | `stake_amount` returned to each player |

## Supported Platforms

| Platform | Enum Variant | API |
|----------|-------------|-----|
| Lichess | `Platform::Lichess` | `https://lichess.org/api/game/{id}` |
| Chess.com | `Platform::ChessDotCom` | `https://api.chess.com/pub/game/{id}` |

## Oracle Contract API

```
initialize(admin: Address)
submit_result(match_id: u64, game_id: String, result: MatchResult) -> Result<(), Error>
get_result(match_id: u64) -> Result<ResultEntry, Error>
has_result(match_id: u64) -> bool
```

### Errors

| Error | Code | Meaning |
|-------|------|---------|
| `Unauthorized` | 1 | Caller is not the admin |
| `AlreadySubmitted` | 2 | Result already exists for this match |
| `ResultNotFound` | 3 | No result stored for this match |
| `AlreadyInitialized` | 4 | Contract has already been initialized |

## Security Properties

- The oracle admin key is the only address that can submit results; any other caller is rejected with `Error::Unauthorized`.
- Once a result is submitted it is immutable — `AlreadySubmitted` prevents overwriting.
- The escrow contract independently verifies the caller against its stored oracle address before executing any payout.
- The oracle contract and escrow contract are separate deployments; a compromised oracle contract does not grant direct access to escrow funds.

## Polling Interval and Job Scheduling

### Polling interval (`POLLING_INTERVAL_MS`)

The off-chain oracle service polls each active match's chess-platform API on a fixed cadence to
detect when the game reaches a terminal state (win, loss, or draw). The cadence is set by
`POLLING_INTERVAL_MS` (milliseconds) and **defaults to 30 000 ms (30 s)**. On each poll the
service checks the game status; once a terminal result is detected it immediately submits the
result on-chain and stops polling that match.

### Max polling attempts (`MAX_POLLING_ATTEMPTS`) and the active-monitoring window

`MAX_POLLING_ATTEMPTS` caps how many times a single match is polled before it is treated as
unresolvable and moved to the dead-letter queue (DLQ). It **defaults to 1440**.

These two values define the **active-monitoring window** for one match:

```
1440 attempts × 30 s/attempt = 43 200 s ≈ 12 hours
```

So the oracle actively watches a match for **~12 hours** after activation. If the game has not
finished within that window, the job is parked in the DLQ (a `max attempts exceeded` alert is
emitted, see `polling_job_max_attempts_exceeded_moving_to_dlq`) and the match remains `Active`
on-chain; players can still call `claim_timeout` once the timeout window elapses (see below).

### Backoff (`POLLING_BACKOFF_MULTIPLIER`)

The delay before the next poll for an in-progress game is
`POLLING_INTERVAL_MS × POLLING_BACKOFF_MULTIPLIER ^ attempt`.
`POLLING_BACKOFF_MULTIPLIER` **defaults to 1.0**, i.e. **no backoff** — every attempt is spaced
exactly 30 s apart, which is what yields the ~12-hour window above. Raising the multiplier (e.g.
`1.5`) spreads retries out with exponential backoff, lengthening the total window while the
attempt count stays at 1440.

### Relationship to `TIMEOUT_LEDGERS`

`TIMEOUT_LEDGERS` is **120 960 ledgers (≈ 7 days at 5 s/ledger)**
(`contracts/escrow/src/lib.rs:98`). It is the on-chain safety net: if the oracle never submits a
result within that window, either player can call `claim_timeout` to recover their stake.

The polling service is designed so that the active-monitoring window sits **well inside** the
on-chain timeout:

- Polling gives **~12 hours** of active monitoring per match (configurable via the constants above).
- The 7-day `TIMEOUT_LEDGERS` window is the **trustless fallback** that protects players when the
  oracle service is down, the DLQ is not being drained, or a game runs far longer than expected.
- A match that exhausts its 1440 polling attempts (≈12 h) still has roughly **6.5 days** of
  on-chain protection remaining before `claim_timeout` becomes available.

Operators should confirm their polling/DLQ config comfortably fits inside the 7-day
`TIMEOUT_LEDGERS` window. Because 12 h ≪ 7 days, the default polling config **covers** the match
timeout with large margin; only a misconfigured `MAX_POLLING_ATTEMPTS` near or above
~20 160 attempts (7 days ÷ 30 s) would begin to encroach on it.

### Configuration

The values above are supplied via the `PollingConfig` object passed to `PollingWorker`
(`apps/backend/src/services/polling.ts`). The default constants are:

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `POLLING_INTERVAL_MS` | `30000` | Base poll interval (30 s) |
| `MAX_POLLING_ATTEMPTS` | `1440` | Attempts before DLQ (~12 h window) |
| `POLLING_BACKOFF_MULTIPLIER` | `1.0` | Backoff factor (1.0 = no backoff) |

Usage in code:

```ts
const worker = new PollingWorker(store, poller, {
  pollingIntervalMs: 30_000,
  maxPollingAttempts: 1440,
  backoffMultiplier: 1.0,
});
```

## Configuration

Set the oracle admin key in `.env`:

```env
ORACLE_ADMIN_SECRET=<stellar-secret-key>
```

The oracle address is registered in the escrow contract at deploy time:

```bash
stellar contract invoke --id $CONTRACT_ESCROW \
  -- initialize \
  --oracle $ORACLE_ADDRESS \
  --admin $ADMIN_ADDRESS
```
