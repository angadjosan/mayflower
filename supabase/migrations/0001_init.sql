-- Mayflower initial schema. Mirrors packages/shared/src/domain.ts.
-- Run with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users & preferences
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  imessage_handle text unique,              -- phone / Apple ID reported by BlueBubbles
  risk_limits jsonb not null default '{"totalBudget":0,"maxPerPosition":0,"maxThemeConcentration":0.4,"kellyFraction":0.25,"minEdge":0.05,"excludedTopics":[],"paused":false}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Users who first arrive via iMessage before signing up on the web get a
-- shadow profile keyed only by handle. auth.users row can be attached later.
create table if not exists imessage_identities (
  handle text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  chat_guid text,
  created_at timestamptz not null default now()
);

create table if not exists user_theses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic text not null,
  belief text not null,
  confidence numeric not null check (confidence between 0 and 1),
  is_interest boolean not null default false,
  source text not null default 'conversation' check (source in ('conversation','connector','agent')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index on user_theses(user_id) where active;

create table if not exists connected_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('gmail','notion','slack','discord')),
  scopes text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  connected_at timestamptz,
  revoked_at timestamptz
);

-- Exchange linking. Tokens are encrypted application-side (see packages/db/crypto.ts)
create table if not exists exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null default 'gemini',
  kind text not null check (kind in ('oauth','api-key','shared-sandbox')),
  roles text[] not null default '{trader}',
  encrypted_credentials text,               -- AES-256-GCM, base64; never plaintext
  status text not null default 'active' check (status in ('active','revoked','error')),
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint no_fund_manager check (not ('fund-manager' = any(roles)))
);

-- ---------------------------------------------------------------------------
-- Markets
-- ---------------------------------------------------------------------------
create table if not exists markets (
  id text primary key,                      -- exchange symbol / contract id
  exchange text not null default 'gemini',
  title text not null,
  event_id text,
  resolution_rules text,
  tags text[] not null default '{}',
  expires_at timestamptz,
  status text not null default 'unknown',
  url text,
  raw jsonb,
  updated_at timestamptz not null default now()
);
create index on markets using gin(tags);

create table if not exists market_quotes (
  id bigserial primary key,
  market_id text not null references markets(id) on delete cascade,
  ts timestamptz not null default now(),
  yes_bid numeric,
  yes_ask numeric,
  last numeric,
  liquidity numeric
);
create index on market_quotes(market_id, ts desc);

-- ---------------------------------------------------------------------------
-- Research / proposals / approvals / orders / positions
-- ---------------------------------------------------------------------------
create table if not exists research_reports (
  id uuid primary key default gen_random_uuid(),
  market_id text not null references markets(id),
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  what_must_happen text not null,
  why_now text not null,
  thesis text not null,
  evidence_for text[] not null default '{}',
  evidence_against text[] not null default '{}',
  risks text[] not null default '{}',
  citations jsonb not null default '[]',
  estimated_probability numeric not null,
  uncertainty numeric not null,
  market_probability numeric,
  critique text[] not null default '{}',
  watch_conditions text[] not null default '{}'
);

create table if not exists trade_proposals (
  id uuid primary key default gen_random_uuid(),
  version int not null default 1,
  user_id uuid not null references profiles(id) on delete cascade,
  market_id text not null references markets(id),
  research_report_id uuid references research_reports(id),
  kind text not null check (kind in ('open','increase','reduce','close','hedge')),
  side text not null check (side in ('YES','NO')),
  action text not null check (action in ('BUY','SELL')),
  quantity numeric not null,
  limit_price numeric not null,
  risk jsonb not null,
  discovery_reason text not null check (discovery_reason in ('personalized','general','monitor')),
  summary text not null,
  status text not null default 'pending_approval',
  expires_at timestamptz not null,
  binding_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on trade_proposals(user_id, status);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  proposal_id uuid not null references trade_proposals(id),
  proposal_version int not null,
  binding_hash text not null,
  decision text not null check (decision in ('approved','rejected')),
  channel text not null check (channel in ('imessage','web','voice')),
  evidence text,
  decided_at timestamptz not null default now(),
  unique (proposal_id, proposal_version)   -- one decision per proposal version
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  proposal_id uuid not null references trade_proposals(id),
  approval_id uuid not null references approvals(id),
  market_id text not null references markets(id),
  side text not null,
  action text not null,
  quantity numeric not null,
  limit_price numeric not null,
  mode text not null check (mode in ('live','sandbox','simulated')),
  client_order_id text not null unique,     -- idempotency: one order per approval
  exchange_order_id text,
  status text not null default 'pending',
  fills jsonb not null default '[]',
  error text,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  raw jsonb,
  unique (approval_id)
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  market_id text not null references markets(id),
  side text not null,
  quantity numeric not null default 0,
  avg_price numeric not null default 0,
  cost_basis numeric not null default 0,
  current_price numeric,
  unrealized_pnl numeric,
  realized_pnl numeric not null default 0,
  tags text[] not null default '{}',
  mode text not null,
  status text not null default 'open' check (status in ('open','closed','settled')),
  original_report_id uuid references research_reports(id),
  latest_report_id uuid references research_reports(id),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, market_id, side, mode)
);

create table if not exists monitor_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  position_id uuid not null references positions(id) on delete cascade,
  market_id text not null,
  trigger text not null,
  summary text not null,
  evidence jsonb not null default '[]',
  recommendation text not null,
  proposal_id uuid references trade_proposals(id),
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  actor text not null check (actor in ('user','agent','system','exchange')),
  action text not null,
  ref_type text,
  ref_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index on audit_events(user_id, created_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  channel text not null check (channel in ('imessage','web','voice')),
  text text not null,
  external_id text unique,                  -- BlueBubbles guid, for dedupe
  created_at timestamptz not null default now()
);
create index on messages(user_id, created_at desc);

-- Plan B ledger: per-user allocation when a shared sandbox account is used.
create table if not exists sandbox_ledger (
  user_id uuid primary key references profiles(id) on delete cascade,
  allocated numeric not null default 0,
  used numeric not null default 0
);

-- ---------------------------------------------------------------------------
-- Row-level security: users only ever see their own rows. The server uses the
-- service-role key for agent/webhook paths.
-- ---------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['profiles','user_theses','connected_sources','exchange_connections','research_reports','trade_proposals','approvals','orders','positions','monitor_events','audit_events','messages','sandbox_ledger']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    if t = 'profiles' then
      execute 'create policy "own rows" on profiles for all using (auth.uid() = id)';
    elsif t = 'research_reports' then
      execute 'create policy "own rows" on research_reports for select using (user_id is null or auth.uid() = user_id)';
    else
      execute format('create policy "own rows" on %I for all using (auth.uid() = user_id)', t);
    end if;
  end loop;
end $$;

alter table markets enable row level security;
create policy "markets are public" on markets for select using (true);
alter table market_quotes enable row level security;
create policy "quotes are public" on market_quotes for select using (true);

-- updated_at trigger
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text;
begin
  foreach t in array array['profiles','markets','trade_proposals','orders','positions']
  loop
    execute format('drop trigger if exists %I_updated_at on %I', t, t);
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
