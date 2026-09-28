//! End-to-end integration tests for the full match lifecycle.
//!
//! Closes #43 -- Issue #216: Add comprehensive integration test covering the
//! complete match lifecycle: create -> both deposits -> oracle submits result ->
//! verify payouts, for all three outcomes (Player1 wins, Player2 wins, Draw).
//!
//! These tests exercise the escrow contract in isolation (the oracle address is
//! just a trusted `Address`; no cross-contract call is required) and verify:
//!   - Correct state transitions at every step
//!   - Token balance changes for both players and the escrow contract
//!   - `get_escrow_balance` and `is_funded` query accuracy throughout
//!   - All expected events are emitted with correct data
//!   - Error paths: wrong oracle, game_id mismatch, invalid state re-entry

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, IntoVal, String, Symbol, TryFromVal,
};

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

/// Spin up a fresh environment with two players, a token, and an initialised
/// escrow contract.  Each player starts with 1 000 tokens.
///
/// Returns `(env, contract_id, oracle, player1, player2, token_addr, admin, safe_address)`.
fn setup_e2e() -> (Env, Address, Address, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let safe_address = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = token_id.address();
    let asset_client = StellarAssetClient::new(&env, &token_addr);
    asset_client.mint(&player1, &1_000);
    asset_client.mint(&player2, &1_000);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    client.initialize(&oracle, &admin, &token_addr, &safe_address, &None, &None);

    // Approve the escrow contract for both players (needed for allowance check)
    let expiration = env.ledger().sequence() + 1000000;
    let token_client = TokenClient::new(&env, &token_addr);
    token_client.approve(&player1, &contract_id, &1_000, &expiration);
    token_client.approve(&player2, &contract_id, &1_000, &expiration);

    (
        env,
        contract_id,
        oracle,
        player1,
        player2,
        token_addr,
        admin,
        safe_address,
    )
}

// ---------------------------------------------------------------------------
// Full lifecycle -- Player 1 wins
// ---------------------------------------------------------------------------

/// Complete happy-path: create -> p1 deposit -> p2 deposit -> oracle submits
/// Player1 wins -> verify balances, state, escrow balance, and events.
#[test]
fn test_e2e_lifecycle_player1_wins() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 250;
    let game_id = String::from_str(&env, "e2e-game-p1-wins");

    // -- Step 1: Create match ------------------------------------------------
    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::Lichess,
    );

    // State: Pending, no deposits yet
    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::Pending);
    assert!(!m.player1_deposited);
    assert!(!m.player2_deposited);
    assert!(!client.is_funded(&match_id));
    assert_eq!(client.get_escrow_balance(&match_id), 0);

    // Balances unchanged after creation
    assert_eq!(token_client.balance(&player1), 1_000);
    assert_eq!(token_client.balance(&player2), 1_000);

    // -- Step 2: Player 1 deposits -------------------------------------------
    client.deposit(&match_id, &player1);

    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::Pending); // still Pending -- only one deposit
    assert!(m.player1_deposited);
    assert!(!m.player2_deposited);
    assert!(!client.is_funded(&match_id));
    assert_eq!(client.get_escrow_balance(&match_id), stake);
    assert_eq!(token_client.balance(&player1), 1_000 - stake);
    assert_eq!(token_client.balance(&player2), 1_000); // untouched

    // -- Step 3: Player 2 deposits -> match becomes Active -------------------
    client.deposit(&match_id, &player2);

    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::Active);
    assert!(m.player1_deposited);
    assert!(m.player2_deposited);
    assert!(client.is_funded(&match_id));
    assert_eq!(client.get_escrow_balance(&match_id), stake * 2);
    assert_eq!(token_client.balance(&player1), 1_000 - stake);
    assert_eq!(token_client.balance(&player2), 1_000 - stake);

    // -- Step 4: Oracle submits result -- Player 1 wins ----------------------
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);

    // Capture events immediately after submit_result, before any other calls
    let events = env.events().all();
    let completed_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("completed").into_val(&env),
    ];
    let (_, _, data) = events
        .iter()
        .find(|(_, t, _)| *t == completed_topics)
        .expect("completed event not found");
    let (ev_id, ev_winner, ev_payout): (u64, Winner, i128) =
        TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_id, match_id);
    assert_eq!(ev_winner, Winner::Player1);
    assert_eq!(ev_payout, stake * 2);

    // State: Completed
    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::Completed);

    // Player 1 receives the full pot (2x stake); player 2 loses their stake
    assert_eq!(token_client.balance(&player1), 1_000 + stake); // net gain = stake
    assert_eq!(token_client.balance(&player2), 1_000 - stake); // net loss = stake

    // Escrow is empty
    assert_eq!(client.get_escrow_balance(&match_id), 0);
}

