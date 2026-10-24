import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Sessions are stored as one JSON document each, with a few columns pulled out for listing. */
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
  `);

  const insert = db.prepare(
    'INSERT INTO sessions (id, created_at, updated_at, status, topic, overall_score, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE sessions SET updated_at = ?, status = ?, overall_score = ?, data = ? WHERE id = ?',
  );
  const getOne = db.prepare('SELECT data FROM sessions WHERE id = ?');
  const listAll = db.prepare('SELECT data FROM sessions ORDER BY created_at DESC LIMIT ?');
  const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
  const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const kvSet = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  const score = (s) => s.report?.overallScore ?? null;

  return {
    create(session) {
      insert.run(
        session.id,
        session.createdAt,
        session.updatedAt,
        session.status,
        session.config.topic,
        score(session),
        JSON.stringify(session),
      );
      return session;
    },
    save(session) {
      session.updatedAt = new Date().toISOString();
      update.run(session.updatedAt, session.status, score(session), JSON.stringify(session), session.id);
      return session;
    },
    /** Small app state that should survive restarts (e.g. AI quota readings). */
    kv: {
      get(key) {
        const row = kvGet.get(key);
        return row ? JSON.parse(row.value) : null;
      },
      set(key, value) {
        kvSet.run(key, JSON.stringify(value));
      },
    },
    get(id) {
      const row = getOne.get(id);
      return row ? JSON.parse(row.data) : null;
    },
    list(limit = 200) {
      return listAll.all(limit).map((row) => JSON.parse(row.data));
    },
    remove(id) {
      return remove.run(id).changes > 0;
    },
    close() {
      db.close();
    },
  };
}
