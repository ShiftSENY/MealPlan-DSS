-- ==========================================================================
-- Migration 001 — date-based meal plans + dated shopping history
-- --------------------------------------------------------------------------
-- Run this ONCE in the Neon SQL Editor if you already created the tables with
-- the original schema (weekday-based weekly_plan + undated shopping_list).
-- Fresh installs should just run schema.sql instead.
-- Safe to run more than once.
-- ==========================================================================

begin;

-- ---------- weekly_plan: weekday -> calendar date ----------
alter table weekly_plan add column if not exists meal_date date;

-- Backfill any existing rows onto the current week (Monday-based).
update weekly_plan
   set meal_date = date_trunc('week', current_date)::date + (day - 1)
 where meal_date is null;

alter table weekly_plan alter column meal_date set not null;

-- Replace the weekday uniqueness with date-based uniqueness.
alter table weekly_plan drop constraint if exists weekly_plan_user_id_day_meal_period_key;
alter table weekly_plan drop constraint if exists weekly_plan_user_date_period_key;
alter table weekly_plan add constraint weekly_plan_user_date_period_key
  unique (user_id, meal_date, meal_period);

-- The weekday column is no longer needed.
alter table weekly_plan drop column if exists day;

create index if not exists weekly_plan_date_idx on weekly_plan (user_id, meal_date);

-- ---------- shopping_list: add date + category ----------
alter table shopping_list add column if not exists list_date date;
alter table shopping_list add column if not exists category text;

-- Put existing rows on the current week's Monday so they show up in history.
update shopping_list
   set list_date = date_trunc('week', current_date)::date
 where list_date is null;
alter table shopping_list alter column list_date set not null;

create index if not exists shopping_date_idx on shopping_list (user_id, list_date);

commit;