// ---------------------------------------------------------------------------
// Full lifecycle -- Player 2 wins
// ---------------------------------------------------------------------------

/// Same lifecycle but the oracle declares Player 2 the winner.
#[test]
fn test_e2e_lifecycle_player2_wins() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 300;
    let game_id = String::from_str(&env, "e2e-game-p2-wins");

    // -- Create --------------------------------------------------------------
    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::ChessDotCom,
    );

    assert_eq!(client.get_match(&match_id).state, MatchState::Pending);

    // -- Both players deposit ------------------------------------------------
    client.deposit(&match_id, &player1);
    assert_eq!(client.get_match(&match_id).state, MatchState::Pending);
    assert_eq!(client.get_escrow_balance(&match_id), stake);

    client.deposit(&match_id, &player2);
    assert_eq!(client.get_match(&match_id).state, MatchState::Active);
    assert_eq!(client.get_escrow_balance(&match_id), stake * 2);
    assert!(client.is_funded(&match_id));

    // -- Oracle submits result -- Player 2 wins ------------------------------
    client.submit_result(&match_id, &game_id, &Winner::Player2, &oracle);

    // Capture events immediately after submit_result
    let events = env.events().all();
    let completed_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("completed").into_val(&env),
    ];
    let (_, _, data) = events
        .iter()
        .find(|(_, t, _)| *t == completed_topics)
        .expect("completed event not found");
    let (ev_id, ev_winner, _ev_payout): (u64, Winner, i128) =
        TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_id, match_id);
    assert_eq!(ev_winner, Winner::Player2);

    assert_eq!(client.get_match(&match_id).state, MatchState::Completed);

    // Player 2 receives the full pot; player 1 loses their stake
    assert_eq!(token_client.balance(&player2), 1_000 + stake); // net gain = stake
    assert_eq!(token_client.balance(&player1), 1_000 - stake); // net loss = stake
    assert_eq!(client.get_escrow_balance(&match_id), 0);
}

// ---------------------------------------------------------------------------
// Full lifecycle -- Draw
// ---------------------------------------------------------------------------

/// Same lifecycle but the oracle declares a draw; both players are refunded.
#[test]
fn test_e2e_lifecycle_draw() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 150;
    let game_id = String::from_str(&env, "e2e-game-draw");

    // -- Create --------------------------------------------------------------
    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::Lichess,
    );

    assert_eq!(client.get_match(&match_id).state, MatchState::Pending);
    assert_eq!(client.get_escrow_balance(&match_id), 0);

    // -- Both players deposit (reversed order to confirm order independence) -
    client.deposit(&match_id, &player2);
    assert_eq!(client.get_match(&match_id).state, MatchState::Pending);
    assert_eq!(client.get_escrow_balance(&match_id), stake);
    assert_eq!(token_client.balance(&player2), 1_000 - stake);

    client.deposit(&match_id, &player1);
    assert_eq!(client.get_match(&match_id).state, MatchState::Active);
    assert_eq!(client.get_escrow_balance(&match_id), stake * 2);
    assert!(client.is_funded(&match_id));

    // -- Oracle submits result -- Draw ----------------------------------------
    client.submit_result(&match_id, &game_id, &Winner::Draw, &oracle);

    // Capture events immediately after submit_result
    let events = env.events().all();
    let completed_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("completed").into_val(&env),
    ];
    let (_, _, data) = events
        .iter()
        .find(|(_, t, _)| *t == completed_topics)
        .expect("completed event not found");
    let (ev_id, ev_winner, _ev_payout): (u64, Winner, i128) =
        TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_id, match_id);
    assert_eq!(ev_winner, Winner::Draw);

    assert_eq!(client.get_match(&match_id).state, MatchState::Completed);

    // Both players are refunded their exact stake -- net change is zero
    assert_eq!(token_client.balance(&player1), 1_000);
    assert_eq!(token_client.balance(&player2), 1_000);
    assert_eq!(client.get_escrow_balance(&match_id), 0);
}

// ---------------------------------------------------------------------------
// All three outcomes in a single environment (sequential matches)
// ---------------------------------------------------------------------------

