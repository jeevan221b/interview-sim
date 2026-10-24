import { timingSafeEqual } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const safeEqual = (a, b) => {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Authentication for /api routes: works out *who* is calling and stores it as
 * c.get('identity') = { email, via }. Whether that person may use the app is decided
 * afterwards against the users table (see app.js). Modes (combinable, e.g. "cloudflare,token"):
 * - none:       local development only (the server refuses to bind beyond localhost).
 *               Everyone is the first admin, or whoever the X-Dev-User header names,
 *               so multi-user behaviour can be tried on one machine.
 * - cloudflare: require a valid Cloudflare Access JWT for this app's AUD.
 * - token:      ACCESS_TOKEN as a Bearer token signs in as the first admin (the
 *               Tailscale/ssh fallback; never a way in for other users).
 *
 * @param {ReturnType<import('./config.js').loadConfig>['auth']} auth
 * @param {{ jwks?: any }} [deps] injectable key set for tests
 */
export function createAuth(auth, deps = {}) {
  const modes = new Set(auth.modes);
  const owner = auth.adminEmails[0];

  if (modes.has('none')) {
    const devEmail = owner || 'admin@localhost';
    return {
      mode: 'none',
      middleware: async (c, next) => {
        const asked = (c.req.header('x-dev-user') || '').trim().toLowerCase();
        c.set('identity', { email: EMAIL_RE.test(asked) ? asked : devEmail, via: 'dev' });
        return next();
      },
    };
  }

  if (!owner) throw new Error('ADMIN_EMAILS must name at least one admin when AUTH_MODE is not "none"');
  if (modes.has('token') && auth.accessToken.length < 24) {
    throw new Error('AUTH_MODE includes "token" but ACCESS_TOKEN is missing or shorter than 24 chars');
  }
  let jwks;
  if (modes.has('cloudflare')) {
    if (!auth.cfTeamDomain || !auth.cfAud) {
      throw new Error('AUTH_MODE includes "cloudflare" but CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are not set');
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
      return EMAIL_RE.test(email) ? email : null;
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
          c.set('identity', { email, via: 'cloudflare' });
          return next();
        }
        // A Cloudflare token was presented but is invalid: never fall through to token auth.
        return c.json({ error: 'unauthorized', code: 'unauthorized' }, 401);
      }
    }
    if (modes.has('token')) {
      const header = c.req.header('authorization') || '';
      const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (safeEqual(supplied, auth.accessToken)) {
        c.set('identity', { email: owner, via: 'token' });
        return next();
      }
    }
    return c.json({ error: 'unauthorized', code: 'unauthorized' }, 401);
  };

  return { mode: [...modes].join(','), middleware };
}
