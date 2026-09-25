import request from 'supertest';
import { describe, it, expect } from 'vitest';
import express from 'express';
import { RateLimitStore, createRateLimitMiddleware } from '../src/middleware/rate-limit.js';

const createApp = (options?: { trustedProxies?: string[]; capacity?: number }) => {
  const store = new RateLimitStore(options?.capacity ?? 100, 60 * 1000, 100);
  const app = express();
  app.use(createRateLimitMiddleware(store, options));
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
};

/** Discover the direct connection IP supertest uses when hitting the app. */
const getRemoteAddress = async (): Promise<string> => {
  const app = express();
  app.get('/', (_req, res) => res.json({ ip: _req.socket.remoteAddress }));
  const response = await request(app).get('/');
  return response.body.ip as string;
};

describe('createRateLimitMiddleware client IP detection', () => {
  it('ignores X-Forwarded-For by default and buckets by direct connection IP', async () => {
    const app = createApp({ capacity: 2 });

    // All requests share the same bucket because the spoofed
    // X-Forwarded-For headers are ignored and the direct connection IP is used.
    const r1 = await request(app).get('/').set('X-Forwarded-For', '1.2.3.4');
    const r2 = await request(app).get('/').set('X-Forwarded-For', '5.6.7.8');
    const r3 = await request(app).get('/').set('X-Forwarded-For', '9.9.9.9');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Third request hits the 2-token bucket for the shared direct IP
    expect(r3.status).toBe(429);
  });

  it('honors X-Forwarded-For when the connection arrives from a trusted proxy', async () => {
    const remoteAddress = await getRemoteAddress();
    const app = createApp({ trustedProxies: [remoteAddress], capacity: 2 });

    // Two distinct client IPs get separate buckets of 2 tokens each.
    const r1 = await request(app).get('/').set('X-Forwarded-For', '1.2.3.4');
    const r2 = await request(app).get('/').set('X-Forwarded-For', '5.6.7.8');
    const r3 = await request(app).get('/').set('X-Forwarded-For', '5.6.7.8');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200); // still within 5.6.7.8's own bucket
  });

  it('uses the direct connection IP when a trusted proxy sends no X-Forwarded-For', async () => {
    const remoteAddress = await getRemoteAddress();
    const app = createApp({ trustedProxies: [remoteAddress], capacity: 2 });

    const r1 = await request(app).get('/');
    const r2 = await request(app).get('/');
    const r3 = await request(app).get('/');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
  });
});
