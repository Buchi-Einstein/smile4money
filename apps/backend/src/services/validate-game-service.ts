/**
 * Validate-Game Service
 *
 * Contains all business logic for validating chess games on Lichess and
 * Chess.com. Route handlers in routes/validate-game.ts delegate here so that
 * the logic can be tested independently of HTTP concerns.
 */

import { fetchLichessResult, GameNotFoundError } from '../fetchers/lichess.js';
import { fetchChessDotComResult } from '../fetchers/chessdotcom.js';
import type { MatchResult } from '../fetchers/lichess.js';

export interface ValidateGameInput {
  gameId: string;
  platform: string;
  username?: string;
}

export interface ValidateGameSuccess {
  ok: true;
  valid: true;
  platform: string;
  gameId: string;
  status?: string;
  whitePlayer?: string;
  blackPlayer?: string;
  result?: MatchResult | null;
}

export interface ValidateGameNotFound {
  ok: false;
  status: 404;
  valid: false;
  platform: string;
  gameId: string;
  message: string;
}

export interface ValidateGameError {
  ok: false;
  status: 400 | 500;
  error?: string;
  valid?: false;
  platform?: string;
  gameId?: string;
  message?: string;
}

export type ValidateGameResult = ValidateGameSuccess | ValidateGameNotFound | ValidateGameError;

/**
 * Validate the input fields for a game-validation request.
 *
 * Returns an error string if validation fails, or null if valid.
 */
export function validateGameInput(input: Partial<ValidateGameInput>): string | null {
  const { gameId, platform, username } = input;

  if (!gameId || typeof gameId !== 'string' || gameId.length === 0) {
    return 'gameId is required';
  }
  if (gameId.length >= 512) {
    return 'gameId is too long';
  }
  if (!platform || (platform !== 'lichess' && platform !== 'chessdotcom')) {
    return 'platform must be lichess or chessdotcom';
  }
  if (platform === 'chessdotcom' && (!username || typeof username !== 'string' || username.length === 0)) {
    return 'username is required for chessdotcom validation to look up game archives';
  }
  return null;
}

/**
 * Validate that a chess game exists on the given platform and return its
 * details.
 *
 * Assumes input has already been validated by `validateGameInput`.
 */
export async function validateGame(input: ValidateGameInput): Promise<ValidateGameResult> {
  const { gameId, platform, username } = input;

  try {
    if (platform === 'lichess') {
      const result = await fetchLichessResult(gameId);
      return {
        ok: true,
        valid: true,
        platform: 'lichess',
        gameId: result.gameId,
        status: result.status,
        whitePlayer: result.whitePlayer,
        blackPlayer: result.blackPlayer,
        result: result.result,
      };
    } else {
      // chessdotcom — username already validated by validateGameInput
      const result = await fetchChessDotComResult(username as string, gameId);
      return {
        ok: true,
        valid: true,
        platform: 'chessdotcom',
        gameId: result.gameId,
        status: result.status,
        whitePlayer: result.whitePlayer,
        blackPlayer: result.blackPlayer,
        result: result.result,
      };
    }
  } catch (error) {
    if (error instanceof GameNotFoundError) {
      return {
        ok: false,
        status: 404,
        valid: false,
        platform,
        gameId,
        message: error.message,
      };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      ok: false,
      status: 500,
      valid: false,
      platform,
      gameId,
      message: `Validation failed: ${message}`,
    };
  }
}
