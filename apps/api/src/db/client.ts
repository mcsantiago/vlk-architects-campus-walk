import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * On AWS the connection comes in parts: host, port and name as plain environment, user and
 * password injected from Secrets Manager. Locally DATABASE_URL is simpler and wins.
 */
function urlFromParts(env = process.env): string | undefined {
  if (!env.DB_HOST) return undefined;
  const auth = env.DB_USER ? `${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD ?? '')}@` : '';
  return `postgres://${auth}${env.DB_HOST}:${env.DB_PORT ?? '5432'}/${env.DB_NAME ?? 'campus_walk'}`;
}

/**
 * DATABASE_URL selects the driver:
 *   postgres://...        -> node-postgres (RDS, or any real Postgres)
 *   pglite://<dir>        -> embedded Postgres persisted to <dir> (local dev default)
 *   pglite://memory       -> embedded, in-memory (tests)
 */
export function createDb(url = process.env.DATABASE_URL ?? urlFromParts() ?? 'pglite://.data/pg'): DbHandle {
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    let client: PGlite;
    if (target === 'memory') {
      client = new PGlite();
    } else {
      const dir = path.resolve(target);
      mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    const db = drizzlePglite(client, { schema });
    return {
      db,
      migrate: () => migratePglite(db, { migrationsFolder }),
      close: () => client.close(),
    };
  }

  const pool = new pg.Pool({
    connectionString: url,
    // RDS requires TLS; the RDS CA is not in Node's default store, so skip verification there.
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : false,
    max: 10,
  });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    migrate: () => migratePg(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}
