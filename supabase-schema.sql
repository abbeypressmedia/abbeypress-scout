create extension if not exists pgcrypto;

create table if not exists public.sender_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  google_subject text not null,
  refresh_token text,
  status text not null default 'connected' check (status in ('connected','reauthorization_required','disconnected')),
  daily_limit integer not null default 200 check (daily_limit > 0),
  sent_today integer not null default 0 check (sent_today >= 0),
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_today_date date not null default current_date,
  lease_until timestamptz,
  unique(user_id, google_subject)
);

create table if not exists public.prospect_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  total_count integer not null default 0,
  active_count integer not null default 0,
  archived_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null references public.prospect_lists(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  company text,
  website text,
  status text not null default 'ready' check (status in ('ready','queued','sent','failed','skipped','archived')),
  contacted_at timestamptz,
  last_campaign_id uuid,
  claim_token uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, list_id, email)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','completed','stopped')),
  list_id uuid references public.prospect_lists(id) on delete set null,
  sender_limit integer not null default 200 check (sender_limit > 0),
  min_delay_seconds integer not null default 10 check (min_delay_seconds >= 0),
  max_delay_seconds integer not null default 30 check (max_delay_seconds >= min_delay_seconds),
  next_sender_index integer not null default 0,
  next_message_index integer not null default 0,
  next_prospect_offset bigint not null default 0,
  shuffle_messages boolean not null default true,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  last_error text,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  prospect_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  body text not null,
  subject text not null,
  variant_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.campaign_senders (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sender_id uuid not null references public.sender_accounts(id) on delete cascade,
  sender_order integer not null default 0,
  primary key(campaign_id, sender_id)
);

create table if not exists public.send_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  sender_id uuid not null references public.sender_accounts(id) on delete cascade,
  message_id uuid references public.campaign_messages(id) on delete set null,
  status text not null check (status in ('sent','failed','skipped')),
  provider_message_id text,
  error text,
  claim_token uuid,
  created_at timestamptz not null default now()
);

alter table public.sender_accounts enable row level security;
alter table public.prospect_lists enable row level security;
alter table public.prospects enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_messages enable row level security;
alter table public.campaign_senders enable row level security;
alter table public.send_events enable row level security;

create policy "own senders" on public.sender_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lists" on public.prospect_lists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own prospects" on public.prospects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own campaigns" on public.campaigns for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "campaign messages" on public.campaign_messages for all
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "campaign senders" on public.campaign_senders for all
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "own events" on public.send_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists prospects_ready_idx on public.prospects(user_id, status, id);
create index if not exists events_campaign_idx on public.send_events(campaign_id, created_at desc);

create unique index if not exists send_events_claim_token_uidx on public.send_events(claim_token) where claim_token is not null;
create index if not exists prospects_campaign_claim_idx on public.prospects(list_id,status,claimed_at,id);
create index if not exists sender_lease_idx on public.sender_accounts(status,lease_until,sent_today_date,sent_today);

-- The campaign engine functions are installed by supabase-campaign-engine-migration.sql.
