-- Mayflower schema. Runs on Supabase Postgres and on local PGlite (worker/src/db).
-- Phone number is the user id. Money in USD, prices/probabilities in [0,1].

create table if not exists users (
  phone text primary key,
  name text,
  risk_budget numeric not null default 200,
  per_trade_cap numeric not null default 20,
  interests text[] not null default '{}',
  excluded_topics text[] not null default '{}',
  ledger_balance numeric not null default 0,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  direction text not null check (direction in ('in','out')),
  channel text not null,
  body text not null,
  has_audio boolean not null default false,
  external_id text unique,              -- BlueBubbles guid; unique = webhook dedupe
  created_at timestamptz not null default now()
);

create table if not exists beliefs (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null references users(phone),
  text text not null,
  topic text,
  source text not null default 'text' check (source in ('text','voice')),
  stated_at timestamptz not null default now()
);

create table if not exists markets (
  instrument_symbol text primary key,
  event_ticker text not null,
  title text not null,
  label text,
  category text,
  rules text,
  expiry timestamptz,
  status text,
  sandbox_listed boolean not null default false,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists ticks (
  id bigserial primary key,
  instrument_symbol text not null,
  ts timestamptz not null,
  bid numeric,
  ask numeric,
  last numeric,
  trade_size numeric,
  trade_side text,
  source text not null default 'production'
);
create index if not exists ticks_symbol_ts on ticks (instrument_symbol, ts);

create table if not exists research (
  id uuid primary key default gen_random_uuid(),
  instrument_symbol text not null,
  belief_id uuid references beliefs(id),
  queries text[] not null default '{}',
  sources jsonb not null default '[]',
  for_points jsonb not null default '[]',
  against_points jsonb not null default '[]',
  p_model numeric,
  p_market numeric,
  p_final numeric,
  w numeric,
  critic jsonb,
  created_at timestamptz not null default now()
);

create table if not exists verdicts (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null references users(phone),
  belief_id uuid references beliefs(id),
  instrument_symbol text,
  research_id uuid references research(id),
  type text not null check (type in ('no_market','priced_in','against','edge')),
  reasoning text not null,
  numbers jsonb not null default '{}',   -- full risk-engine output for the case page
  created_at timestamptz not null default now()
);

create table if not exists radar_events (
  id uuid primary key default gen_random_uuid(),
  instrument_symbol text not null,
  move_start timestamptz not null,
  move_size numeric not null,
  z_score numeric not null,
  volume_skew numeric,
  first_news_at timestamptz,
  lead_minutes numeric,
  status text not null default 'unexplained',
  created_at timestamptz not null default now()
);

create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null references users(phone),
  verdict_id uuid references verdicts(id),
  instrument_symbol text not null,
  side text not null check (side in ('yes','no')),
  qty numeric not null,
  limit_price numeric not null,
  stake numeric not null,
  max_loss numeric not null,
  hedge jsonb,
  exit_rules jsonb not null default '{}',
  code text not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','approved','executed','failed','expired','cancelled')),
  created_at timestamptz not null default now()
);
-- one live code per user at a time; a code can only ever be claimed once (status transition)
create unique index if not exists proposals_pending_code on proposals (user_phone, code) where status = 'pending';

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references proposals(id),  -- one order per approval
  exchange_order_id text,
  submitted_terms jsonb not null,
  status text not null,
  filled_qty numeric not null default 0,
  avg_price numeric,
  error text,
  sim_flag boolean not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null references users(phone),
  instrument_symbol text not null,
  side text not null check (side in ('yes','no')),
  qty numeric not null default 0,
  cost_basis numeric not null default 0,
  mark numeric,
  unrealized_pnl numeric not null default 0,
  realized_pnl numeric not null default 0,
  watch_rules jsonb not null default '{}',
  sim_flag boolean not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  unique (user_phone, instrument_symbol, side, sim_flag)
);

create table if not exists audit (
  id bigserial primary key,
  actor text not null,
  action text not null,
  ref_id text,
  payload jsonb,
  payload_hash text,
  bsc_tx_hash text,
  ts timestamptz not null default now()
);
