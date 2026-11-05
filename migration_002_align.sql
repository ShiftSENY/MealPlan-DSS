-- ==========================================================================
-- Migration 002 — align an existing database with the app's expected types
-- --------------------------------------------------------------------------
-- Some early databases were created with text[] list columns and without the
-- updated_at timestamps. The app writes JSONB lists and touches updated_at,
-- so run this once if preferences/meal edits error out.
-- Safe to run more than once.
-- ==========================================================================

begin;

-- ---------- missing timestamp columns ----------
alter table profiles      add column if not exists updated_at timestamptz default now();
alter table inventory     add column if not exists updated_at timestamptz default now();
alter table meal_catalog  add column if not exists updated_at timestamptz default now();

-- ---------- profiles: text[] -> jsonb ----------

alter table profiles alter column dietary_preferences drop default;
alter table profiles alter column dietary_preferences type jsonb using to_jsonb(dietary_preferences);
alter table profiles alter column dietary_preferences set default '[]'::jsonb;

alter table profiles alter column disliked_ingredients drop default;
alter table profiles alter column disliked_ingredients type jsonb using to_jsonb(disliked_ingredients);
alter table profiles alter column disliked_ingredients set default '[]'::jsonb;

alter table profiles alter column nutrition_goals drop default;
alter table profiles alter column nutrition_goals type jsonb using to_jsonb(nutrition_goals);
alter table profiles alter column nutrition_goals set default '[]'::jsonb;

-- ---------- meal_catalog: text[] -> jsonb ----------

alter table meal_catalog alter column dietary_tags drop default;
alter table meal_catalog alter column dietary_tags type jsonb using to_jsonb(dietary_tags);
alter table meal_catalog alter column dietary_tags set default '[]'::jsonb;

commit;
