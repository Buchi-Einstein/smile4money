import { Request, Response, NextFunction } from 'express';
import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

/**
 * JWT_SECRET is used to sign and verify authentication tokens.
 * REQUIRED: Must be a strong, random string set in the environment.
 * If not set, defaults to 'test-secret' for development only.
 * NEVER use default in production.
 */
const DEFAULT_SECRET = 'test-secret';
const SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;

// Hard fail at startup in production: a missing or default JWT_SECRET lets
// anyone forge tokens with the well-known default, so refusing to start is
// the only safe behavior. The default is only acceptable for local development.
if (process.env.NODE_ENV === 'production' && SECRET === DEFAULT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set (or is set to the known default "test-secret"). ' +
      'Refusing to start in production. Set JWT_SECRET to a strong, random ' +
      'string in your environment variables.',
  );
}

declare module 'express-serve-static-core' {
  interface Request {
    address?: string;
  }
}

/**
 * Authentication middleware that verifies JWT tokens in the Authorization header.
 * Extracts the Stellar address from the JWT payload and attaches it to req.address.
 *
 * Expected header format: "Authorization: Bearer <jwt-token>"
 * JWT payload must contain: { address: "<stellar-address>" }
 *
 * Returns:
 * - 401 if no Authorization header is provided
 * - 401 if token is malformed or invalid
 * - 401 if token has expired
 * - 401 if token doesn't contain a valid address claim
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, SECRET) as { address?: string };
    if (!payload || typeof payload.address !== 'string') {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid token payload' });
    }
    req.address = payload.address;
    next();
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return res.status(401).json({ error: 'unauthorized', message: 'Token has expired' });
    }
    if (error instanceof JsonWebTokenError) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
    }
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication failed' });
  }
}
