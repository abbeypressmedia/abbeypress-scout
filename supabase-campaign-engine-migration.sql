-- MailFlow campaign engine migration. Safe to run on the existing Supabase project.
-- This does NOT recreate or delete any existing table.

alter table public.sender_accounts
  alter column refresh_token drop not null,
  add column if not exists sent_today_date date not null default current_date,
  add column if not exists lease_until timestamptz;

alter table public.prospects
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

alter table public.campaigns
  add column if not exists shuffle_messages boolean not null default true,
  add column if not exists next_send_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_error text,
  add column if not exists sent_count integer not null default 0,
  add column if not exists failed_count integer not null default 0,
  add column if not exists prospect_count integer not null default 0;

alter table public.send_events
  add column if not exists claim_token uuid;

-- A prospect can intentionally appear on different uploaded lists.
alter table public.prospects drop constraint if exists prospects_user_id_email_key;
drop index if exists public.prospects_user_id_email_key;
create unique index if not exists prospects_user_list_email_uidx on public.prospects(user_id,list_id,email);

create unique index if not exists send_events_claim_token_uidx
  on public.send_events(claim_token)
  where claim_token is not null;

create index if not exists prospects_campaign_claim_idx
  on public.prospects(list_id, status, claimed_at, id);

create index if not exists sender_lease_idx
  on public.sender_accounts(status, lease_until, sent_today_date, sent_today);

update public.campaigns c
set sent_count = coalesce((select count(*) from public.send_events e where e.campaign_id = c.id and e.status = 'sent'), 0),
    failed_count = coalesce((select count(*) from public.send_events e where e.campaign_id = c.id and e.status = 'failed'), 0)
where c.sent_count = 0 and c.failed_count = 0;

update public.campaigns c
set prospect_count = coalesce((select count(*) from public.prospects p where p.list_id = c.list_id and p.status in ('ready','queued','sent','failed')), 0)
where c.prospect_count = 0;

