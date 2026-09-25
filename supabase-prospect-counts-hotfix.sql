-- Safe incremental hotfix for existing MailFlow/Supabase data.
-- Does not recreate or delete any tables.

create or replace function public.sync_prospect_list_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_delta integer := 0;
  archived_delta integer := 0;
begin
  if TG_OP='INSERT' then
    if NEW.status in ('ready','queued') then active_delta:=1; end if;
    if NEW.status='archived' then archived_delta:=1; end if;
  elsif TG_OP='UPDATE' then
    if OLD.status in ('ready','queued') then active_delta:=active_delta-1; end if;
    if NEW.status in ('ready','queued') then active_delta:=active_delta+1; end if;
    if OLD.status='archived' then archived_delta:=archived_delta-1; end if;
    if NEW.status='archived' then archived_delta:=archived_delta+1; end if;
  end if;

  if active_delta<>0 or archived_delta<>0 then
    update public.prospect_lists
    set active_count=greatest(0,active_count+active_delta),
        archived_count=greatest(0,archived_count+archived_delta)
    where id=coalesce(NEW.list_id,OLD.list_id);
  end if;

  return coalesce(NEW,OLD);
end;
$$;

drop trigger if exists prospects_sync_list_counts on public.prospects;
create trigger prospects_sync_list_counts
after insert or update of status on public.prospects
for each row execute function public.sync_prospect_list_counts();

-- Reconcile existing counters with actual prospect rows.
update public.prospect_lists l
set total_count=coalesce((select count(*) from public.prospects p where p.list_id=l.id),0),
    active_count=coalesce((select count(*) from public.prospects p where p.list_id=l.id and p.status in ('ready','queued')),0),
    archived_count=coalesce((select count(*) from public.prospects p where p.list_id=l.id and p.status='archived'),0);
