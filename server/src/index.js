import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createLlm } from './llm/index.js';

const config = loadConfig();
if (config.auth.modes.includes('none') && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  console.error(`[interview-sim] refusing to listen on ${config.host} with AUTH_MODE=none; set AUTH_MODE=token or cloudflare`);
  process.exit(1);
}
const db = openDb(config.dbPath);
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
