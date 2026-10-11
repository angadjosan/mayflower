import fs from "node:fs";
import path from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export { schema };

interface MigrationAdapter {
  exec(sql: string): Promise<unknown>;
  appliedNames(): Promise<string[]>;
}

/** Find the repository root (the directory containing supabase/migrations). */
export function repoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "supabase", "migrations"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function migrationFiles(root = repoRoot()): { name: string; sql: string }[] {
  const dir = path.join(root, "supabase", "migrations");
  if (!fs.existsSync(dir)) throw new Error(`Migrations directory not found at ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

export async function runMigrations(adapter: MigrationAdapter): Promise<string[]> {
  await adapter.exec("create table if not exists _mayflower_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set(await adapter.appliedNames());
  const ran: string[] = [];
  for (const m of migrationFiles()) {
    if (applied.has(m.name)) continue;
    await adapter.exec(m.sql);
    await adapter.exec(`insert into _mayflower_migrations(name) values ('${m.name.replace(/'/g, "''")}')`);
    ran.push(m.name);
  }
  return ran;
}

async function createPostgres(url: string): Promise<DB> {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  // prepare:false keeps us compatible with Supabase's transaction-mode pooler.
  const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_SIZE ?? 5) });
  if (process.env.DB_AUTO_MIGRATE === "true") {
    await runMigrations({
      exec: (sql) => client.unsafe(sql),
      appliedNames: async () => (await client.unsafe<{ name: string }[]>("select name from _mayflower_migrations")).map((r) => r.name),
    });
  }
  return drizzle(client, { schema });
}

export async function createPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await runMigrations({
    exec: (sql) => client.exec(sql),
    appliedNames: async () => (await client.query<{ name: string }>("select name from _mayflower_migrations")).rows.map((r) => r.name),
  });
  return drizzle(client, { schema }) as unknown as DB;
}

const g = globalThis as unknown as { __mayflowerDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__mayflowerDb) {
    const url = process.env.DATABASE_URL;
    g.__mayflowerDb = url
      ? createPostgres(url)
      : createPglite(process.env.PGLITE_MEMORY === "true" ? undefined : (process.env.PGLITE_DIR ?? path.join(repoRoot(), ".data", "pglite")));
    g.__mayflowerDb.catch(() => {
      g.__mayflowerDb = undefined;
    });
  }
  return g.__mayflowerDb;
}

/** Tests: use a fresh database instance. */
export function setDb(db: DB | null): void {
  g.__mayflowerDb = db ? Promise.resolve(db) : undefined;
}

export function databaseLabel(): "supabase/postgres" | "pglite (local)" {
  return process.env.DATABASE_URL ? "supabase/postgres" : "pglite (local)";
}
