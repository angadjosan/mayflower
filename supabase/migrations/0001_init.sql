-- Mayflower core schema. Works on Supabase Postgres and on embedded PGlite for local development.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  imessage_handle text unique,
  email text unique,
  onboarding_state text not null default 'new',
  risk_budget double precision,
  max_per_position double precision,
  max_total_exposure double precision,
  risk_style text not null default 'conservative',
  interests text[] not null default '{}',
  excluded_topics text[] not null default '{}',
  trading_paused boolean not null default false,
  notify_level text not null default 'important',
  last_discovery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_theses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  topic text not null,
  belief text not null,
  stance text not null default 'neutral',
  confidence double precision not null default 0.6,
  source text not null default 'chat',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_theses_user on user_theses(user_id, active);

create table if not exists connected_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  scopes text[] not null default '{}',
  status text not null default 'not_connected',
  created_at timestamptz not null default now()
);

create table if not exists auth_codes (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists auth_codes_handle on auth_codes(handle, created_at desc);

create table if not exists one_time_tokens (
  jti text primary key,
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists gemini_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mode text not null,
  env text not null,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'active',
  terms_accepted_at timestamptz,
  last_error text,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists gemini_connections_one_active on gemini_connections(user_id) where status = 'active';

create table if not exists oauth_transactions (
  state text primary key,
  user_id uuid not null references users(id) on delete cascade,
  verifier_enc text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists markets (
  symbol text primary key,
  event_ticker text not null,
  event_title text not null,
  label text not null,
  category text not null default 'other',
  correlation_group text,
  description text,
  rules_url text,
  event_type text not null default 'binary',
  status text not null,
  market_state text,
  expiry timestamptz,
  increments jsonb not null,
  resolution_side text,
  source text not null,
  env text not null,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists market_quotes (
  id bigserial primary key,
  symbol text not null references markets(symbol) on delete cascade,
  ts timestamptz not null default now(),
  buy_yes double precision,
  buy_no double precision,
  sell_yes double precision,
  sell_no double precision,
  best_bid double precision,
  best_ask double precision,
  last_trade double precision,
  liquidity_usd double precision,
  volume_usd double precision
);
create index if not exists market_quotes_symbol_ts on market_quotes(symbol, ts desc);

create table if not exists research_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  symbol text not null references markets(symbol),
  provider text not null,
  queries jsonb not null,
  citations jsonb not null,
  forecast jsonb not null,
  critic jsonb not null,
  market_probability double precision,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists research_reports_symbol on research_reports(symbol, created_at desc);

create table if not exists trade_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null references markets(symbol),
  kind text not null default 'open',
  discovery text not null,
  decision text not null,
  side text,
  outcome text,
  quantity double precision not null default 0,
  limit_price double precision,
  max_cost double precision not null default 0,
  est_probability double precision,
  market_probability double precision,
  edge double precision,
  expected_value double precision,
  sizing jsonb not null,
  rationale jsonb not null,
  research_report_id uuid references research_reports(id),
  related_position_id uuid,
  version integer not null default 1,
  terms_hash text,
  approval_code_hash text,
  approval_code_expires_at timestamptz,
  execution_mode text,
  status text not null,
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trade_proposals_user_status on trade_proposals(user_id, status, created_at desc);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references trade_proposals(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  proposal_version integer not null,
  terms_hash text not null,
  decision text not null,
  channel text not null,
  created_at timestamptz not null default now()
);
-- At most one approval per proposal: an approved proposal can never be approved (and executed) twice.
create unique index if not exists approvals_one_approved on approvals(proposal_id) where decision = 'approved';

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  proposal_id uuid not null unique references trade_proposals(id),
  approval_id uuid not null unique references approvals(id),
  mode text not null,
  env text not null,
  simulated boolean not null,
  exchange_order_id text,
  symbol text not null,
  event_ticker text not null,
  side text not null,
  outcome text not null,
  quantity double precision not null,
  limit_price double precision not null,
  status text not null,
  filled_quantity double precision not null default 0,
  avg_fill_price double precision,
  error text,
  raw jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_status on orders(user_id, status);

create table if not exists fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  quantity double precision not null,
  price double precision not null,
  fee double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null references markets(symbol),
  event_ticker text not null,
  outcome text not null,
  mode text not null,
  quantity double precision not null default 0,
  avg_price double precision not null default 0,
  cost_basis double precision not null default 0,
  realized_pnl double precision not null default 0,
  status text not null default 'open',
  correlation_group text,
  origin_proposal_id uuid references trade_proposals(id),
  thesis jsonb,
  latest_assessment jsonb,
  watch_conditions jsonb not null default '[]',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  last_monitored_at timestamptz,
  last_notified_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists positions_one_open on positions(user_id, symbol, outcome, mode) where status = 'open';

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mode text not null,
  kind text not null,
  amount double precision not null,
  ref_type text,
  ref_id text,
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_user_mode on ledger_entries(user_id, mode);

create table if not exists monitor_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  position_id uuid references positions(id) on delete cascade,
  trigger text not null,
  severity text not null,
  summary text not null,
  recommendation text not null,
  evidence jsonb not null default '[]',
  details jsonb,
  proposal_id uuid references trade_proposals(id),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists monitor_events_user on monitor_events(user_id, created_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  channel text not null,
  text text not null,
  external_guid text unique,
  delivery text not null default 'n/a',
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_user_time on messages(user_id, created_at);

create table if not exists audit_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  actor text not null,
  action text not null,
  ref_type text,
  ref_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user on audit_events(user_id, created_at desc);

create table if not exists portfolio_snapshots (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  ts timestamptz not null default now(),
  total_value double precision not null,
  cash double precision not null,
  at_risk double precision not null,
  unrealized_pnl double precision not null,
  realized_pnl double precision not null
);
create index if not exists portfolio_snapshots_user on portfolio_snapshots(user_id, ts);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
