-- Small key/value store so device settings (weather location, Google Calendar link) follow you to every device.
-- Run once in the Supabase SQL editor. Note: like every table here, anyone with the site's public key can read it,
-- and that includes your Google Calendar secret link.
create table if not exists settings (
  key text primary key,
  value jsonb not null
);

grant select, insert, update, delete on settings to anon;
alter table settings enable row level security;
create policy "anon full access" on settings for all to anon using (true) with check (true);
