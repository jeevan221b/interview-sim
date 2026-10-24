import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createLlm } from './llm/index.js';

const config = loadConfig();
if (config.auth.modes.includes('none') && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  console.error(`[interview-sim] refusing to listen on ${config.host} with AUTH_MODE=none; set AUTH_MODE=google, cloudflare or token`);
  process.exit(1);
}
const db = openDb(config.dbPath);
// Admins and pre-invited users from .env; interviews from before multi-user belong to the first admin.
const owner = config.auth.adminEmails[0] || 'admin@localhost';
for (const email of config.auth.adminEmails) db.users.ensureAdmin(email);
for (const email of config.auth.allowedEmails) db.users.add({ email, addedBy: 'config' });
// Before ADMIN_EMAILS was set, local dev ran as a placeholder admin; hand its data to the real one.
if (config.auth.adminEmails.length && db.users.get('admin@localhost')) {
  const moved = db.mergeUser('admin@localhost', owner);
  console.log(`[interview-sim] moved ${moved} interview(s) from the local placeholder admin to ${owner}`);
}
const claimed = db.claimOrphans(owner);
if (claimed) console.log(`[interview-sim] assigned ${claimed} existing interview(s) to ${owner}`);
const llm = createLlm(config.llm, { store: db.kv });

let lastActivity = Date.now();
const app = createApp({ config, db, llm, onActivity: () => (lastActivity = Date.now()) });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`[interview-sim] listening on http://${address}:${port}`);
  console.log(`[interview-sim] AI providers: ${llm.providers.map((p) => p.label).join(' → ') || 'none'}`);
  console.log(`[interview-sim] auth: ${config.auth.modes.join(',')}`);
});

// On-demand hosting: exit after a quiet period so the host doesn't run it 24/7.
if (config.idleShutdownMinutes > 0) {
  setInterval(() => {
    if (Date.now() - lastActivity > config.idleShutdownMinutes * 60_000) {
      console.log(`[interview-sim] idle for ${config.idleShutdownMinutes} min, shutting down`);
      db.close();
      process.exit(0);
    }
  }, 60_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
