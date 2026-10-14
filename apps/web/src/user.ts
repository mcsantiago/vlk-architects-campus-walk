import { useSyncExternalStore } from 'react';
import type { UserRef } from '@campus-walk/shared';

/**
 * Identity is a name the walker picks once; the API finds-or-creates the user and we keep the id
 * here. Sent as x-user-id on every write so the audit trail and walk status name a person.
 */
const KEY = 'campus-walk.user';
const listeners = new Set<() => void>();
let cached: UserRef | null | undefined;

export function currentUser(): UserRef | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as UserRef) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setCurrentUser(user: UserRef | null): void {
  const previous = cached ?? null;
  cached = user;
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else {
      localStorage.removeItem(KEY);
      // Keep the name so the name screen can offer it back after a forced sign-out.
      if (previous) writePref('last-name', previous.name);
    }
  } catch {
    /* private mode: identity lives for the session only */
  }
  listeners.forEach((l) => l());
}

export function useCurrentUser(): UserRef | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    currentUser,
    () => null,
  );
}

/** Small per-device preferences (the last walker name) with the same storage rules. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`campus-walk.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`campus-walk.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
