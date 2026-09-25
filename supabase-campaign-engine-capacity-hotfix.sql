-- Incremental capacity/completion fix. Safe to run on the existing Supabase project.
-- Does not recreate or delete tables.

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
