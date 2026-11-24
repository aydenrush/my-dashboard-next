-- Pokémon GO "box": the keepers you saved from the checker, so later batches are compared against them.
-- Run once in the Supabase SQL editor.
create table if not exists pogo_box (
  id bigint generated always as identity primary key,
  species_id text not null,           -- PvPoke species id, e.g. "machamp", "ninetales_alolan"
  atk smallint not null check (atk between 0 and 15),
  def smallint not null check (def between 0 and 15),
  hp smallint not null check (hp between 0 and 15),
  flags text[] not null default '{}', -- shadow, purified, lucky, shiny, costume, background, dynamax, gigantamax
  roles text[] not null default '{}', -- raid, max, gl, ul, ml, trophy (what it won when saved)
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on pogo_box to anon;
alter table pogo_box enable row level security;
create policy "anon full access" on pogo_box for all to anon using (true) with check (true);
