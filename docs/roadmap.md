# Roadmap

## v1.0 — Current

Core escrow and oracle functionality on Stellar Soroban.

- XLM escrow contract with full match lifecycle (Pending → Active → Completed / Cancelled)
- Lichess oracle integration
- Admin pause / unpause circuit breaker
- Re-initialization guard on both contracts
- TTL extension on all persistent storage entries
- On-chain events for all state transitions
- GitHub Actions CI (cargo test + cargo clippy)

## v1.1 — Token Support & Chess.com Oracle

- USDC and arbitrary SAC token support (token address is already a parameter; this milestone validates multi-token flows end-to-end)
- Chess.com oracle integration
- `update_oracle` admin function for key rotation without redeployment
- Game ID uniqueness enforcement to prevent duplicate match payouts

## v2.0 — Tournaments

- Multi-match tournament bracket contract — `contracts/tournament-bracket`, see [ADR-003](adr/003-tournament-bracket.md)
- Bracket payout logic: the oracle advances the winner of each match, and the champion is paid the whole pot (`entry_fee × entrants`) when the final is decided. There are no per-match payouts and no loser refunds, because paying each match's winner would drain the pot in the first round
- Tournament admin role, scoped to cancelling a bracket while it is still in registration. Both admin cancellation and the permissionless stalling timeout refund every funded entrant in full
- Configurable prize splits — not implemented yet; the pot is winner-takes-all

## v3.0 — Frontend

- Web frontend with Stellar wallet integration (Freighter / Albedo)
- Match creation and deposit UI
- Live match status and payout history
- Oracle status dashboard

## v4.0 — Mobile & Matchmaking

- Mobile app (iOS / Android)
- ELO-based matchmaking — players are paired with opponents of similar rating
- Global leaderboard with on-chain verifiable win/loss records
- Configurable stake tiers and time controls