/// Run three independent matches back-to-back in the same environment to
/// confirm the contract handles multiple concurrent game IDs correctly and
/// that each match payout is isolated.
#[test]
fn test_e2e_all_three_outcomes_sequential() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 100;

    // -- Match 0: Player 1 wins ----------------------------------------------
    let id0 = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &String::from_str(&env, "seq-game-0"),
        &Platform::Lichess,
    );
    client.deposit(&id0, &player1);
    client.deposit(&id0, &player2);
    assert_eq!(client.get_match(&id0).state, MatchState::Active);

    client.submit_result(
        &id0,
        &String::from_str(&env, "seq-game-0"),
        &Winner::Player1,
        &oracle,
    );
    assert_eq!(client.get_match(&id0).state, MatchState::Completed);
    // After match 0: p1 = 1000 + 100 = 1100, p2 = 1000 - 100 = 900
    assert_eq!(token_client.balance(&player1), 1_100);
    assert_eq!(token_client.balance(&player2), 900);

    // -- Match 1: Player 2 wins ----------------------------------------------
    let id1 = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &String::from_str(&env, "seq-game-1"),
        &Platform::ChessDotCom,
    );
    client.deposit(&id1, &player1);
    client.deposit(&id1, &player2);
    assert_eq!(client.get_match(&id1).state, MatchState::Active);

    client.submit_result(
        &id1,
        &String::from_str(&env, "seq-game-1"),
        &Winner::Player2,
        &oracle,
    );
    assert_eq!(client.get_match(&id1).state, MatchState::Completed);
    // After match 1: p1 = 1100 - 100 = 1000, p2 = 900 + 100 = 1000
    assert_eq!(token_client.balance(&player1), 1_000);
    assert_eq!(token_client.balance(&player2), 1_000);

    // -- Match 2: Draw -------------------------------------------------------
    let id2 = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &String::from_str(&env, "seq-game-2"),
        &Platform::Lichess,
    );
    client.deposit(&id2, &player1);
    client.deposit(&id2, &player2);
    assert_eq!(client.get_match(&id2).state, MatchState::Active);

    client.submit_result(
        &id2,
        &String::from_str(&env, "seq-game-2"),
        &Winner::Draw,
        &oracle,
    );
    assert_eq!(client.get_match(&id2).state, MatchState::Completed);
    // After draw: both players back to 1000
    assert_eq!(token_client.balance(&player1), 1_000);
    assert_eq!(token_client.balance(&player2), 1_000);

    // All three matches are independently completed with sequential IDs
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_match(&id0).state, MatchState::Completed);
    assert_eq!(client.get_match(&id1).state, MatchState::Completed);
    assert_eq!(client.get_match(&id2).state, MatchState::Completed);
}

// ---------------------------------------------------------------------------
// Error paths: invalid oracle
// ---------------------------------------------------------------------------

/// An address that is not the registered oracle must be rejected with
/// `Unauthorized` even after both players have deposited.
#[test]
fn test_e2e_unauthorized_oracle_rejected() {
    let (env, contract_id, _oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-unauth-oracle");
    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);
    assert_eq!(client.get_match(&match_id).state, MatchState::Active);

    let impostor = Address::generate(&env);
    assert_eq!(
        client.try_submit_result(&match_id, &game_id, &Winner::Player1, &impostor),
        Err(Ok(Error::Unauthorized))
    );

    // Match must remain Active -- no payout occurred
    assert_eq!(client.get_match(&match_id).state, MatchState::Active);
}

// ---------------------------------------------------------------------------
// Error paths: game_id mismatch
// ---------------------------------------------------------------------------

/// The oracle must supply the exact game_id stored in the match.  A mismatched
/// game_id must be rejected with `GameIdMismatch` and leave the match Active.
#[test]
fn test_e2e_game_id_mismatch_rejected() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let real_game_id = String::from_str(&env, "e2e-real-game");
    let wrong_game_id = String::from_str(&env, "e2e-wrong-game");

    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &real_game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);

    assert_eq!(
        client.try_submit_result(&match_id, &wrong_game_id, &Winner::Player1, &oracle),
        Err(Ok(Error::GameIdMismatch))
    );

    // Match must remain Active
    assert_eq!(client.get_match(&match_id).state, MatchState::Active);
}

// ---------------------------------------------------------------------------
// Error paths: submit_result on Pending match
// ---------------------------------------------------------------------------

