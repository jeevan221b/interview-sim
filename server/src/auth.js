import { timingSafeEqual } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

const safeEqual = (a, b) => {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SESSION_COOKIE = 'isim_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Authentication for /api routes: works out *who* is calling and stores it as
 * c.get('identity') = { email, via }. Whether that person may use the app is decided
 * afterwards against the users table (see app.js). Modes (combinable, e.g. "cloudflare,token"):
 * - none:       local development only (the server refuses to bind beyond localhost).
 *               Everyone is the first admin, or whoever the X-Dev-User header names,
 *               so multi-user behaviour can be tried on one machine.
 * - cloudflare: require a valid Cloudflare Access JWT for this app's AUD.
 * - google:     "Sign in with Google" in the web app. The Google credential is verified once
 *               (POST /api/auth/google) and exchanged for this app's own signed session cookie.
 * - token:      ACCESS_TOKEN as a Bearer token signs in as the first admin (the
 *               Tailscale/ssh fallback; never a way in for other users).
 *
 * @param {ReturnType<import('./config.js').loadConfig>['auth']} auth
 * @param {{ jwks?: any, googleJwks?: any, sessionSecret?: Uint8Array }} [deps] injectable key sets for
 *   tests; sessionSecret signs google-mode session cookies (required for that mode)
 */
export function createAuth(auth, deps = {}) {
  const modes = new Set(auth.modes);
  const owner = auth.adminEmails[0];

  if (modes.has('none')) {
    const devEmail = owner || 'admin@localhost';
    return {
      mode: 'none',
      modes: ['none'],
      google: null,
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
  let google = null;
  if (modes.has('google')) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(auth.googleClientId)) {
      throw new Error('AUTH_MODE includes "google" but GOOGLE_CLIENT_ID is not a ...apps.googleusercontent.com client ID');
    }
    if (!(deps.sessionSecret?.length >= 32)) throw new Error('google auth needs a session secret of at least 32 bytes');
    google = createGoogle(auth.googleClientId, deps.sessionSecret, deps.googleJwks);
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
    if (google) {
      const session = getCookie(c, SESSION_COOKIE);
      if (session) {
        const email = await google.readSession(session);
        if (email) {
          c.set('identity', { email, via: 'google' });
          return next();
        }
        // Expired or forged cookie: sign in again rather than trying other modes.
        return c.json({ error: 'Your sign-in has expired.', code: 'unauthorized' }, 401);
      }
    }
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

  return { mode: [...modes].join(','), modes: [...modes], middleware, google };
}

/** Google credential verification plus this app's own HS256 session tokens. */
function createGoogle(clientId, secret, googleJwks) {
  const keys = googleJwks || createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    clientId,
    /** @returns {Promise<{ email: string, name: string } | null>} only for a verified Google email */
    async verifyCredential(credential) {
      try {
        const { payload } = await jwtVerify(credential, keys, { issuer: GOOGLE_ISSUERS, audience: clientId });
        const email = String(payload.email || '').toLowerCase();
        return payload.email_verified === true && EMAIL_RE.test(email) ? { email, name: String(payload.name || '') } : null;
      } catch {
        return null;
      }
    },
    issueSession: (email) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('interview-sim')
        .setAudience('session')
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_MAX_AGE)
        .sign(secret),
    async readSession(token) {
      try {
        const { payload } = await jwtVerify(token, secret, { issuer: 'interview-sim', audience: 'session', algorithms: ['HS256'] });
        const email = String(payload.email || '');
        return EMAIL_RE.test(email) ? email : null;
      } catch {
        return null;
      }
    },
  };
}
