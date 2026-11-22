-- Optional, once you're happy that To Do (Brain Dump) and the run plan (Running) look right.
-- These tables were copied by migrate_todos.sql and migrate_runs.sql and nothing in the app reads them now.
-- Dropping can't be undone, so export them first if you want a copy (Table Editor -> Export to CSV).
drop table if exists todos;
drop table if exists running_schedule;
