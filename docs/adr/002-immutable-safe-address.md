# ADR-002: Immutable `safe_address` for `emergency_drain`

**Date:** August 2026

**Status:** Accepted

## Context

The escrow contract holds player stakes in escrow and is controlled by an `admin`
address. In an emergency (e.g. a critical vulnerability, a paused contract that
needs to be drained, or a compromised deployment), the admin must be able to move
all escrowed funds out of the contract. This is performed by `emergency_drain`.

The destination of that drain is the central security question:

- If the destination is chosen **at the time `emergency_drain` is called** (a
  runtime parameter), then whoever controls the admin key — or anyone who can
  trick the admin key — can redirect **all** player funds to **any** address.
- If the destination is **fixed at initialization** and cannot be changed, then
  even a fully compromised admin key can only ever send funds to the one
  pre-committed, publicly-known safe address.

This ADR records the decision to fix `safe_address` **immutably** at
`initialize` time and to remove the destination parameter from `emergency_drain`.

## Problem Statement

A naive `emergency_drain(to: Address)` signature introduces a **rug-pull vector**:

1. **Malicious admin**: A disgruntled or bribed admin calls
   `emergency_drain(attacker_address)` and silently exfiltrates 100% of escrowed
   funds.
2. **Compromised key**: If the admin key is leaked (phishing, weak custody), the
   attacker gains a direct, one-call `transferAll` primitive to any address they
   control.
3. **Privilege escalation via bug**: Any logic bug that lets an unauthorized
   caller reach `emergency_drain` is catastrophic if the destination is
   attacker-controlled.
4. **No recourse**: Once the funds are drained to an arbitrary address, the
   transfer is irreversible; players cannot recover stakes.

The contract already requires `emergency_drain` to be called by the admin and
while the contract is paused, which mitigates *who* can call it. But it does
nothing about *where the money goes*.

## Decision

We split the concern into two distinct moments:

- **At `initialize`**: the deployer supplies `safe_address`, which is stored once
  under `DataKey::SafeAddress` and **never updated**. There is no setter, no
  admin override, and no `transfer_admin`-style mutation path for it.
- **At `emergency_drain`**: the function signature is `emergency_drain(env, caller)`
  — it takes **no destination argument**. It reads the immutable `safe_address`
  and transfers the full token balance there.

`initialize` (contracts/escrow/src/lib.rs:264) stores the address:

```rust
env.storage()
    .instance()
    .set(&DataKey::SafeAddress, &safe_address);
```

`emergency_drain` (contracts/escrow/src/lib.rs:1057) reads it and has no `to`
parameter:

```rust
pub fn emergency_drain(env: Env, caller: Address) -> Result<(), Error> {
    // ... admin + paused checks ...
    let safe_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::SafeAddress)
        .ok_or(Error::Unauthorized)?;
    // ... transfer(&contract, &safe_address, &balance) ...
}
```

The doc comments on both functions state explicitly that the `to` parameter has
been *intentionally removed* to eliminate the rug-pull vector.

## Rationale

### Why Immutable-At-Initialization Was Chosen Over a Runtime Parameter

#### Alternative A — `emergency_drain(to: Address)` (runtime destination)
- **Rejected**: provides a one-step `transferAll(to_anyone)` primitive for the
  admin. This is exactly the rug-pull path described above. It converts a
  compromised admin key into total loss of player funds.

#### Alternative B — Mutable `safe_address` with an admin setter
- **Rejected**: an admin who can change `safe_address` can first point it at an
  attacker address, then drain. The immutability guarantee is lost; the only
  difference from Alternative A is the number of transactions required.
- A setter also expands the attack surface (another authorized, state-changing
  entry point) for marginal operational benefit.

#### Alternative C — `safe_address` fixed immutably at `initialize` (chosen)
- **Eliminates the rug-pull vector entirely**: the destination is committed
  before any funds are ever escrowed and is visible on-chain for anyone to
  audit. A compromised admin can only ever return funds to the *known* safe
  address, not to themselves.
- **Auditability**: because `initialize` is a single, well-known transaction,
  the safe address is verifiable by players, auditors, and automated monitors
  before they deposit.
- **Principle of least privilege**: `emergency_drain` becomes a "return funds to
  the pre-committed safe" operation rather than an arbitrary payment. Its blast
  radius is bounded regardless of who calls it.

#### Why Not Make `safe_address` a Constant in Code?
- Hard-coding the safe address into the WASM would forbid redeployment to a new
  safe address without a contract upgrade, and would prevent different safe
  addresses per environment (testnet vs mainnet). Supplying it at `initialize`
  keeps the WASM reusable while still committing the value immutably per
  deployment.

## Implementation Notes

- `DataKey::SafeAddress` is written exactly once in `initialize`
  (contracts/escrow/src/lib.rs:281-283) and is never written again anywhere in
  the contract.
- `emergency_drain` performs the standard authorization checks
  (`Unauthorized` if not admin, `NotPaused` if the contract is not paused) *in
  addition to* the fixed destination, so it remains a privileged,
  circuit-breaker-gated operation.
- Even when the balance is zero, `emergency_drain` emits an event
  (`admin`, `drn_noop`) to preserve the audit trail — consistency with the
  immutability/auditability goal.

## Trade-offs

### Advantages
1. **Rug-pull resistant**: a compromised admin key cannot redirect funds.
2. **Auditable**: the destination is fixed and publicly visible at deploy time.
3. **Smaller attack surface**: one fewer mutable, authorized parameter/setter.
4. **Bounded blast radius**: `emergency_drain` can only ever reach one address.

### Disadvantages / Accepted Limitations
1. **No destination flexibility**: if the safe address is lost or compromised,
   funds cannot be rerouted via `emergency_drain`. Recovery then requires a
   contract upgrade / migration, which is an acceptable, deliberate trade-off
   versus the catastrophic alternative.
2. **Deploy-time discipline required**: the deployer must supply the correct
   safe address at `initialize`. A mistake is permanent for that deployment
   (mitigated by pre-deploy verification and the public, auditable nature of the
   value).
3. **Operational coupling**: the safe address must be a long-lived, securely
   custodied address; operational security around it becomes critical.

## Security Considerations

- The guarantee depends on `safe_address` being correctly set at `initialize`
  and on `initialize` being callable only once (it panics on a second call via
  `"Contract already initialized"`). Both properties hold in the current
  implementation.
- Monitors should assert that `DataKey::SafeAddress` never changes between
  ledgers; any such change would indicate a contract logic regression and should
  be treated as critical.
- The safe address itself must be protected with strong custody (multi-sig /
  cold storage). Immutability protects players from a *malicious drain*, but not
  from a *compromised safe* — those are orthogonal concerns addressed by key
  management policy.

## Future Enhancements

1. **Multi-sig safe**: require the safe address to be a multi-sig account so no
   single key can move drained funds.
2. **On-chain assertion test**: a CI check that deploys the contract, calls
   `initialize`, and asserts `DataKey::SafeAddress` is immutable (no setter
   exists in the ABI).
3. **Deployment attestation**: publish the `initialize` transaction hash and the
   resulting safe address in release notes for every environment.

## Conclusion

Fixing `safe_address` immutably at initialization removes the most dangerous
failure mode of an emergency drain — a compromised or malicious admin
redirecting all player funds to an arbitrary address. The accepted cost (no
runtime destination flexibility, strong custody requirements for the safe
address) is minor compared to the catastrophic loss it prevents, and the value
is fully auditable on-chain at deploy time.
