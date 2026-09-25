# ADR-001: 24-Hour Dispute Window for Oracle Results

**Date:** July 2026

**Status:** Accepted

## Context

In the smile4money smart contract system, an Oracle submits verified chess match results to the escrow contract. Once a result is submitted, funds must be transferred to the winner (or returned in case of a draw). However, the Oracle is a critical component that could be compromised, misconfigured, or subject to API errors.

This ADR documents the decision to introduce a **dispute window** — a period during which the admin can override an Oracle result before the payout is executed.

## Problem Statement

A naive implementation would execute payouts immediately upon Oracle result submission. This creates several risks:

1. **Oracle Compromise**: If the Oracle service is hacked or misconfigured, incorrect results are immediately finalized, and payouts cannot be reversed.
2. **API Errors**: A transient Chess.com or Lichess API failure could result in a false game outcome being submitted and locked in.
3. **Oracle Operational Errors**: The Oracle operator may submit a result for the wrong game or match.
4. **No Recourse**: Players have no mechanism to dispute or appeal an incorrect result.

## Decision

We implement a **24-hour dispute window** (`DISPUTE_WINDOW_LEDGERS = 17_280` at 5 seconds per ledger) between Oracle result submission and payout execution.

**Key characteristics:**

- After `submit_result()` is called, the match enters a `PendingResult` state.
- During the dispute window, the **admin** may call `override_result()` to correct the Oracle's submission.
- After the dispute window expires, **anyone** may call `finalize_result()` to execute the payout.
- No payout occurs until one of these two functions is called; funds remain escrowed.

## Rationale

### 24 Hours Chosen Over Alternatives

#### Why Not Immediate Payout?
- **Risk**: Irreversible on-chain payouts cannot be rolled back if the Oracle is wrong.
- **No Recourse**: Players and admins have no opportunity to detect and correct errors.

#### Why Not 1 Hour?
- **Too Short**: Operational overheads (monitoring alerts, investigating claims, coordinating with the Oracle service) typically require several hours.
- **UX**: Players expect quick finality, but 1 hour still leaves significant delay; adds pressure to process disputes under time constraints.

#### Why Not 7 Days or Longer?
- **Poor UX**: Extreme delay creates poor player experience; prizes feel perpetually uncertain.
- **Operational Overhead**: Longer windows increase admin monitoring burden and operational complexity.
- **Opportunity Cost**: Players cannot re-stake capital immediately; reduces platform throughput.

#### Why 24 Hours?
- **Operational Window**: Provides a full business day for admin staff to monitor the system, investigate disputes, and take corrective action (accounting for multiple time zones).
- **Acceptable UX**: 24 hours is a reasonable balance; players understand the delay, yet prizes are finalized within a familiar timeframe.
- **Standard in Finance**: Many financial systems (credit card chargebacks, wire disputes) use 24-hour or 72-hour windows; players are accustomed to this paradigm.
- **Ledger Count**: 24 hours at 5 seconds/ledger = 86,400 seconds / 5 = 17,280 ledgers — a clean, memorable constant.

## Implementation

### Dispute Window Flow

1. **Oracle Result Submission** (`submit_result`)
   - Match transitions to `PendingResult` state
   - `pending_result_ledger` records the current ledger sequence
   - Funds remain in escrow; no payout yet

2. **Admin Override** (`override_result`, during window)
   - Admin may call this function if `current_ledger <= pending_result_ledger + DISPUTE_WINDOW_LEDGERS`
   - Replaces the pending winner with a corrected result
   - Extends the `pending_result_ledger` timestamp (resets the clock)
   - Remains in `PendingResult` state

3. **Payout Execution** (`finalize_result`, after window)
   - **Anyone** may call once `current_ledger > pending_result_ledger + DISPUTE_WINDOW_LEDGERS`
   - Executes payout based on the pending winner
   - Transitions match to `Completed` state
   - Releases funds from escrow

### Code Reference

```rust
// contracts/smile4money-common/src/constants.rs
pub const DISPUTE_WINDOW_LEDGERS: u32 = LEDGERS_PER_DAY; // ~24 hours at 5s/ledger

pub fn submit_result(...) -> Result<(), Error> {
    // ... validation ...
    m.state = MatchState::PendingResult;
    m.pending_result_ledger = env.ledger().sequence();
    m.pending_winner = OptionalWinner::Some(winner);
    // ... persist and emit event ...
}

pub fn override_result(...) -> Result<(), Error> {
    // ... admin auth required ...
    let current = env.ledger().sequence();
    if current > m.pending_result_ledger + DISPUTE_WINDOW_LEDGERS {
        return Err(Error::DisputeWindowExpired);
    }
    m.pending_winner = OptionalWinner::Some(new_winner);
    m.pending_result_ledger = current; // Reset clock
    // ... persist ...
}

pub fn finalize_result(env: Env, match_id: u64) -> Result<(), Error> {
    let current = env.ledger().sequence();
    if current <= m.pending_result_ledger + DISPUTE_WINDOW_LEDGERS {
        return Err(Error::DisputeWindowActive);
    }
    // Execute payout and transition to Completed
}
```

## Trade-offs

### Advantages

1. **Safety**: Provides a window to detect and correct Oracle errors before payouts are irreversible.
2. **Operational Control**: Admin retains ability to intervene if Oracle is compromised or misconfigured.
3. **Player Confidence**: Players know disputes can be addressed; increases trust in the platform.
4. **Standard Practice**: Aligns with financial industry norms for dispute periods.

### Disadvantages

1. **Finality Delay**: Winners must wait 24 hours for confirmed payout; may feel slow compared to instant settlement.
2. **Admin Overhead**: Requires operational monitoring of the dispute window; adds staffing cost.
3. **Smart Contract Complexity**: Adds a third state (`PendingResult`) and two additional functions (`override_result`, `finalize_result`).
4. **Capital Lock-up**: Funds remain escrowed for 24 hours; reduces platform capital efficiency if throughput is volume-dependent.

## Security Considerations

### Admin Authority Risks

The dispute window relies on admin authority to correct errors. This creates a trust assumption:
- **Mitigation**: Rotate admin keys regularly; use multi-sig for admin approval of overrides.
- **Audit Trail**: All overrides emit events; maintain off-chain logs for compliance.

### Oracle Collusion

If the admin and Oracle collude, they could manipulate results without constraint.
- **Mitigation**: This is a general governance risk; addressed by careful key management and decentralized governance in future versions.

### Timeout: Fallback Payout Mechanism

If neither admin nor anyone else calls `finalize_result`, funds would remain locked. A **timeout mechanism** (`claim_timeout`) allows either player to reclaim their stake if no result has been submitted for ~7 days.

## Future Enhancements

1. **Shorter Disputes for High-Volume Matches**: Consider a configurable dispute window for tournaments or league play.
2. **Multi-Sig Admin Override**: Require multiple admin signatures to override results; increases decentralization.
3. **Decentralized Dispute Resolution**: Implement a governance token or DAO to vote on disputed results (v2+).
4. **Oracle Redundancy**: Multiple independent oracles submit results; a majority consensus replaces single-oracle dependency.

## Conclusion

The 24-hour dispute window is a pragmatic safety mechanism that:
- Prevents irreversible errors from immediate Oracle submission
- Provides operational recourse without excessive delay
- Aligns with financial industry standards
- Balances security, UX, and operational simplicity

This decision prioritizes **safety over speed**, ensuring player confidence in the platform's integrity.
