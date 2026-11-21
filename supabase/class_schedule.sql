-- Class meeting times live on grade_classes (Grades page edits them, Home's timeline reads them).
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table grade_classes add column if not exists meetings jsonb not null default '[]'::jsonb;
alter table grade_classes add column if not exists term_start date;
alter table grade_classes add column if not exists term_end date;

-- Fall 2026, copied from the schedule that used to be hardcoded on Home. days: 0 = Mon ... 6 = Sun
update grade_classes set term_start = '2026-08-25', term_end = '2026-12-10', meetings = '[
  {"label": "Lab", "days": [3], "start": "09:30", "end": "11:20", "room": "SL 251"},
  {"label": "", "days": [1, 3], "start": "13:30", "end": "14:45", "room": "ES 2107"}
]' where name = 'CS 25000' and meetings = '[]'::jsonb;

update grade_classes set term_start = '2026-08-24', term_end = '2026-12-11', meetings = '[
  {"label": "Pso", "days": [2], "start": "12:30", "end": "13:20", "room": "SL 247"},
  {"label": "", "days": [0, 2, 4], "start": "14:30", "end": "15:20", "room": "ES 2107"}
]' where name = 'CS 25100' and meetings = '[]'::jsonb;

update grade_classes set term_start = '2026-08-24', term_end = '2026-12-11', meetings = '[
  {"label": "", "days": [0, 2, 4], "start": "16:30", "end": "17:20", "room": "SL 011"}
]' where name = 'MA 26500' and meetings = '[]'::jsonb;

update grade_classes set term_start = '2026-08-24', term_end = '2026-12-11'
where name in ('POL 23500', 'POL 32700') and term_start is null;
