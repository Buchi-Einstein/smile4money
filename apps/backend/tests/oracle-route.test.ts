/**
 * Tests for the oracle /submit-result route.
 *
 * Focused on the match-not-found paths, specifically distinguishing between:
 * - gameId unknown but store has other records (regular 404)
 * - store completely empty (persistence-loss suspected 404)
 */

import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import oracleRouter from '../src/routes/oracle.js';
import { matchStore } from '../src/store/index.js';
import jwt from 'jsonwebtoken';

vi.mock('axios');

const secret = 'test-secret';
const makeToken = (address = 'GORACLE1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') =>
  jwt.sign({ address }, secret, { expiresIn: '1h' });

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/oracle', oracleRouter);
  return app;
};

const VALID_BODY = {
  matchId: 1,
  gameId: 'lichess-game-abc123',
  platform: 'lichess',
};

beforeEach(() => {
  matchStore.clear();
  vi.restoreAllMocks();
});

describe('POST /api/oracle/submit-result — match not found', () => {
  it('returns 404 with a generic message when gameId is unknown but store has records', async () => {
    // Seed a different match so the store is non-empty
    await matchStore.createMatch({
      player1: 'GPLAYER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      player2: 'GPLAYER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      player1Username: 'alice',
      player2Username: 'bob',
      stakeAmount: 100,
      token: 'XLM',
      gameId: 'some-other-game',
      platform: 'lichess',
    });

    const res = await request(createApp())
      .post('/api/oracle/submit-result')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Match not found');
    expect(res.body.details).toContain('lichess-game-abc123');
    // Must NOT carry the persistence-loss hint
    expect(res.body.hint).toBeUndefined();
  });

  it('returns 404 with a persistence-loss hint when the store is empty', async () => {
    // Store is already empty from beforeEach
    const res = await request(createApp())
      .post('/api/oracle/submit-result')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send(VALID_BODY);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Match not found');
    expect(res.body.hint).toBe('persistence_loss_suspected');
    expect(res.body.details).toMatch(/server may have restarted/i);
    expect(res.body.details).toMatch(/QUEUE_STORE/i);
  });

  it('logs oracle_match_not_found_empty_store at error level when store is empty', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await request(createApp())
      .post('/api/oracle/submit-result')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send(VALID_BODY);

    const loggedMessages = logSpy.mock.calls
      .flatMap((args) => args)
      .map((arg) => {
        try { return JSON.parse(arg as string); } catch { return null; }
      })
      .filter(Boolean);

    const entry = loggedMessages.find(
      (m) => m.message === 'oracle_match_not_found_empty_store',
    );
    expect(entry).toBeDefined();
    expect(entry.level).toBe('error');
    expect(entry.game_id).toBe('lichess-game-abc123');
    expect(entry.store_count).toBe(0);
  });

  it('logs oracle_match_not_found at warn level when store has records', async () => {
    await matchStore.createMatch({
      player1: 'GPLAYER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      player2: 'GPLAYER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      player1Username: 'alice',
      player2Username: 'bob',
      stakeAmount: 100,
      token: 'XLM',
      gameId: 'some-other-game',
      platform: 'lichess',
    });

    const logSpy = vi.spyOn(console, 'log');

    await request(createApp())
      .post('/api/oracle/submit-result')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send(VALID_BODY);

    const loggedMessages = logSpy.mock.calls
      .flatMap((args) => args)
      .map((arg) => {
        try { return JSON.parse(arg as string); } catch { return null; }
      })
      .filter(Boolean);

    const entry = loggedMessages.find(
      (m) => m.message === 'oracle_match_not_found',
    );
    expect(entry).toBeDefined();
    expect(entry.level).toBe('warn');
    expect(entry.store_count).toBe(1);
  });
});
