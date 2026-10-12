import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const conflict = (current: unknown) =>
  new HttpError(409, 'asset was changed by someone else; reload and try again', { current });

/** Parses and validates a JSON body, turning zod issues into a 400 the client can display. */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('body must be JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest(
      'validation failed',
      result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** A malformed id can never match anything, so it is reported like a missing row rather than a 500. */
export function idParam(c: Context, name = 'id'): string {
  const value = c.req.param(name);
  if (!value || !z.uuid().safeParse(value).success) throw notFound(name === 'id' ? 'resource' : name);
  return value;
}

/** Constraints a client can trip, with messages worth showing. Anything else is a bug and stays a 500. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  asset_room_needs_floor_ck: 'a room-level asset needs a floor',
  asset_room_on_floor_fk: 'room is not on the given floor',
  asset_floor_in_building_fk: 'floor is not in the given building',
  asset_building_fk: 'building not found',
  asset_asset_type_id_asset_type_id_fk: 'asset type not found',
  asset_condition_ck: 'condition must be between 1 and 5',
  asset_quantity_ck: 'quantity must be at least 1',
};

/** Drizzle wraps driver errors as "Failed query"; the Postgres error, naming the constraint, is on `cause`. */
export function fromDbError(err: unknown): HttpError | null {
  const cause = (err as { cause?: { message?: string } } | null)?.cause;
  const constraint = cause?.message?.match(/constraint "([^"]+)"/)?.[1];
  const message = constraint && CONSTRAINT_MESSAGES[constraint];
  return message ? badRequest(message, { constraint }) : null;
}

export function errorHandler(err: Error, c: Context) {
  const http = err instanceof HttpError ? err : fromDbError(err);
  if (http) return c.json({ error: http.message, details: http.details ?? null }, http.status);
  console.error(err);
  return c.json({ error: 'internal error', details: null }, 500);
}
