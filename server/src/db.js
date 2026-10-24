import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Local calendar day (the server's timezone), used for daily AI limits. */
export const today = (date = new Date()) => date.toLocaleDateString('en-CA');
/** The local day `n` days before today. */
export const daysAgo = (n, from = new Date()) => today(new Date(from.getFullYear(), from.getMonth(), from.getDate() - n, 12));

// A gap this long without requests ends a visit; the next request starts a new one.
const VISIT_GAP_MS = 30 * 60_000;

const userRow = (r) =>
  r && {
    email: r.email,
    name: r.name || '',
    role: r.role,
    status: r.status,
    dailyLimit: r.daily_limit ?? null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at ?? null,
    addedBy: r.added_by ?? null,
  };

const visitRow = (r) => ({ id: r.id, email: r.email, startedAt: r.started_at, lastAt: r.last_at, via: r.via, ip: r.ip, userAgent: r.user_agent });

const topicRow = (r) => ({ name: r.name, field: r.field, focus: r.focus, type: r.type || undefined });

/**
 * Sessions are stored as one JSON document each, with a few columns pulled out for
 * listing. Every session belongs to one user (user_email) and is only reachable by them.
 */
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      topic TEXT NOT NULL,
      overall_score REAL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_created ON sessions (created_at DESC);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      daily_limit INTEGER,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      added_by TEXT
    );
    CREATE TABLE IF NOT EXISTS usage (
      email TEXT NOT NULL,
      day TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (email, day)
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      via TEXT,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS visits_email ON visits (email, started_at DESC);
    CREATE INDEX IF NOT EXISTS visits_started ON visits (started_at DESC);
    CREATE TABLE IF NOT EXISTS access_denied (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL,
      via TEXT,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS access_denied_at ON access_denied (at DESC);
    CREATE TABLE IF NOT EXISTS custom_topics (
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      field TEXT NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '',
      type TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (email, name)
    );
  `);
  // Migration from the single-user version: sessions gain an owner column.
  if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'user_email')) {
    db.exec('ALTER TABLE sessions ADD COLUMN user_email TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_email, created_at DESC)');
  if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === 'tokens')) {
    db.exec('ALTER TABLE usage ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0');
  }

  const q = {
    insert: db.prepare(
      'INSERT INTO sessions (id, created_at, updated_at, status, topic, overall_score, data, user_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    update: db.prepare('UPDATE sessions SET updated_at = ?, status = ?, overall_score = ?, data = ? WHERE id = ?'),
    getOne: db.prepare('SELECT data FROM sessions WHERE id = ? AND user_email = ?'),
    listMine: db.prepare('SELECT data FROM sessions WHERE user_email = ? ORDER BY created_at DESC LIMIT ?'),
    remove: db.prepare('DELETE FROM sessions WHERE id = ? AND user_email = ?'),
    removeAllFor: db.prepare('DELETE FROM sessions WHERE user_email = ?'),
    claimOrphans: db.prepare('UPDATE sessions SET user_email = ? WHERE user_email IS NULL'),
    moveSessions: db.prepare('UPDATE sessions SET user_email = ? WHERE user_email = ?'),
    moveTopics: db.prepare('UPDATE OR IGNORE custom_topics SET email = ? WHERE email = ?'),
    statsByUser: db.prepare(`
      SELECT user_email AS email, COUNT(*) AS sessions,
             SUM(status = 'completed') AS completed,
             SUM(status = 'active') AS in_progress,
             ROUND(AVG(CASE WHEN status = 'completed' THEN overall_score END)) AS avg_score,
             MAX(CASE WHEN status = 'completed' THEN overall_score END) AS best_score,
             MAX(created_at) AS last_session_at
      FROM sessions GROUP BY user_email`),
    sessionsMeta: db.prepare('SELECT id, created_at, status, topic, overall_score FROM sessions WHERE user_email = ? ORDER BY created_at DESC LIMIT ?'),
    visitLast: db.prepare('SELECT id, last_at FROM visits WHERE email = ? ORDER BY id DESC LIMIT 1'),
    visitInsert: db.prepare('INSERT INTO visits (email, started_at, last_at, via, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
    visitExtend: db.prepare('UPDATE visits SET last_at = ? WHERE id = ?'),
    visitsFor: db.prepare('SELECT * FROM visits WHERE email = ? ORDER BY started_at DESC LIMIT ?'),
    visitsRecent: db.prepare('SELECT * FROM visits ORDER BY started_at DESC LIMIT ?'),
    visitSummary: db.prepare('SELECT email, COUNT(*) AS visits, MIN(started_at) AS first_at FROM visits GROUP BY email'),
    visitLatestPerUser: db.prepare('SELECT v.* FROM visits v JOIN (SELECT email, MAX(id) AS id FROM visits GROUP BY email) m ON v.id = m.id'),
    visitsRemoveAllFor: db.prepare('DELETE FROM visits WHERE email = ?'),
    deniedInsert: db.prepare('INSERT INTO access_denied (email, reason, at, via, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
    deniedRecent: db.prepare('SELECT * FROM access_denied ORDER BY at DESC LIMIT ?'),
    kvGet: db.prepare('SELECT value FROM kv WHERE key = ?'),
    kvSet: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    userGet: db.prepare('SELECT * FROM users WHERE email = ?'),
    userList: db.prepare("SELECT * FROM users ORDER BY role = 'admin' DESC, created_at"),
    userInsert: db.prepare(
      'INSERT INTO users (email, name, role, status, daily_limit, created_at, added_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
    ),
    userMakeAdmin: db.prepare("UPDATE users SET role = 'admin', status = 'active' WHERE email = ?"),
    userUpdate: db.prepare('UPDATE users SET name = ?, status = ?, daily_limit = ? WHERE email = ?'),
    userTouch: db.prepare('UPDATE users SET last_seen_at = ? WHERE email = ?'),
    userRemove: db.prepare('DELETE FROM users WHERE email = ?'),
    usageGet: db.prepare('SELECT requests FROM usage WHERE email = ? AND day = ?'),
    usageAdd: db.prepare(
      'INSERT INTO usage (email, day, requests, tokens) VALUES (?, ?, ?, ?) ON CONFLICT(email, day) DO UPDATE SET requests = requests + excluded.requests, tokens = tokens + excluded.tokens',
    ),
    usageDay: db.prepare('SELECT email, requests FROM usage WHERE day = ?'),
    usageSince: db.prepare('SELECT email, SUM(requests) AS requests, SUM(tokens) AS tokens FROM usage WHERE day >= ? GROUP BY email'),
    usageDaily: db.prepare('SELECT day, requests, tokens FROM usage WHERE email = ? AND day >= ? ORDER BY day'),
    usageRemoveAllFor: db.prepare('DELETE FROM usage WHERE email = ?'),
    topicList: db.prepare('SELECT * FROM custom_topics WHERE email = ? ORDER BY created_at DESC'),
    topicUpsert: db.prepare(`
      INSERT INTO custom_topics (email, name, field, focus, type, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email, name) DO UPDATE SET field = excluded.field, focus = excluded.focus, type = excluded.type, created_at = excluded.created_at`),
    topicRemove: db.prepare('DELETE FROM custom_topics WHERE email = ? AND name = ?'),
    topicRemoveAllFor: db.prepare('DELETE FROM custom_topics WHERE email = ?'),
  };

  const score = (s) => s.report?.overallScore ?? null;

  return {
    create(session, email) {
      q.insert.run(session.id, session.createdAt, session.updatedAt, session.status, session.config.topic, score(session), JSON.stringify(session), email);
      return session;
    },
    save(session) {
      session.updatedAt = new Date().toISOString();
      q.update.run(session.updatedAt, session.status, score(session), JSON.stringify(session), session.id);
      return session;
    },
    /** Only returns the session if it belongs to `email`. */
    get(id, email) {
      const row = q.getOne.get(id, email);
      return row ? JSON.parse(row.data) : null;
    },
    list(email, limit = 200) {
      return q.listMine.all(email, limit).map((row) => JSON.parse(row.data));
    },
    remove(id, email) {
      return q.remove.run(id, email).changes > 0;
    },
    /** Hands sessions from the single-user era to the owner. */
    claimOrphans(email) {
      return Number(q.claimOrphans.run(email).changes);
    },
    /** Moves one account's interviews and topics to another (used to retire the local placeholder admin). */
    mergeUser(from, to) {
      const moved = Number(q.moveSessions.run(to, from).changes);
      q.moveTopics.run(to, from);
      q.topicRemoveAllFor.run(from);
      q.usageRemoveAllFor.run(from);
      q.visitsRemoveAllFor.run(from);
      q.userRemove.run(from);
      return moved;
    },
    statsByUser() {
      return Object.fromEntries(
        q.statsByUser.all().map((r) => [
          r.email,
          {
            sessions: Number(r.sessions),
            completed: Number(r.completed || 0),
            inProgress: Number(r.in_progress || 0),
            avgScore: r.avg_score ?? null,
            bestScore: r.best_score ?? null,
            lastSessionAt: r.last_session_at,
          },
        ]),
      );
    },
    /** Listing metadata only (topic, date, score), never answers. */
    sessionsMeta(email, limit = 20) {
      return q.sessionsMeta.all(email, limit).map((r) => ({ id: r.id, createdAt: r.created_at, status: r.status, topic: r.topic, overallScore: r.overall_score ?? null }));
    },

    /** Small app state that should survive restarts (e.g. AI quota readings). */
    kv: {
      get(key) {
        const row = q.kvGet.get(key);
        return row ? JSON.parse(row.value) : null;
      },
      set(key, value) {
        q.kvSet.run(key, JSON.stringify(value));
      },
    },

    users: {
      get: (email) => userRow(q.userGet.get(email)) || null,
      list: () => q.userList.all().map(userRow),
      add({ email, name = '', role = 'user', dailyLimit = null, addedBy = null }) {
        return q.userInsert.run(email, name, role, 'active', dailyLimit, new Date().toISOString(), addedBy).changes > 0;
      },
      ensureAdmin(email) {
        q.userInsert.run(email, '', 'admin', 'active', null, new Date().toISOString(), 'config');
        q.userMakeAdmin.run(email);
      },
      update(email, { name, status, dailyLimit }) {
        q.userUpdate.run(name, status, dailyLimit, email);
      },
      touch(email, at = new Date().toISOString()) {
        q.userTouch.run(at, email);
      },
      /** Removes access; with `withData` also their interviews, topics and usage. */
      remove(email, { withData = false } = {}) {
        const removed = q.userRemove.run(email).changes > 0;
        if (withData) {
          q.removeAllFor.run(email);
          q.topicRemoveAllFor.run(email);
          q.usageRemoveAllFor.run(email);
          q.visitsRemoveAllFor.run(email);
        }
        return removed;
      },
    },

    usage: {
      get: (email, day = today()) => Number(q.usageGet.get(email, day)?.requests ?? 0),
      add: (email, n = 1, tokens = 0, day = today()) => q.usageAdd.run(email, day, n, tokens),
      day: (day = today()) => Object.fromEntries(q.usageDay.all(day).map((r) => [r.email, Number(r.requests)])),
      /** Per user: requests and tokens for today, the last 7 and 30 days, and all time. */
      summary() {
        const out = {};
        for (const [key, since] of [['today', today()], ['week', daysAgo(6)], ['month', daysAgo(29)], ['total', '0000-00-00']]) {
          for (const r of q.usageSince.all(since)) {
            (out[r.email] ||= {})[key] = { requests: Number(r.requests || 0), tokens: Number(r.tokens || 0) };
          }
        }
        return out;
      },
      /** One entry per day for the last `days` days (zeros included), oldest first. */
      daily(email, days = 30) {
        const rows = Object.fromEntries(q.usageDaily.all(email, daysAgo(days - 1)).map((r) => [r.day, r]));
        return Array.from({ length: days }, (_, i) => {
          const day = daysAgo(days - 1 - i);
          return { day, requests: Number(rows[day]?.requests || 0), tokens: Number(rows[day]?.tokens || 0) };
        });
      },
    },

    visits: {
      /** Extends the caller's current visit, or starts a new one after a long gap. */
      record(email, { via = null, ip = null, userAgent = null } = {}, now = new Date()) {
        const last = q.visitLast.get(email);
        const at = now.toISOString();
        if (last && now.getTime() - Date.parse(last.last_at) < VISIT_GAP_MS) q.visitExtend.run(at, last.id);
        else q.visitInsert.run(email, at, at, via, ip, userAgent);
      },
      forUser: (email, limit = 50) => q.visitsFor.all(email, limit).map(visitRow),
      recent: (limit = 50) => q.visitsRecent.all(limit).map(visitRow),
      latest: () => Object.fromEntries(q.visitLatestPerUser.all().map((r) => [r.email, visitRow(r)])),
      summary: () => Object.fromEntries(q.visitSummary.all().map((r) => [r.email, { visits: Number(r.visits), firstAt: r.first_at }])),
    },

    denied: {
      record(email, reason, { via = null, ip = null, userAgent = null } = {}, now = new Date()) {
        q.deniedInsert.run(email, reason, now.toISOString(), via, ip, userAgent);
      },
      recent: (limit = 50) => q.deniedRecent.all(limit).map((r) => ({ id: r.id, email: r.email, reason: r.reason, at: r.at, via: r.via, ip: r.ip, userAgent: r.user_agent })),
    },

    topics: {
      list: (email) => q.topicList.all(email).map(topicRow),
      upsert: (email, t) => q.topicUpsert.run(email, t.name, t.field, t.focus, t.type ?? null, new Date().toISOString()),
      remove: (email, name) => q.topicRemove.run(email, name).changes > 0,
    },

    close() {
      db.close();
    },
  };
}
