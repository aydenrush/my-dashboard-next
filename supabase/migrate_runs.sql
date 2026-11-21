-- One-time: move the training plan from running_schedule into activities (activity_type = 'running').
-- Run once in the Supabase SQL editor. It skips itself if plan runs were already copied.
-- running_schedule is left untouched as a backup; drop it later with: drop table running_schedule;
--
-- Mapping: first line of `workout` -> title, the rest -> notes (plus distance/notes if those columns exist),
-- runs get 9:00 PM / 60 min (what the phone calendar feed used), rest days get no time.
-- gcal_event_id = 'run_plan' marks plan rows so "Replace existing schedule" only replaces those.
insert into activities (date, activity_type, title, notes, time_slot, duration_min, completed, gcal_event_id)
select
  s.date,
  'running',
  split_part(coalesce(nullif(s.workout, ''), 'Rest Day'), E'\n', 1),
  nullif(concat_ws(E'\n',
    nullif(substring(s.workout from position(E'\n' in s.workout) + 1), s.workout),
    case when to_jsonb(s)->>'distance' is not null then (to_jsonb(s)->>'distance') || ' mi' end,
    nullif(to_jsonb(s)->>'notes', '')
  ), ''),
  case when split_part(coalesce(s.workout, ''), E'\n', 1) ~* '(rest|cross)' or coalesce(s.workout, '') = '' then null else '9:00 PM' end,
  case when split_part(coalesce(s.workout, ''), E'\n', 1) ~* '(rest|cross)' or coalesce(s.workout, '') = '' then null else 60 end,
  coalesce(s.completed, false),
  'run_plan'
from running_schedule s
where not exists (select 1 from activities where gcal_event_id = 'run_plan');
