@AGENTS.md

# CLAUDE.md — my-dashboard-next

Context for Claude Code sessions in this repo. Rebuilt in Nov 2026 from the long local Claude Code session that started in the old `MyDashboard` (Streamlit) repo. **This repo is public — keep personal details (health, schedule specifics) out of this file.**

## What it is

Ayden's personal dashboard, rewritten from the Streamlit app in `MyDashboard` to **Next.js** because Streamlit reran the whole page on every interaction. Deployed on **Render**. Same **Supabase** backend as the old app.

## Stack and conventions

- Next.js **App Router, JavaScript (not TypeScript)**; interactive pages are client components (`"use client"`).
- `@supabase/supabase-js` for client-side database access; server-side proxies in `app/api/*/route.js` (weather/geocode, eBay OAuth, iCal fetching, CMU dictionary).
- `localStorage` for light per-device settings (e.g. location, iCal URL).
- When porting or fixing anything, the old Streamlit code in `MyDashboard` is the reference for behavior and **exact Supabase column names**.
- Coding style used so far: shortest working diff, standard library first, no abstractions nobody asked for.

## Pages

Home (day planner, week view, streaks, activities, running schedule, to-dos, currently reading, Add/Manage Activities, Plan the Week, Sync to phone, Year in Review), Weather (Open-Meteo, best run/outdoor times), To Do, Books, Minecraft (coordinate tracker, overworld/nether conversion), CFB Dynasty, Madden Franchise (awards, division wins, All-Pro formation view, insights), Lyric Lab (rhyme finder + CMU phonemes, verse analyzer — the full version became the separate Cadence desktop app), Running (schedule, ACWR, pace trends, manual/GPX/Strava logging, weekly mileage), Wardrobe (outfit builder, color compatibility, color extraction from photos), eBay (OAuth + orders).

## Supabase gotchas (verified Sept–Oct 2026)

- `game_registry` uses `display_name` and `table_prefix` (CFB + Madden pages).
- `franchise_config` is keyed by `game` (`.eq("game", prefix)`); old app-wide settings live under `game="__settings__"`.
- `run_logs`: strip `splits` and `moving_time_seconds` before insert (GPX and Strava).
- `running_schedule` uses the `workout` column.
- `activities` uses `title`, `time_slot`, `duration_min`, `notes`.
- Madden All-Pro players are stored in a **legacy single string** like `"Josh Allen BUF (97 OVR)"` in `player` (team/ovr columns empty) — always parse with `resolvePlayer()`. Formation cards use NFL team colors (primary background, secondary border) from the colors map in constants.
- The training plan / schedule is published as an **iCal feed uploaded to Supabase Storage** (public URL, subscribed via `webcal://`), refreshed by the Publish/Sync button.

## Working with Ayden

- Don't browser-test the old Streamlit app yourself; for this Next.js app, check with Ayden before spending time on browser testing.
- He approves plans before big changes and prefers fast iteration with short explanations.
