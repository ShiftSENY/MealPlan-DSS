-- ==========================================================================
-- MealPlan DSS — Neon (PostgreSQL) schema
-- Run this once in the Neon SQL Editor for your project.
-- Data is scoped per user with a text user_id (Clerk user id, e.g. "user_2...").
-- ==========================================================================

create extension if not exists pgcrypto;

-- ---------- profiles: per-user preferences ----------
create table if not exists profiles (
  user_id                text primary key,
  budget                 numeric,
  max_cook_time_minutes  int,
  dietary_preferences    jsonb default '[]'::jsonb,
  disliked_ingredients   jsonb default '[]'::jsonb,
  nutrition_goals        jsonb default '[]'::jsonb,
  meal_variety           text  default 'balanced',
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ---------- inventory: kitchen ingredients ----------
create table if not exists inventory (
  id                uuid primary key default gen_random_uuid(),
  user_id           text not null references profiles(user_id) on delete cascade,
  item_name         text not null,
  category          text,
  quantity          numeric,
  unit              text,
  purchase_date     date,
  expiration_date   date,
  storage_location  text,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ---------- meal_catalog: user-defined Filipino dishes ----------
create table if not exists meal_catalog (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null references profiles(user_id) on delete cascade,
  name                 text not null,
  meal_periods         jsonb default '[]'::jsonb,  -- ["breakfast","lunch",...]
  ingredients          jsonb default '[]'::jsonb,  -- [{ name, quantity, unit }]
  estimated_cost       numeric,
  prep_time_minutes    int,
  cook_time_minutes    int,
  nutrition_notes      text,
  dietary_tags         jsonb default '[]'::jsonb,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ---------- weekly_plan: one row per date + meal period ----------
create table if not exists weekly_plan (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references profiles(user_id) on delete cascade,
  meal_date    date not null,
  meal_period  text check (meal_period in ('breakfast','lunch','dinner')),
  meal_id      uuid references meal_catalog(id) on delete set null,
  leftover_from text check (leftover_from in ('breakfast','lunch','dinner')),
  assigned_at  timestamptz default now(),
  unique (user_id, meal_date, meal_period)
);

-- ---------- shopping_list: dated lists, supports history ----------
create table if not exists shopping_list (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null references profiles(user_id) on delete cascade,
  list_date        date not null,
  category         text,                              -- Food / Condiment / Ingredient
  ingredient_name  text not null,
  quantity         numeric,
  unit             text,
  purchased        boolean default false,
  source_meal_id   uuid references meal_catalog(id) on delete set null,
  created_at       timestamptz default now()
);

-- ---------- helpful indexes ----------
create index if not exists inventory_user_idx     on inventory (user_id);
create index if not exists meal_catalog_user_idx  on meal_catalog (user_id);
create index if not exists weekly_plan_date_idx   on weekly_plan (user_id, meal_date);
create index if not exists shopping_date_idx      on shopping_list (user_id, list_date);