/// Submitting a result before both players have deposited (Pending state) must
/// return `InvalidState`.
#[test]
fn test_e2e_submit_result_on_pending_match_fails() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-pending-submit");
    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );

    // No deposits -- match is still Pending
    assert_eq!(
        client.try_submit_result(&match_id, &game_id, &Winner::Player1, &oracle),
        Err(Ok(Error::InvalidState))
    );
}

// ---------------------------------------------------------------------------
// Error paths: double payout prevention
// ---------------------------------------------------------------------------

/// Once a match is Completed, a second call to `submit_result` must return
/// `InvalidState` -- no double-payout is possible.
#[test]
fn test_e2e_no_double_payout_after_completion() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let game_id = String::from_str(&env, "e2e-double-payout");
    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);

    assert_eq!(client.get_match(&match_id).state, MatchState::Completed);
    let p1_balance_after_first = token_client.balance(&player1);

    // Second submit_result must be rejected
    assert_eq!(
        client.try_submit_result(&match_id, &game_id, &Winner::Player2, &oracle),
        Err(Ok(Error::InvalidState))
    );

    // Balances must not have changed
    assert_eq!(token_client.balance(&player1), p1_balance_after_first);
}

// ---------------------------------------------------------------------------
// Error paths: deposit after completion / cancellation
// ---------------------------------------------------------------------------

/// Depositing into a Completed match must return `MatchCompleted`.
#[test]
fn test_e2e_deposit_into_completed_match_fails() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-dep-completed");
    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);
    client.submit_result(&match_id, &game_id, &Winner::Draw, &oracle);

    assert_eq!(
        client.try_deposit(&match_id, &player1),
        Err(Ok(Error::MatchCompleted))
    );
}

/// Depositing into a Cancelled match must return `MatchCancelled`.
#[test]
fn test_e2e_deposit_into_cancelled_match_fails() {
    let (env, contract_id, _oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &String::from_str(&env, "e2e-dep-cancelled"),
        &Platform::Lichess,
    );
    client.cancel_match(&match_id, &player1);

    assert_eq!(
        client.try_deposit(&match_id, &player1),
        Err(Ok(Error::MatchCancelled))
    );
}

// ---------------------------------------------------------------------------
// Escrow balance tracks correctly through the full lifecycle
// ---------------------------------------------------------------------------

/// Verify `get_escrow_balance` returns the correct value at every stage:
/// 0 (created) -> stake (p1 deposited) -> 2xstake (p2 deposited) -> 0 (completed).
#[test]
fn test_e2e_escrow_balance_full_lifecycle() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let stake: i128 = 200;
    let game_id = String::from_str(&env, "e2e-balance-lifecycle");

    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::ChessDotCom,
    );

    assert_eq!(client.get_escrow_balance(&match_id), 0);

    client.deposit(&match_id, &player1);
    assert_eq!(client.get_escrow_balance(&match_id), stake);

    client.deposit(&match_id, &player2);
    assert_eq!(client.get_escrow_balance(&match_id), stake * 2);

    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);
    assert_eq!(client.get_escrow_balance(&match_id), 0);
}

// ---------------------------------------------------------------------------
// Event sequence verification for the full lifecycle
// ---------------------------------------------------------------------------

