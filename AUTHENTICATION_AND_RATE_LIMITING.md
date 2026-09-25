# JWT Authentication & Rate Limiting Implementation

## Overview

This document describes the security enhancements made to the smile4money backend REST API to address missing authentication and rate limiting on critical endpoints.

## Problem Statement

**Before**: All REST endpoints were publicly accessible without authentication or rate limiting. Any actor discovering the backend URL could:
- Submit arbitrary match creation requests
- Query sensitive match data without authorization
- Launch abuse attacks through brute-force requests

## Solution Implemented

### 1. JWT Authentication for Mutating Endpoints

**Endpoint**: `POST /api/matches` (create match)

All requests to create matches now require a valid JWT token in the `Authorization` header.

#### How It Works

1. Client provides JWT in header: `Authorization: Bearer <token>`
2. Middleware validates the token signature using `JWT_SECRET`
3. Extracts the Stellar address (`address` claim) from the token
4. Attaches the address to `req.address` for use in route handlers
5. Returns 401 with detailed error message if token is missing, expired, or invalid

#### Configuration

Set `JWT_SECRET` in your environment:

```bash
# Generate a strong random secret (example)
export JWT_SECRET=$(openssl rand -base64 32)
```

**Important**: 
- Never commit real JWT_SECRET values to version control
- Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) in production
- Minimum recommended length: 32 bytes (256 bits)

#### Error Responses

```json
// Missing Authorization header
{
  "error": "unauthorized",
  "message": "Missing or invalid Authorization header"
}

// Token has expired
{
  "error": "unauthorized",
  "message": "Token has expired"
}

// Invalid token signature
{
  "error": "unauthorized",
  "message": "Invalid token"
}

// Token lacks address claim
{
  "error": "unauthorized",
  "message": "Invalid token payload"
}
```

#### Token Structure

JWTs must include the Stellar address in the `address` claim:

```javascript
const token = jwt.sign(
  { address: "GPLAYER1AAAAA..." },
  JWT_SECRET,
  { expiresIn: "1h" }
);
```

### 2. Rate Limiting for Public Read-Only Endpoints

**Endpoint**: `POST /api/validate-game` (validate game)

The validate-game endpoint is rate-limited to prevent abuse by unauthenticated users.

#### Configuration

- **Limit**: 100 requests per 60 seconds per IP address
- **Algorithm**: Token bucket with automatic refill
- **IP Detection**: Uses the direct connection IP. The `X-Forwarded-For` header is only honored when the request arrives from a proxy listed in the middleware's `trustedProxies` option (e.g. your own reverse proxy); by default the header is ignored so clients cannot spoof it to bypass rate limiting.

#### Rate Limit Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
```

#### Rate Limit Exceeded Response

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests, please try again later"
}
```

Status code: **429 Too Many Requests**

#### Memory Management

The rate limiter includes automatic cleanup:
- Stale buckets (no requests in 30 minutes) are removed
- Prevents unbounded memory growth in long-running servers
- Background cleanup runs every 10 minutes

### 3. Public Read-Only Endpoints

The following endpoints remain publicly accessible without authentication:

- `GET /health` — Health check (no rate limiting)
- `POST /api/validate-game` — Game validation (100 req/min rate limited)

These endpoints are safe for public access because:
- Health check is informational only
- Game validation queries public chess.com/Lichess APIs
- No state modification or sensitive data exposure

## Route Summary

| Endpoint | Method | Auth | Rate Limit | Purpose |
|----------|--------|------|-----------|---------|
| `/health` | GET | ✗ | ✗ | System health check |
| `/api/validate-game` | POST | ✗ | ✓ (100/min) | Validate chess game exists |
| `/api/matches` | POST | ✓ (JWT) | ✗ | Create new match (escrow) |

## Implementation Details

### Files Modified/Created

#### New Files
- `apps/backend/src/middleware/rate-limit.ts` — Rate limiting middleware
- `AUTHENTICATION_AND_RATE_LIMITING.md` — This documentation

#### Modified Files
- `.env.example` — Added JWT_SECRET documentation
- `apps/backend/src/middleware/auth.ts` — Enhanced with detailed error messages and security warnings
- `apps/backend/src/routes/validate-game.ts` — Added rate limiting middleware
- `apps/backend/package.json` — Added `cors` and `@types/cors` dependencies
- `apps/backend/tests/matches.test.ts` — Added comprehensive JWT authentication tests
- `apps/backend/tests/validate-game.test.ts` — Added rate limiting tests

### Rate Limiter Implementation

The `RateLimitStore` class implements a token bucket algorithm:

