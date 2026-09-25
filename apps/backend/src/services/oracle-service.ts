/**
 * Oracle Service
 *
 * Contains all business logic for verifying chess game results before they
 * can be submitted on-chain. Route handlers in routes/oracle.ts delegate here
 * so that the logic can be tested independently of HTTP concerns.
 */

import { fetchLichessResult, GameNotFoundError } from '../fetchers/lichess.js';
import { fetchChessDotComResult } from '../fetchers/chessdotcom.js';
import { verifyPlayerIdentities } from './player-identity.js';
import type { PlayerIdentityMap } from './player-identity.js';
import type { MatchStore } from '../store/match-store.js';
import logger from '../logger.js';

export interface SubmitResultInput {
  matchId: number;
  gameId: string;
  platform: string;
  username?: string;
}

export interface SubmitResultSuccess {
  ok: true;
  verified: true;
  matchId: number;
  gameId: string;
  result: string | null;
  whitePlayer: string;
  blackPlayer: string;
  status: string;
  message: string;
}

export interface SubmitResultFailure {
  ok: false;
  status: 400 | 404 | 500;
  error: string;
  details?: string;
  hint?: string;
}

export type SubmitResultOutcome = SubmitResultSuccess | SubmitResultFailure;

/**
 * Validate the input fields for a submit-result request.
 *
 * Returns an error string if validation fails, or null if valid.
 */
export function validateSubmitResultInput(input: Partial<SubmitResultInput>): string | null {
  const { matchId, gameId, platform, username } = input;

  if (typeof matchId !== 'number' || !Number.isFinite(matchId)) {
    return 'matchId must be a number';
  }
  if (!gameId || typeof gameId !== 'string' || gameId.length === 0) {
    return 'gameId is required';
  }
  if (!platform || (platform !== 'lichess' && platform !== 'chessdotcom')) {
    return 'platform must be lichess or chessdotcom';
  }
  if (platform === 'chessdotcom' && (!username || typeof username !== 'string')) {
    return 'username is required for chessdotcom';
  }
  return null;
}

/**
 * Orchestrate the oracle result-verification flow:
 *   1. Find the match by gameId in the store
 *   2. Ensure player identities were captured at match creation
 *   3. Fetch the game result from the chess platform API
 *   4. Verify that the API players match the registered players
 *
 * Returns a discriminated union so the route handler only needs to map the
 * result to an HTTP response.
 */
export async function verifyGameResult(
  store: MatchStore,
  input: SubmitResultInput,
): Promise<SubmitResultOutcome> {
  const { matchId, gameId, platform, username } = input;

  // Fetch the match record
  const match = await store.findByGameId(gameId);
  if (!match) {
    const storeSize = await store.count();

    if (storeSize === 0) {
      logger.error(
        { game_id: gameId, match_id: matchId, store_count: 0 },
        'oracle_match_not_found_empty_store',
      );
      return {
        ok: false,
        status: 404,
        error: 'Match not found',
        details: `No match found for gameId: ${gameId}. The match store is empty — the server may have restarted and lost in-memory state. Check your persistence configuration (QUEUE_STORE env var) and ensure matches are written to a durable store before deploying.`,
        hint: 'persistence_loss_suspected',
      };
    }

    logger.warn(
      { game_id: gameId, match_id: matchId, store_count: storeSize },
      'oracle_match_not_found',
    );
    return {
      ok: false,
      status: 404,
      error: 'Match not found',
      details: `No match found for gameId: ${gameId}`,
    };
  }

  // Ensure player identities were captured at match creation
  if (!match.player1Username || !match.player2Username) {
    return {
      ok: false,
      status: 400,
      error: 'Player identities not recorded',
      details: 'Match was created without capturing player identities from the API',
    };
  }

  // Fetch the game result from the chess platform API
  let apiResult;
  try {
    if (platform === 'lichess') {
      apiResult = await fetchLichessResult(gameId);
    } else {
      apiResult = await fetchChessDotComResult(username as string, gameId);
    }
  } catch (error) {
    if (error instanceof GameNotFoundError) {
      return {
        ok: false,
        status: 404,
        error: 'Game not found on platform',
        details: error.message,
      };
    }
    throw error;
  }

  // Build the identity map from the match record
  const identityMap: PlayerIdentityMap = {
    player1Address: match.player1,
    player1Username: match.player1Username,
    player2Address: match.player2,
    player2Username: match.player2Username,
    platform,
  };

  // Verify that the API players match the registered players
  const verification = verifyPlayerIdentities(match, apiResult, identityMap);
  if (!verification.valid) {
    return {
      ok: false,
      status: 400,
      error: 'Player identity verification failed',
      details: verification.error,
    };
  }

  return {
    ok: true,
    verified: true,
    matchId: match.matchId,
    gameId: apiResult.gameId,
    result: apiResult.result,
    whitePlayer: apiResult.whitePlayer,
    blackPlayer: apiResult.blackPlayer,
    status: apiResult.status,
    message: 'Game result verified. Players match registered identities.',
  };
}
