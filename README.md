# my-dashboard-next

A personal dashboard for planning the day around school, training and everything else. Built with Next.js (App Router, plain JavaScript) and Supabase, deployed on Render.

## What's in it

The sidebar is grouped into sections:

| Section | Pages | What they do |
|---|---|---|
| **Today** | Home, Weather | Home opens with a "today" card (next class, today's run and the best time to run, pinned notes, likely and best-possible grade per class), then a timeline of the day: classes, Google Calendar events, runs and activities. Below that: the week strip, streak, to-dos, add/manage activities, recurring schedules, the phone calendar feed and year in review. Weather shows the forecast and the best hours to run or be outside. |
| **Training** | Running | Your training plan, run log, training load (ACWR), and mileage/pace/heart-rate charts. Log runs by hand, from a GPX/TCX file, or by importing Strava's `activities.csv` export (re-importing is safe: runs already in your log are skipped). |
| **School** | Grades | Weighted grade calculator per class: the score you need on what's left for each letter, the best grade still possible, and the likely final grade (remaining exams predicted from your midterm scores). Each class also holds its meeting times, which Home's timeline uses. **New term** backs up and clears all classes. |
| **Notes** | Brain Dump, Books, Lyric Lab | Brain Dump is a card wall of notes with colored tags, pins, search, checklists and export; to-dos are notes tagged **To Do**. Books is a reading log. Lyric Lab is a rhyme finder and lyric notebook. |
| **Life** | Wardrobe | Clothes, outfit building and color matching. |
| **Games** | Madden Franchise, CFB Dynasty, Minecraft | Franchise and dynasty records, and Minecraft coordinates with overworld/nether conversion. |

### How the pieces connect

- **One planner:** everything you plan is a row in `activities`. Planned runs are activities of type `running` (imported plans are tagged `run_plan`), and repeating schedules are activities sharing a `recur_…` group id, so they show on every device.
- **One class list:** classes, grade categories and meeting times all live in `grade_classes`; edit them on Grades.
- **Phone calendar:** every change to an activity or run re-uploads `training_plan.ics` to Supabase Storage automatically (`lib/feed.js`; "Publish now" on Home forces it). Subscribe once with the `webcal://` link shown there and your phone keeps it updated.
- **Google Calendar:** paste your calendar's secret iCal address under "Connect Google Calendar" on Home. Repeating events (daily and weekly) are expanded; only `https://calendar.google.com` links are accepted.
- **Loading and errors:** every Supabase request goes through `lib/supabase.js`, which drives an app-wide loading bar and an error banner (`components/DbStatus.js`). Pages don't need their own.
- **Fewest clicks:** non-destructive actions skip extra steps: add a to-do from Home's "+ to-do" box, tick off To Do notes with ✓, "Log it" on Running opens the log form already set to today's workout, notes and pages save on Enter or when you click away, and Home's Add Activity remembers your last type, time and length.
- **Deletes ask first** everywhere it would lose data you can't get back, in the app's own dialog.
- **Settings follow you:** your weather location and Google Calendar link are saved in a Supabase `settings` table (and cached in the browser), so a new device picks them up.
- **Install on your phone:** open the site, then Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android). It opens full screen with its own icon.

## Setup

1. `npm install`
2. Create `.env.local` with your Supabase project:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_KEY=<anon key>
   ```
3. In the Supabase SQL editor, run the files in `supabase/` in this order (each is safe to re-run unless noted):
   1. `grade_classes.sql`
   2. `class_schedule.sql`
   3. `notes.sql`
   4. `migrate_todos.sql`: one time; copies the old `todos` table into Brain Dump. Running it twice duplicates to-dos.
   5. `migrate_runs.sql`: one time; copies the old `running_schedule` into `activities` (it skips itself if already done).
   6. `settings.sql`
   7. `cleanup_old_tables.sql`: optional, once you're happy with the migrated data. Drops `todos` and `running_schedule`.
4. `npm run dev` and open http://localhost:3000

## Tests

`npm test` runs the checks in `tests/` (plain Node, no extra packages): grade math and predictions, calendar parsing and repeat expansion, the phone calendar feed, date helpers, run-plan conversion, the TCX/Strava readers (including duplicate skipping), and the confirm dialog.

## Code map

- `app/<page>/page.js`: one folder per page; `app/api/*/route.js` for the weather, geocode, iCal and CMU dictionary proxies.
- `lib/`: shared logic: `dates.js` (local-date helpers and day names; never use `toISOString()` for a date), `grades.js`, `runs.js`, `runFiles.js`, `ical.js` (reading Google Calendar), `ics.js` (writing the phone feed), `settings.js`, `confirm.js`, `weather.js`, `constants.js` (including the one color `PALETTE`).
- `components/`: `Sidebar.js` (add new pages here), `DbStatus.js` and `ConfirmDialog.js`.
- `app/manifest.js`, `app/icon.js`, `app/apple-icon.js`: home-screen install and icons (drawn in code).
- `supabase/`: table setup and migrations.

## Security note

The app talks to Supabase from the browser with the public (anon) key, and the tables allow that key to read and write. Anyone who has the site's key can read and edit the data, including the Google Calendar secret link in `settings`. Adding a login is the fix if that ever matters.