/// Confirm that all four expected events are emitted during a complete match
/// lifecycle: created -> deposit (x2) -> activated -> completed.
/// Also verifies the payload of the "created", "activated", and "completed" events.
///
/// Note: env.events().all() returns events from the most recent contract
/// invocation and clears the buffer. Events are captured immediately after
/// each relevant call.
#[test]
fn test_e2e_event_sequence_full_lifecycle() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-event-seq");

    // Capture "created" event immediately after create_match
    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    let events_after_create = env.events().all();
    let created_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("created").into_val(&env),
    ];
    let (_, _, created_data) = events_after_create
        .iter()
        .find(|(_, t, _)| *t == created_topics)
        .expect("created event not found");
    let (ev_id, ev_p1, ev_p2, ev_stake, _ev_game_id): (
        u64,
        Address,
        Address,
        i128,
        soroban_sdk::String,
    ) = TryFromVal::try_from_val(&env, &created_data).unwrap();
    assert_eq!(ev_id, match_id);
    assert_eq!(ev_p1, player1);
    assert_eq!(ev_p2, player2);
    assert_eq!(ev_stake, 100);

    // Capture "deposit" event after player1 deposits
    client.deposit(&match_id, &player1);
    let events_after_p1_deposit = env.events().all();
    let deposit_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("deposit").into_val(&env),
    ];
    assert!(
        events_after_p1_deposit
            .iter()
            .any(|(_, t, _)| t == deposit_topics),
        "expected (match, deposit) event after player1 deposit"
    );

    // Capture "activated" event after player2 deposits (triggers activation)
    client.deposit(&match_id, &player2);
    let events_after_p2_deposit = env.events().all();
    let activated_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("activated").into_val(&env),
    ];
    let (_, _, activated_data) = events_after_p2_deposit
        .iter()
        .find(|(_, t, _)| *t == activated_topics)
        .expect("activated event not found");
    let ev_activated_id: u64 = TryFromVal::try_from_val(&env, &activated_data).unwrap();
    assert_eq!(ev_activated_id, match_id);

    // Capture "completed" event after oracle submits result
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);
    let events_after_submit = env.events().all();
    let completed_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("completed").into_val(&env),
    ];
    let (_, _, completed_data) = events_after_submit
        .iter()
        .find(|(_, t, _)| *t == completed_topics)
        .expect("completed event not found");
    let (ev_completed_id, ev_winner, _ev_payout): (u64, Winner, i128) =
        TryFromVal::try_from_val(&env, &completed_data).unwrap();
    assert_eq!(ev_completed_id, match_id);
    assert_eq!(ev_winner, Winner::Player1);
}

// ---------------------------------------------------------------------------
// Issue #1123 — E2E: override_result then finalize_result payout path
// ---------------------------------------------------------------------------
//
// Scenario:
//   1. Oracle submits Player1 wins → match enters PendingResult.
//   2. Admin calls override_result to change the winner to Player2.
//   3. Advance ledger past DISPUTE_WINDOW_LEDGERS (17 280).
//   4. Anyone calls finalize_result → payout executes.
//   5. Assert Player2 receives the full pot; Player1 receives nothing extra.

/// E2E test: oracle submits Player1 wins, admin overrides to Player2 wins,
/// dispute window expires, finalize executes the overridden payout to Player2.
#[test]
fn test_e2e_override_result_then_finalize_payout_to_player2() {
    let (env, contract_id, oracle, player1, player2, token, admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 200;
    let game_id = String::from_str(&env, "e2e-override-finalize");

    // ── Step 1: Create and fund the match ────────────────────────────────────
    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);

    assert_eq!(client.get_match(&match_id).state, MatchState::Active);
    assert_eq!(client.get_escrow_balance(&match_id), stake * 2);

    // Snapshot balances after both deposits (each player deposited `stake`)
    let p1_after_deposit = token_client.balance(&player1);
    let p2_after_deposit = token_client.balance(&player2);

    // ── Step 2: Oracle submits Player1 wins ─────────────────────────────────
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);

    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::PendingResult);
    assert_eq!(m.pending_winner, OptionalWinner::Some(Winner::Player1));

    // Balances must be unchanged — no payout yet
    assert_eq!(token_client.balance(&player1), p1_after_deposit);
    assert_eq!(token_client.balance(&player2), p2_after_deposit);

    // ── Step 3: Admin overrides to Player2 wins ─────────────────────────────
    client.override_result(&match_id, &Winner::Player2, &admin);

    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::PendingResult, "state must remain PendingResult after override");
    assert_eq!(
        m.pending_winner,
        OptionalWinner::Some(Winner::Player2),
        "pending_winner must reflect the overridden result"
    );

    // Balances still unchanged — still within dispute window
    assert_eq!(token_client.balance(&player1), p1_after_deposit);
    assert_eq!(token_client.balance(&player2), p2_after_deposit);

    // ── Step 4: Advance ledger past the dispute window ───────────────────────
    // Advance by DISPUTE_WINDOW_LEDGERS + 1 to clear the boundary.
    let current = env.ledger().sequence();
    env.ledger().set_sequence_number(current + crate::DISPUTE_WINDOW_LEDGERS + 1);

    // ── Step 5: Finalize result — payout goes to Player2 ────────────────────
    client.finalize_result(&match_id, &player1);

    // ── Verify state ─────────────────────────────────────────────────────────
    let m = client.get_match(&match_id);
    assert_eq!(m.state, MatchState::Completed, "match must be Completed after finalize");

    // Player2 receives the full pot (2 × stake); Player1 receives nothing
    assert_eq!(
        token_client.balance(&player2),
        p2_after_deposit + stake * 2,
        "Player2 must receive the full pot after the overridden finalize"
    );
    assert_eq!(
        token_client.balance(&player1),
        p1_after_deposit,
        "Player1 must receive nothing after losing the override"
    );

    // Escrow must be empty
    assert_eq!(client.get_escrow_balance(&match_id), 0);

    // ── Verify completed event carries the overridden winner ─────────────────
    let events = env.events().all();
    let completed_topics = vec![
        &env,
        Symbol::new(&env, "match").into_val(&env),
        soroban_sdk::symbol_short!("completed").into_val(&env),
    ];
    let (_, _, data) = events
        .iter()
        .find(|(_, t, _)| *t == completed_topics)
        .expect("completed event must be emitted by finalize_result");
    let (ev_id, ev_winner, ev_payout): (u64, Winner, i128) =
        TryFromVal::try_from_val(&env, &data).unwrap();
    assert_eq!(ev_id, match_id);
    assert_eq!(ev_winner, Winner::Player2, "event winner must be the overridden value");
    assert_eq!(ev_payout, stake * 2);
}

