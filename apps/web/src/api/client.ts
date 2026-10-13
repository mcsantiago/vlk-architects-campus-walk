import { USER_HEADER, type ApiErrorBody } from '@campus-walk/shared';
import { currentUser, setCurrentUser } from '../user';

/**
 * Where the API lives. Default is /api on this origin: the Vite dev server proxies it to the
 * API, and the deployment routes it at the edge. VITE_API_URL overrides it at build time.
 */
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
  /** The live record the server sent back with a 409. */
  get current(): unknown {
    return this.status === 409 && this.details && typeof this.details === 'object'
      ? (this.details as { current?: unknown }).current
      : undefined;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Raw body (CSV text) with its content type; skips JSON encoding. */
  text?: { body: string; contentType: string };
}

/** One fetch wrapper: JSON in and out, the chosen user on every write, errors as ApiError. */
export async function api<T>(path: string, { method = 'GET', body, text }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const user = currentUser();
  if (user) headers[USER_HEADER] = user.id;
  let payload: BodyInit | undefined;
  if (text) {
    headers['content-type'] = text.contentType;
    payload = text.body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'network error: is the API running?');
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (isJson ? data : { error: String(data) || res.statusText, details: null }) as ApiErrorBody;
    // The stored user no longer exists on the server (reseeded database, different environment):
    // forget it so the app returns to the name screen instead of failing every write.
    if (res.status === 401 && user) setCurrentUser(null);
    throw new ApiError(res.status, err.error, err.details);
  }
  return data as T;
}

/** A human line for an error, including zod issues when the server sent them. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (Array.isArray(e.details)) {
      const issues = e.details as Array<{ path?: string; line?: number; message: string }>;
      return `${e.message}: ${issues.map((i) => (i.path ? `${i.path} ${i.message}` : i.line ? `line ${i.line}: ${i.message}` : i.message)).join('; ')}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
