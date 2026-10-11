-- Mayflower's server talks to Postgres directly with a privileged role; nothing is
-- exposed through Supabase's public (anon/authenticated) REST API. Enabling RLS
-- with no policies denies all access through PostgREST, so exchange tokens,
-- messages and positions can never be read with a leaked anon key.
alter table users enable row level security;
alter table user_theses enable row level security;
alter table connected_sources enable row level security;
alter table auth_codes enable row level security;
alter table one_time_tokens enable row level security;
alter table gemini_connections enable row level security;
alter table oauth_transactions enable row level security;
alter table markets enable row level security;
alter table market_quotes enable row level security;
alter table research_reports enable row level security;
alter table trade_proposals enable row level security;
alter table approvals enable row level security;
alter table orders enable row level security;
alter table fills enable row level security;
alter table positions enable row level security;
alter table ledger_entries enable row level security;
alter table monitor_events enable row level security;
alter table messages enable row level security;
alter table audit_events enable row level security;
alter table portfolio_snapshots enable row level security;
alter table app_settings enable row level security;
