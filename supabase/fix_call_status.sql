-- Run this in Supabase SQL Editor if you see:
-- "Could not find the table 'public.call_status' in the schema cache"

create table if not exists public.call_status (
  id bigint primary key,
  status text not null check (status in ('idle', 'ringing', 'accepted', 'declined', 'ended')),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

insert into public.call_status (id, status)
values (1, 'idle')
on conflict (id) do nothing;

-- Normalize status at fix time in case previous sessions were stuck.
update public.call_status
set status = 'idle',
    updated_at = timezone('utc'::text, now())
where id = 1;

alter table public.call_status enable row level security;

drop policy if exists "call_status_rw" on public.call_status;
create policy "call_status_rw" on public.call_status
for all
to anon, authenticated
using (true)
with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.call_status;
  exception
    when duplicate_object then null;
  end;
end $$;