create or replace function public.claim_campaign_job(p_campaign_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.campaigns%rowtype;
  s public.sender_accounts%rowtype;
  p public.prospects%rowtype;
  m public.campaign_messages%rowtype;
  token uuid;
  sender_count integer;
  message_count integer;
  pending_count integer;
begin
  select * into c from public.campaigns
  where id = p_campaign_id and user_id = p_user_id for update;

  if not found or c.status <> 'running' then return null; end if;
  if c.next_send_at is not null and c.next_send_at > now() then return null; end if;

  update public.sender_accounts sa
  set sent_today = 0, sent_today_date = current_date, lease_until = null, updated_at = now()
  where sa.id in (select cs.sender_id from public.campaign_senders cs where cs.campaign_id = c.id)
    and sa.sent_today_date < current_date;

  select count(*) into sender_count from public.campaign_senders cs where cs.campaign_id = c.id;

  if sender_count = 0 then
    update public.campaigns set status='paused', last_error='No senders are selected for this campaign', updated_at=now() where id=c.id;
    return null;
  end if;

  update public.prospects
  set status='ready', claim_token=null, claimed_at=null
  where user_id=p_user_id and list_id=c.list_id and status='queued'
    and last_campaign_id=c.id and claimed_at < now()-interval '10 minutes';

  select count(*) into pending_count from public.prospects
  where user_id=p_user_id and list_id=c.list_id
    and (status='ready' or (status='queued' and last_campaign_id=c.id));

  if pending_count=0 then
    update public.campaigns set status='completed', next_send_at=null, last_error=null, updated_at=now() where id=c.id;
    return null;
  end if;

  select sa.* into s
  from public.campaign_senders cs
  join public.sender_accounts sa on sa.id=cs.sender_id
  where cs.campaign_id=c.id
    and sa.user_id=p_user_id
    and sa.status='connected'
    and (sa.lease_until is null or sa.lease_until < now())
    and sa.sent_today < least(sa.daily_limit,c.sender_limit)
  order by case when cs.sender_order >= c.next_sender_index then 0 else 1 end, cs.sender_order
  limit 1
  for update of sa skip locked;

  if not found then
    if not exists (
      select 1
      from public.campaign_senders cs
      join public.sender_accounts sa on sa.id=cs.sender_id
      where cs.campaign_id=c.id
        and sa.user_id=p_user_id
        and sa.status='connected'
        and sa.sent_today < least(sa.daily_limit,c.sender_limit)
    ) then
      update public.campaigns
      set status='paused',
          next_send_at=null,
          last_error='All selected senders have reached their configured daily/campaign limits',
          updated_at=now()
      where id=c.id;
      return null;
    end if;

    update public.campaigns
    set next_send_at=now()+interval '10 seconds',
        last_error='Selected sender is temporarily busy; retrying',
        updated_at=now()
    where id=c.id;
    return null;
  end if;

  select * into p from public.prospects
  where user_id=p_user_id and list_id=c.list_id
    and (status='ready' or (status='queued' and last_campaign_id=c.id and claimed_at < now()-interval '10 minutes'))
  order by case when status='ready' then 0 else 1 end, id
  limit 1
  for update skip locked;

  if not found then
    update public.campaigns set next_send_at=now()+interval '30 seconds', updated_at=now() where id=c.id;
    update public.sender_accounts set lease_until=null, updated_at=now() where id=s.id;
    return null;
  end if;

  select count(*) into message_count from public.campaign_messages where campaign_id=c.id and active=true;

  if message_count=0 then
    update public.campaigns set status='paused', last_error='Campaign has no active message variations', updated_at=now() where id=c.id;
    update public.sender_accounts set lease_until=null, updated_at=now() where id=s.id;
    return null;
  end if;

  if c.shuffle_messages then
    select * into m from public.campaign_messages where campaign_id=c.id and active=true order by random() limit 1;
  else
    select * into m from public.campaign_messages where campaign_id=c.id and active=true
    order by variant_order offset (c.next_message_index % message_count) limit 1;
  end if;

  token:=gen_random_uuid();

  update public.prospects set status='queued', claim_token=token, claimed_at=now(), last_campaign_id=c.id where id=p.id;
  update public.sender_accounts set lease_until=now()+interval '5 minutes', updated_at=now() where id=s.id;

  update public.campaigns
  set next_sender_index=coalesce((select (cs.sender_order+1)%sender_count from public.campaign_senders cs where cs.campaign_id=c.id and cs.sender_id=s.id limit 1),0),
      next_message_index=case when c.shuffle_messages then c.next_message_index else (c.next_message_index+1)%message_count end,
      next_prospect_offset=c.next_prospect_offset+1,
      next_send_at=now()+greatest(c.min_delay_seconds,0)*interval '1 second',
      last_error=null, updated_at=now()
  where id=c.id;

  return jsonb_build_object(
    'campaign_id',c.id,'prospect_id',p.id,'sender_id',s.id,'sender_email',s.email,
    'refresh_token',s.refresh_token,'message_id',m.id,'subject',m.subject,'body',m.body,
    'claim_token',token,'prospect_email',p.email,'first_name',coalesce(p.first_name,''),
    'last_name',coalesce(p.last_name,''),'company',coalesce(p.company,''),'website',coalesce(p.website,'')
  );
end;
$$;



revoke execute on function public.claim_campaign_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_campaign_job(uuid, uuid) to service_role;

create or replace function public.finalize_campaign_job(
  p_claim_token uuid, p_user_id uuid, p_sender_id uuid, p_message_id uuid, p_status text,
  p_provider_message_id text default null, p_error text default null,
  p_next_send_at timestamptz default null, p_permanent boolean default false, p_auth_failure boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.prospects%rowtype;
  c public.campaigns%rowtype;
  existing public.send_events%rowtype;
  final_status text := case when p_status='sent' then 'sent' else 'failed' end;
begin
  select * into existing from public.send_events where claim_token=p_claim_token limit 1;
  if found then return jsonb_build_object('status',existing.status,'already_finalized',true,'event_id',existing.id); end if;

  select * into p from public.prospects where claim_token=p_claim_token and user_id=p_user_id for update;
  if not found then return jsonb_build_object('status','missing_claim'); end if;

  select * into c from public.campaigns where id=p.last_campaign_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('status','missing_campaign'); end if;

  insert into public.send_events(user_id,campaign_id,prospect_id,sender_id,message_id,claim_token,status,provider_message_id,error)
  values(p_user_id,c.id,p.id,p_sender_id,p_message_id,p_claim_token,final_status,p_provider_message_id,p_error);

  if final_status='sent' then
    update public.prospects set status='sent', contacted_at=now(), claim_token=null, claimed_at=null
    where id=p.id and claim_token=p_claim_token;

    update public.sender_accounts
    set sent_today=sent_today+1, sent_today_date=current_date, lease_until=null, last_sent_at=now(), updated_at=now()
    where id=p_sender_id and user_id=p_user_id;

    update public.campaigns
    set sent_count=sent_count+1, last_sent_at=now(), last_error=null, next_send_at=p_next_send_at, updated_at=now()
    where id=c.id and user_id=p_user_id;
  else
    update public.prospects
    set status=case when p_permanent then 'failed' else 'ready' end, claim_token=null, claimed_at=null
    where id=p.id and claim_token=p_claim_token;

    update public.sender_accounts
    set status=case when p_auth_failure then 'reauthorization_required' else status end,
        lease_until=null, updated_at=now()
    where id=p_sender_id and user_id=p_user_id;

    update public.campaigns
    set failed_count=failed_count+1, last_error=p_error, next_send_at=p_next_send_at, updated_at=now()
    where id=c.id and user_id=p_user_id;
  end if;

  return jsonb_build_object('status',final_status,'already_finalized',false);
end;
$$;

revoke execute on function public.finalize_campaign_job(uuid, uuid, uuid, uuid, text, text, text, timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.finalize_campaign_job(uuid, uuid, uuid, uuid, text, text, text, timestamptz, boolean, boolean) to service_role;
