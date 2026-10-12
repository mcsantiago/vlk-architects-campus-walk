import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';

export function listUsers(db: Db) {
  return db.select().from(s.user).orderBy(s.user.name);
}

export async function getUser(db: Db, id: string) {
  const [user] = await db.select().from(s.user).where(eq(s.user.id, id));
  return user ?? null;
}

async function findByName(db: Db, name: string) {
  const [user] = await db.select().from(s.user).where(sql`lower(${s.user.name}) = lower(${name})`);
  return user ?? null;
}

/** Names are matched case-insensitively, so "dana r." picks up the existing "Dana R." rather than forking the audit log. */
export async function findOrCreateUser(db: Db, name: string) {
  const existing = await findByName(db, name);
  if (existing) return existing;
  await db.insert(s.user).values({ name }).onConflictDoNothing();
  return (await findByName(db, name))!;
}
