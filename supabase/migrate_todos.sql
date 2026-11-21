-- One-time: move open to-dos into Brain Dump as notes tagged "To Do".
-- High-priority to-dos become pinned. Run once in the Supabase SQL editor (after notes.sql).
-- The old todos table is left untouched as a backup; drop it later with: drop table todos;
begin;
insert into note_tags (name, color) values ('To Do', 'rose') on conflict (name) do nothing;
insert into notes (content, tag, pinned, created_at, updated_at)
select task, 'To Do', priority = 'high', coalesce(created_at, now()), now()
from todos
where not coalesce(completed, false) and coalesce(trim(task), '') <> '';
commit;
