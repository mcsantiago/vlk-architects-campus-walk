import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { USER_HEADER } from '@campus-walk/shared';
import type { Db } from './db/client.ts';
import { errorHandler, HttpError } from './errors.ts';
import { routes } from './routes.ts';
import { getUser } from './services/users.ts';
import { MemoryPhotoStorage, type PhotoStorage } from './storage.ts';
import { noSuggester, type Suggester } from './suggest.ts';

export type Env = {
  Variables: {
    db: Db;
    storage: PhotoStorage;
    suggester: Suggester;
    /** Id from the X-User-Id header if it is well-formed; existence is checked by requireUser. */
    userId: string | null;
  };
};

/** Writes need a known user to attribute them to; reads do not. */
export async function requireUser(c: Context<Env>): Promise<string> {
  const id = c.get('userId');
  if (!id) throw new HttpError(401, `${USER_HEADER} header required`);
  const user = await getUser(c.get('db'), id);
  if (!user) throw new HttpError(401, 'unknown user');
  return user.id;
}

export interface AppOptions {
  db: Db;
  /** Defaults to in-memory storage and no AI, which is what tests and a bare local run want. */
  storage?: PhotoStorage;
  suggester?: Suggester;
  log?: boolean;
}

/** Builds the API against injected dependencies so tests can run it on in-memory PGlite with no server. */
export function createApp({ db, storage = new MemoryPhotoStorage(), suggester = noSuggester, log = false }: AppOptions) {
  const app = new Hono<Env>();

  if (log) app.use(logger());
  app.use(cors({ origin: (origin) => origin }));
  app.use(async (c, next) => {
    const header = c.req.header(USER_HEADER)?.trim();
    c.set('db', db);
    // Presigned photo URLs must be reachable by whoever is asking (a phone on the LAN, not localhost).
    c.set('storage', storage.forViewer(c.req.header('x-forwarded-host') ?? c.req.header('host')));
    c.set('suggester', suggester);
    c.set('userId', header && z.uuid().safeParse(header).success ? header : null);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', routes);

  app.notFound((c) => c.json({ error: 'not found', details: null }, 404));
  app.onError(errorHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
