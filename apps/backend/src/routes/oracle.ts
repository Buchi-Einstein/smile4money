import { Router } from 'express';
import { matchStore } from '../store/index.js';
import { authenticate } from '../middleware/auth.js';
import { validateSubmitResultInput, verifyGameResult } from '../services/oracle-service.js';

const router = Router();
const store = matchStore;

// Oracle endpoints require authentication
router.use(authenticate);

/**
 * POST /api/oracle/submit-result
 *
 * Submit a verified game result to the oracle.
 *
 * Request body:
 * ```json
 * {
 *   "matchId": 1,
 *   "gameId": "abc123",
 *   "platform": "lichess",
 *   "username": "alice"  // Optional, required for Chess.com
 * }
 * ```
 *
 * This endpoint:
 * 1. Fetches the game result from the chess platform API
 * 2. Verifies that the players in the API response match the registered players
 * 3. Returns the verified result for the oracle to submit on-chain
 *
 * The oracle (a privileged service) must then sign the result and call the
 * escrow contract's `submit_result` method on Stellar Soroban.
 */
router.post('/submit-result', async (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Request body must be JSON' });
  }

  const inputError = validateSubmitResultInput(payload);
  if (inputError) {
    return res.status(400).json({ error: inputError });
  }

  try {
    const result = await verifyGameResult(store, {
      matchId: payload.matchId,
      gameId: payload.gameId,
      platform: payload.platform,
      username: typeof payload.username === 'string' ? payload.username : undefined,
    });

    if (!result.ok) {
      const body: Record<string, unknown> = { error: result.error };
      if (result.details) body.details = result.details;
      if (result.hint) body.hint = result.hint;
      return res.status(result.status).json(body);
    }

    return res.status(200).json({
      verified: result.verified,
      matchId: result.matchId,
      gameId: result.gameId,
      result: result.result,
      whitePlayer: result.whitePlayer,
      blackPlayer: result.blackPlayer,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Result verification failed',
      details: message,
    });
  }
});

export default router;
