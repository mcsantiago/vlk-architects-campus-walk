import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { storageFromEnv } from './storage.ts';
import { suggesterFromEnv } from './suggest.ts';

const handle = createDb();
if (process.env.AUTO_MIGRATE !== 'false') await handle.migrate();

const app = createApp({ db: handle.db, storage: storageFromEnv(), suggester: suggesterFromEnv(), log: true });
const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void handle.close().finally(() => process.exit(0));
  });
}
