-- Mayflower state: one versioned jsonb document (optimistic concurrency in src/lib/db.ts).
create table if not exists public.mayflower_state (
  id text primary key,
  data jsonb not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Server uses the service role key (bypasses RLS). No policies = anon/authenticated clients get nothing.
alter table public.mayflower_state enable row level security;
