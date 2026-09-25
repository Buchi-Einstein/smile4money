/**
 * Issue #75 — Full match-lifecycle integration test
 *
 * Exercises the complete on-chain match lifecycle through the backend REST API
 * and the deployed escrow contract against a local Stellar node:
 *
 *   1. create         — POST /api/matches (off-chain record + game validation)
 *                        + escrow.create_match on-chain
 *   2. deposit × 2     — escrow.deposit as player1, then player2 (on-chain)
 *   3. submit_result   — POST /api/oracle/submit-result (identity verification)
 *                        + escrow.submit_result on-chain (oracle)
 *   4. finalize_result — escrow.finalize_result on-chain (after dispute window)
 *
 * This is a true end-to-end integration test. It requires a running local
 * Stellar node with the escrow contract (and a SAC token) already deployed and
 * initialized, plus the backend available in-process (the Express `app`).
 *
 * Required environment variables (all must be set, otherwise the on-chain
 * portion is skipped and only the REST create + result-verification steps run):
 *
 *   STELLAR_RPC_URL        e.g. http://localhost:8000  (Soroban RPC)
 *   STELLAR_NETWORK_PASSPHRASE  e.g. "Standalone" or "Test SDF Network ; Faraday"
 *   ESCROW_CONTRACT_ID     deployed escrow contract address
 *   TOKEN_CONTRACT_ID      deployed Stellar Asset Contract (SAC) address
 *   ADMIN_SECRET           admin keypair secret (used to fund/read + finalize)
 *   ORACLE_SECRET          oracle keypair secret (used for submit_result)
 *   PLAYER1_SECRET         player1 keypair secret (deposit + create_match)
 *   PLAYER2_SECRET         player2 keypair secret (deposit)
 *
 * Optional:
 *   FRIENDBOT_URL / STANDALONE_MASTER_SEED  funding source for test accounts
 *   STAKE_AMOUNT          stake in token's smallest unit (default 100)
 *   DISPUTE_WINDOW_WAIT_MS  how long to wait for the dispute window (default 30000)
 *
 * Stack: Node.js · TypeScript · Vitest · supertest · @stellar/stellar-sdk
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import * as StellarSdk from 'stellar-sdk';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Mock the external chess-platform APIs so the REST flow runs fully offline.
// The mock returns consistent white/black usernames so the oracle's identity
// verification in submit-result passes.
// ---------------------------------------------------------------------------
vi.mock('../../src/fetchers/lichess.js', () => ({
  fetchLichessResult: vi.fn(async (gameId: string) => ({
    gameId,
    status: 'mate',
    whitePlayer: 'alice',
    blackPlayer: 'bob',
    result: 'Player1Wins',
  })),
  GameNotFoundError: class GameNotFoundError extends Error {},
}));

vi.mock('../../src/fetchers/chessdotcom.js', () => ({
  fetchChessDotComResult: vi.fn(async (_username: string, gameId: string) => ({
    gameId,
    status: 'mate',
    whitePlayer: 'alice',
    blackPlayer: 'bob',
    result: 'Player1Wins',
  })),
}));

// Imported AFTER the mocks are declared (vi.mock is hoisted).
import app from '../../src/app.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const RPC_URL = process.env.STELLAR_RPC_URL;
const NETWORK = process.env.STELLAR_NETWORK_PASSPHRASE || StellarSdk.Networks.STANDALONE;
const ESCROW_ID = process.env.ESCROW_CONTRACT_ID;
const TOKEN_ID = process.env.TOKEN_CONTRACT_ID;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const ORACLE_SECRET = process.env.ORACLE_SECRET;
const PLAYER1_SECRET = process.env.PLAYER1_SECRET;
const PLAYER2_SECRET = process.env.PLAYER2_SECRET;
const FRIENDBOT_URL = process.env.FRIENDBOT_URL;
const MASTER_SEED = process.env.STANDALONE_MASTER_SEED;
const STAKE = process.env.STAKE_AMOUNT ? Number(process.env.STAKE_AMOUNT) : 100;
const DISPUTE_WINDOW_WAIT_MS = process.env.DISPUTE_WINDOW_WAIT_MS
  ? Number(process.env.DISPUTE_WINDOW_WAIT_MS)
  : 30_000;

const ONCHAIN_CONFIGURED =
  !!RPC_URL &&
  !!ESCROW_ID &&
  !!TOKEN_ID &&
  !!ADMIN_SECRET &&
  !!ORACLE_SECRET &&
  !!PLAYER1_SECRET &&
  !!PLAYER2_SECRET;

// ---------------------------------------------------------------------------
// ScVal helpers
// ---------------------------------------------------------------------------
function enumScVal(name: string): any {
  const scEnum = new StellarSdk.xdr.ScEnum({
    name: StellarSdk.xdr.ScSymbol(name),
    values: null,
  });
  return StellarSdk.xdr.ScVal.scvEnum(scEnum);
}
const addressScVal = (pubkey: string) => new StellarSdk.Address(pubkey).toScVal();
const u64ScVal = (n: number) => StellarSdk.nativeToScVal(n, { type: 'u64' });
const i128ScVal = (n: number) => StellarSdk.nativeToScVal(n, { type: 'i128' });
const stringScVal = (s: string) => StellarSdk.nativeToScVal(s, { type: 'string' });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeToken(address: string): string {
  const secret = process.env.JWT_SECRET || 'test-secret';
  return jwt.sign({ address }, secret, { expiresIn: '1h' });
}

// ---------------------------------------------------------------------------
// Test body
// ---------------------------------------------------------------------------
describe('integration: full match lifecycle (create → deposit×2 → submit_result → finalize_result)', () => {
  let server: any;
  let adminKp: any, oracleKp: any, player1Kp: any, player2Kp: any;
  let escrow: any;

  beforeAll(async () => {
    if (!ONCHAIN_CONFIGURED) return;
    server = new StellarSdk.rpc.Server(RPC_URL);
    adminKp = StellarSdk.Keypair.fromSecret(ADMIN_SECRET);
    oracleKp = StellarSdk.Keypair.fromSecret(ORACLE_SECRET);
    player1Kp = StellarSdk.Keypair.fromSecret(PLAYER1_SECRET);
    player2Kp = StellarSdk.Keypair.fromSecret(PLAYER2_SECRET);
    escrow = new StellarSdk.Contract(ESCROW_ID);

    await fundAccount(adminKp.publicKey());
    await fundAccount(oracleKp.publicKey());
    await fundAccount(player1Kp.publicKey());
    await fundAccount(player2Kp.publicKey());
  });

  it('runs the full create → deposit×2 → submit_result → finalize_result flow', async () => {
    const player1Addr = player1Kp ? player1Kp.publicKey() : 'GPLAYER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const player2Addr = player2Kp ? player2Kp.publicKey() : 'GPLAYER2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    const gameId = `integration-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // --- REST step 1: create match (off-chain record + game validation) -----
    const createRes = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${makeToken(player1Addr)}`)
      .send({
        player2: player2Addr,
        stakeAmount: STAKE,
        token: TOKEN_ID || 'XLM',
        gameId,
        platform: 'lichess',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ gameId, platform: 'lichess', state: 'Pending' });

    // --- REST step 3 (verification half): oracle verifies the game result ----
    const verifyRes = await request(app)
      .post('/api/oracle/submit-result')
      .set('Authorization', `Bearer ${makeToken(player1Addr)}`)
      .send({ matchId: createRes.body.matchId, gameId, platform: 'lichess' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);
    expect(verifyRes.body.result).toBe('Player1Wins');

    // If no local Stellar node is configured, the REST lifecycle above is the
    // maximum that can be validated offline.
    if (!ONCHAIN_CONFIGURED) return;

    // --- On-chain step 1: create_match --------------------------------------
    // create_match assigns id = current match_count, then increments it, so the
    // id we just created equals the value of match_count read beforehand.
    const expectedId = await readU64(escrow, 'match_count');
    await invoke(player1Kp, escrow, 'create_match',
      addressScVal(player1Kp.publicKey()),
      addressScVal(player2Kp.publicKey()),
      i128ScVal(STAKE),
      addressScVal(TOKEN_ID),
      stringScVal(gameId),
      enumScVal('Lichess'),
    );

    // --- On-chain step 2: deposit × 2 ---------------------------------------
    await invoke(player1Kp, escrow, 'deposit', u64ScVal(expectedId), addressScVal(player1Kp.publicKey()));
    await invoke(player2Kp, escrow, 'deposit', u64ScVal(expectedId), addressScVal(player2Kp.publicKey()));

    // --- On-chain step 3: submit_result (oracle) -----------------------------
    await invoke(oracleKp, escrow, 'submit_result',
      u64ScVal(expectedId),
      stringScVal(gameId),
      enumScVal('Player1'),
      addressScVal(oracleKp.publicKey()),
    );

    // --- On-chain step 4: finalize_result (after dispute window) -------------
    // finalize_result only succeeds once the dispute window has elapsed, so we
    // retry until it closes or we hit the configured timeout.
    let finalized = false;
    const deadline = Date.now() + DISPUTE_WINDOW_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        await invoke(player1Kp, escrow, 'finalize_result', u64ScVal(expectedId), addressScVal(player1Kp.publicKey()));
        finalized = true;
        break;
      } catch {
        await sleep(2000);
      }
    }
    expect(finalized).toBe(true);

    // --- Assert the funds left the escrow (payout executed) ------------------
    const remaining = await readI128(escrow, 'get_escrow_balance', u64ScVal(expectedId));
    expect(remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Node / contract helpers (only used when a node is configured)
// ---------------------------------------------------------------------------
async function fundAccount(pubKey: string) {
  if (FRIENDBOT_URL) {
    await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(pubKey)}`);
    return;
  }
  if (MASTER_SEED) {
    const master = StellarSdk.Keypair.fromSecret(MASTER_SEED);
    const src = await server.loadAccount(master.publicKey());
    const tx = new StellarSdk.TransactionBuilder(src, { fee: '100', networkPassphrase: NETWORK })
      .addOperation(StellarSdk.Operation.createAccount({ destination: pubKey, startingBalance: '100' }))
      .setTimeout(30)
      .build();
    tx.sign(master);
    await server.submitTransaction(tx);
    return;
  }
  throw new Error('No funding method configured (set FRIENDBOT_URL or STANDALONE_MASTER_SEED)');
}

/** Sign and submit a Soroban invocation, polling until it is confirmed. */
async function invoke(keypair: any, contract: any, method: string, ...args: any[]) {
  const source = await server.loadAccount(keypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(source, { fee: '100', networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  const sent = await server.sendTransaction(tx);
  if (sent.status && sent.status !== 'PENDING' && sent.status !== 'SUCCESS' && sent.status !== 'DUPLICATE') {
    throw new Error(`sendTransaction failed: ${sent.status}`);
  }
  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') throw new Error(`tx FAILED: ${method}`);
    await sleep(1000);
  }
  throw new Error(`tx timeout: ${method}`);
}

/** Simulate a view call that returns a u64 and parse it. */
async function readU64(contract: any, method: string, ...args: any[]): Promise<number> {
  const account = await server.loadAccount(adminKp.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  const sim: any = await server.simulateTransaction(tx);
  const retval = sim?.result?.retval ?? sim?.retval;
  const scVal = typeof retval === 'string' ? StellarSdk.xdr.ScVal.fromXDR(retval, 'base64') : retval;
  return Number(scVal.u64().toString());
}

/** Simulate a view call that returns an i128 and parse it. */
async function readI128(contract: any, method: string, ...args: any[]): Promise<number> {
  const account = await server.loadAccount(adminKp.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  const sim: any = await server.simulateTransaction(tx);
  const retval = sim?.result?.retval ?? sim?.retval;
  const scVal = typeof retval === 'string' ? StellarSdk.xdr.ScVal.fromXDR(retval, 'base64') : retval;
  const inner = scVal.i128();
  const hi = Number(inner.hi().toString());
  const lo = Number(inner.lo().toString());
  return hi * 2 ** 64 + lo;
}
