// Apply supabase/migrations/*.sql to DATABASE_URL (Supabase Postgres). Local PGlite migrates automatically.
import postgres from "postgres";
import { runMigrations } from "../apps/web/src/server/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to your Supabase Postgres connection string.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1 });
const ran = await runMigrations({
  exec: (q) => sql.unsafe(q),
  appliedNames: async () => (await sql.unsafe<{ name: string }[]>("select name from _mayflower_migrations")).map((r) => r.name),
});
console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
await sql.end();
