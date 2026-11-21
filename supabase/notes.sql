-- Brain Dump storage. Run once in the Supabase SQL editor.
create table if not exists note_tags (
  name text primary key,
  color text not null default 'slate'
);

create table if not exists notes (
  id bigint generated always as identity primary key,
  content text not null default '',
  tag text references note_tags(name) on update cascade on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same access model as grade_classes: the browser uses the public (anon) key.
grant select, insert, update, delete on note_tags, notes to anon;
alter table note_tags enable row level security;
alter table notes enable row level security;
create policy "anon full access" on note_tags for all to anon using (true) with check (true);
create policy "anon full access" on notes for all to anon using (true) with check (true);