/// E2E test: oracle submits Draw, admin overrides to Player1 wins,
/// finalize pays Player1 the full pot.
#[test]
fn test_e2e_override_draw_to_player1_wins() {
    let (env, contract_id, oracle, player1, player2, token, admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);
    let token_client = TokenClient::new(&env, &token);

    let stake: i128 = 150;
    let game_id = String::from_str(&env, "e2e-override-draw-p1");

    let match_id = client.create_match(
        &player1,
        &player2,
        &stake,
        &token,
        &game_id,
        &Platform::ChessDotCom,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);

    // Oracle submits Draw
    client.submit_result(&match_id, &game_id, &Winner::Draw, &oracle);
    assert_eq!(client.get_match(&match_id).pending_winner, OptionalWinner::Some(Winner::Draw));

    // Admin overrides to Player1
    client.override_result(&match_id, &Winner::Player1, &admin);
    assert_eq!(
        client.get_match(&match_id).pending_winner,
        OptionalWinner::Some(Winner::Player1)
    );

    // Advance past dispute window and finalize
    let current = env.ledger().sequence();
    env.ledger().set_sequence_number(current + crate::DISPUTE_WINDOW_LEDGERS + 1);
    client.finalize_result(&match_id, &player1);

    assert_eq!(client.get_match(&match_id).state, MatchState::Completed);
    // Player1 wins the full pot
    assert_eq!(token_client.balance(&player1), 1_000 + stake); // net gain = stake
    assert_eq!(token_client.balance(&player2), 1_000 - stake); // net loss = stake
    assert_eq!(client.get_escrow_balance(&match_id), 0);
}

/// E2E test: verify that override_result is rejected once the dispute window
/// has expired — callers must use finalize_result after the window closes.
#[test]
fn test_e2e_override_result_rejected_after_window_expires() {
    let (env, contract_id, oracle, player1, player2, token, admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-override-expired");

    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);

    // Advance past the dispute window
    let current = env.ledger().sequence();
    env.ledger().set_sequence_number(current + crate::DISPUTE_WINDOW_LEDGERS + 1);

    // override_result must now be rejected
    assert_eq!(
        client.try_override_result(&match_id, &Winner::Player2, &admin),
        Err(Ok(Error::DisputeWindowActive)),
        "override_result must fail after the dispute window has expired"
    );
}

/// E2E test: finalize_result is rejected while the dispute window is still open.
#[test]
fn test_e2e_finalize_result_rejected_during_dispute_window() {
    let (env, contract_id, oracle, player1, player2, token, _admin, _safe_address) = setup_e2e();
    let client = EscrowContractClient::new(&env, &contract_id);

    let game_id = String::from_str(&env, "e2e-finalize-window-open");

    let match_id = client.create_match(
        &player1,
        &player2,
        &100,
        &token,
        &game_id,
        &Platform::Lichess,
    );
    client.deposit(&match_id, &player1);
    client.deposit(&match_id, &player2);
    client.submit_result(&match_id, &game_id, &Winner::Player1, &oracle);

    // Dispute window is still open — finalize must be rejected
    assert_eq!(
        client.try_finalize_result(&match_id, &player1),
        Err(Ok(Error::DisputeWindowActive)),
        "finalize_result must be rejected while the dispute window is open"
    );

    // Match must still be PendingResult
    assert_eq!(client.get_match(&match_id).state, MatchState::PendingResult);
}
