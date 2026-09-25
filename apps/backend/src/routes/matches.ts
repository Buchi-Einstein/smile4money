import { Router } from 'express';
import { matchStore } from '../store/index.js';
import { authenticate } from '../middleware/auth.js';
import { validateCreateMatchInput, createMatchForPlayer } from '../services/match-service.js';

const router = Router();
const store = matchStore;

router.use(authenticate);

router.post('/', async (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Request body must be JSON' });
  }

  // Validate input fields before calling the service
  const validationError = validateCreateMatchInput(req.address, payload);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const result = await createMatchForPlayer(store, req.address, {
    player2: payload.player2,
    stakeAmount: payload.stakeAmount,
    token: payload.token,
    gameId: payload.gameId,
    platform: payload.platform,
    username: typeof payload.username === 'string' ? payload.username : undefined,
  });

  if (!result.ok) {
    const body: Record<string, string> = { error: result.error };
    if (result.details) body.details = result.details;
    return res.status(result.status).json(body);
  }

  return res.status(201).json(result.match);
});

export default router;