```typescript
// Each IP gets a "bucket" with tokens
const limiter = new RateLimitStore(
  capacity: 100,           // Max tokens in bucket
  refillIntervalMs: 60000, // Refill every 60 seconds
  refillAmount: 100        // Add 100 tokens per interval
);

// Check if request is allowed
if (limiter.isAllowed(clientIp)) {
  // Process request
}
```

**Benefits**:
- Simple and predictable rate limiting
- Handles burst traffic gracefully
- Memory-efficient with automatic cleanup

### Authentication Middleware

The `authenticate` middleware uses industry-standard JWT validation:

```typescript
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: '...' });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, SECRET);
    if (!payload.address) {
      return res.status(401).json({ error: 'unauthorized', message: '...' });
    }
    req.address = payload.address; // Attach to request
    next();
  } catch (error) {
    // Return appropriate error based on error type
  }
}
```

## Testing

### Test Coverage

✅ **39 tests pass** covering:

#### JWT Authentication (10 tests)
- Missing Authorization header
- Malformed tokens
- Expired tokens
- Missing address claim
- Successful authentication
- Address extraction from token

#### Rate Limiting (3 tests)
- Rate limit headers present
- Token tracking across requests
- Error message structure

#### Route Security (remaining tests)
- Input validation
- Platform-specific validation
- Duplicate game detection
- Game API integration

### Running Tests

```bash
cd apps/backend

# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm test -- tests/matches.test.ts tests/validate-game.test.ts
```

## Deployment Checklist

- [ ] Set `JWT_SECRET` environment variable to a strong random string
- [ ] Use a secrets manager to store `JWT_SECRET` (never in version control)
- [ ] Configure `ALLOWED_ORIGINS` CORS list with your frontend URL
- [ ] In production, set `NODE_ENV=production`
- [ ] Review and test rate limiting thresholds for your traffic
- [ ] Monitor 429 responses to detect abuse patterns
- [ ] Configure API gateway or reverse proxy for additional DDoS protection

## Security Considerations

### JWT Secret Management

**❌ DO NOT**:
```env
JWT_SECRET=test-secret  # ❌ Too weak
JWT_SECRET=password123  # ❌ Too weak
JWT_SECRET=              # ❌ Empty
```

**✅ DO**:
```bash
# Generate secure secret
openssl rand -base64 32
# Load from environment variable
export JWT_SECRET=$(aws secretsmanager get-secret-value --secret-id jwt-secret --query SecretString --output text)
```

### Rate Limiting Considerations

Current implementation is suitable for:
- Single-server deployments
- Development and testing
- Moderate traffic (<1000 req/s)

For production deployment with multiple servers, consider:
- Redis-based rate limiting (cluster-aware)
- AWS API Gateway throttling
- Cloudflare rate limiting
- NGINX rate modules

### Token Expiration

Tokens should have reasonable expiration:
```typescript
{ expiresIn: "1h" }    // ✅ Recommended
{ expiresIn: "24h" }   // ⚠️ Use only if tokens are short-lived
```

## Troubleshooting

### "unauthorized: Missing or invalid Authorization header"
- Ensure `Authorization` header is set
- Format must be: `Authorization: Bearer <token>`
- Token must be valid JWT

### "unauthorized: Token has expired"
- Generate a new token with longer expiration
- Implement token refresh mechanism

### "Too many requests, please try again later"
- Wait before making more requests
- Rate limit is 100 requests per 60 seconds per IP
- Check `X-RateLimit-Remaining` header

### "secretOrPrivateKey must have a value"
- Set `JWT_SECRET` environment variable
- Ensure it's not empty or undefined

## Future Improvements

1. **Token Refresh**: Implement refresh tokens for better security
2. **Rate Limiting Customization**: Per-endpoint rate limit configuration
3. **Redis Integration**: For multi-server deployments
4. **Rate Limit Persistence**: Store rate limit data across server restarts
5. **Admin Whitelist**: Allow certain IPs/tokens to bypass rate limits
6. **Metrics & Monitoring**: Track authentication failures and rate limits
7. **API Key Tier System**: Different rate limits for different client tiers

## References

- [JWT.io](https://jwt.io) — JWT documentation and debugger
- [Express.js Middleware](https://expressjs.com/en/guide/using-middleware.html)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [HTTP 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429)

## Questions?

For issues or questions about the authentication and rate limiting implementation, refer to:
1. Test cases in `tests/matches.test.ts` and `tests/validate-game.test.ts`
2. Middleware implementation in `src/middleware/auth.ts` and `src/middleware/rate-limit.ts`
3. Route integration in `src/routes/matches.ts` and `src/routes/validate-game.ts`
