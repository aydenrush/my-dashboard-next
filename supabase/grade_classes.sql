-- Grades page storage. Run once in the Supabase SQL editor.
create table if not exists grade_classes (
  id bigint generated always as identity primary key,
  name text not null,
  categories jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- The app talks to Supabase with the public (anon) key from the browser, like every other page.
-- This keeps RLS on but lets the anon key read and write, which matches how the other tables
-- must be set up for the app to work. Tighten it if you add auth later.
alter table grade_classes enable row level security;
create policy "anon full access" on grade_classes for all to anon using (true) with check (true);
