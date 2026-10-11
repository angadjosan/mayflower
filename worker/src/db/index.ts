// One tiny query interface over either Supabase Postgres (DATABASE_URL) or
// in-process PGlite (no setup). Migrations in supabase/migrations run on boot.
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { config } from '../config.js';

export interface Db {
  readonly mode: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url).pathname;

export async function openDb(): Promise<Db> {
  const db = config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(config.pgliteDir);
  for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(MIGRATIONS + f, 'utf8'));
  }
  return db;
}

async function openPostgres(url: string): Promise<Db & { exec(sql: string): Promise<void> }> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 5, prepare: false, types: { numeric: { to: 0, from: [1700], serialize: String, parse: Number } } });
  return {
    mode: 'postgres',
    query: async <T>(q: string, p: unknown[] = []) => (await sql.unsafe(q, p as never[])) as unknown as T[],
    exec: async (q: string) => { await sql.unsafe(q); },
    close: () => sql.end(),
  };
}

async function openPglite(dir: string): Promise<Db & { exec(sql: string): Promise<void> }> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  await mkdir(dir, { recursive: true });
  const pg = new PGlite(dir, { parsers: { [types.NUMERIC]: (v: string) => Number(v) } });
  return {
    mode: 'pglite',
    query: async <T>(q: string, p: unknown[] = []) => (await pg.query<T>(q, p)).rows,
    exec: async (q: string) => { await pg.exec(q); },
    close: () => pg.close(),
  };
}
