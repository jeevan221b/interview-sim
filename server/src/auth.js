import { timingSafeEqual } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const safeEqual = (a, b) => {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Auth middleware for /api routes. Modes (combinable, e.g. "cloudflare,token"):
 * - none:       no checks; only for a server bound to localhost.
 * - cloudflare: require a valid Cloudflare Access JWT for this app's AUD, and an
 *               allowed email. Protects the app even if Access is misconfigured.
 * - token:      require ACCESS_TOKEN as a Bearer token (the Tailscale/ssh fallback).
 *
 * @param {ReturnType<import('./config.js').loadConfig>['auth']} auth
 * @param {{ jwks?: any }} [deps] injectable key set for tests
 */
export function createAuth(auth, deps = {}) {
  const modes = new Set(auth.modes);
  if (modes.has('none')) return { mode: 'none', middleware: async (_c, next) => next() };

  if (modes.has('token') && auth.accessToken.length < 24) {
    throw new Error('AUTH_MODE includes "token" but ACCESS_TOKEN is missing or shorter than 24 chars');
  }
  let jwks;
  if (modes.has('cloudflare')) {
    if (!auth.cfTeamDomain || !auth.cfAud) {
      throw new Error('AUTH_MODE includes "cloudflare" but CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are not set');
    }
    if (!auth.allowedEmails.length) {
      throw new Error('AUTH_MODE includes "cloudflare" but ALLOWED_EMAILS is empty');
    }
    jwks = deps.jwks || createRemoteJWKSet(new URL(`https://${auth.cfTeamDomain}/cdn-cgi/access/certs`));
  }

  const verifyCloudflare = async (jwt) => {
    try {
      const { payload } = await jwtVerify(jwt, jwks, {
        issuer: `https://${auth.cfTeamDomain}`,
        audience: auth.cfAud,
      });
      const email = String(payload.email || '').toLowerCase();
      return auth.allowedEmails.includes(email) ? email : null;
    } catch {
      return null;
    }
  };

  const middleware = async (c, next) => {
    if (jwks) {
      const jwt = c.req.header('cf-access-jwt-assertion') || getCookie(c, 'CF_Authorization');
      if (jwt) {
        const email = await verifyCloudflare(jwt);
        if (email) {
          c.set('user', email);
          return next();
        }
        // A Cloudflare token was presented but is invalid: never fall through to token auth.
        return c.json({ error: 'unauthorized' }, 401);
      }
    }
    if (modes.has('token')) {
      const header = c.req.header('authorization') || '';
      const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (safeEqual(supplied, auth.accessToken)) {
        c.set('user', 'token');
        return next();
      }
    }
    return c.json({ error: 'unauthorized' }, 401);
  };

  return { mode: [...modes].join(','), middleware };
}
