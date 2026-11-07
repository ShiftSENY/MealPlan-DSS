-- ==========================================================================
-- MealPlan DSS — data migration: Neon (PostgreSQL) → cPanel MySQL
--
-- Steps:
--  1. In the Neon SQL Editor, run each block below once per table, in
--     this order: profiles, meal_catalog, inventory, weekly_plan,
--     shopping_list. (Foreign keys: inventory etc. reference profiles, and
--     weekly_plan / shopping_list reference meal_catalog — so children
--     must come AFTER their parents.)
--  2. Download each result as CSV (header row included).
--  3. In phpMyAdmin (cPanel) → CSV import, for each file:
--       - Fields terminated by:          ,
--       - Fields enclosed by:            "
--       - "Tick this box if the first row contains column names"  ✔ ON
--     Then import into the matching MySQL table.
--
-- Fixes baked into this version (v2):
--  (a) Straight double-quotes are stripped from free-text columns with
--      REPLACE(...,'"','') so Neon CSV quoting never forms phantom quote
--      characters inside MySQL values. (JSON columns are NOT stripped —
--      their quotes are structural.)
--  (b) created_at / updated_at are exported as UTC 'YYYY-MM-DD HH:mm:ss'
--      (no microseconds, no +00 suffix) so MySQL TIMESTAMP accepts them.
--  (c) MySQL INT columns that used to be boolean in PostgreSQL are
--      exported as 1/0 via CASE.
--
-- The header row Neon prints ("id","user_id",...) is CSV-standard quoting
-- applied by the exporter; it is NOT part of the data, so tick the
-- "first row contains column names" option in phpMyAdmin. If the header
-- ever got inserted as data you'd see #1366 Incorrect decimal value:
-- 'quantity' — exactly the error this block prevents by matching the
-- exported headers 1:1 with the MySQL column names below.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. profiles
-- --------------------------------------------------------------------------
SELECT
  user_id,
  budget,
  max_cook_time_minutes,
  dietary_preferences::text    AS dietary_preferences,
  disliked_ingredients::text   AS disliked_ingredients,
  nutrition_goals::text        AS nutrition_goals,
  REPLACE(meal_variety, '"', '') AS meal_variety,
  TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
  TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at
FROM profiles
ORDER BY user_id;

-- --------------------------------------------------------------------------
-- 2. meal_catalog  (must come before weekly_plan / shopping_list)
-- --------------------------------------------------------------------------
SELECT
  id,
  user_id,
  REPLACE(name, '"', '') AS name,
  meal_periods::text     AS meal_periods,
  ingredients::text      AS ingredients,
  estimated_cost,
  prep_time_minutes,
  cook_time_minutes,
  REPLACE(nutrition_notes, '"', '') AS nutrition_notes,
  dietary_tags::text     AS dietary_tags,
  TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
  TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at
FROM meal_catalog
ORDER BY user_id;

-- --------------------------------------------------------------------------
-- 3. inventory
-- --------------------------------------------------------------------------
SELECT
  id,
  user_id,
  REPLACE(item_name, '"', '') AS item_name,
  REPLACE(category, '"', '') AS category,
  quantity,
  REPLACE(unit, '"', '') AS unit,
  purchase_date,
  expiration_date,
  REPLACE(storage_location, '"', '') AS storage_location,
  REPLACE(notes, '"', '') AS notes,
  TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
  TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at
FROM inventory
ORDER BY user_id;

-- --------------------------------------------------------------------------
-- 4. weekly_plan  (references meal_catalog)
-- --------------------------------------------------------------------------
SELECT
  id,
  user_id,
  meal_date,
  REPLACE(meal_period, '"', '') AS meal_period,
  meal_id,
  REPLACE(leftover_from, '"', '') AS leftover_from,
  TO_CHAR(assigned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS assigned_at
FROM weekly_plan
ORDER BY user_id, meal_date, meal_period;

-- --------------------------------------------------------------------------
-- 5. shopping_list  (references meal_catalog)
-- --------------------------------------------------------------------------
SELECT
  id,
  user_id,
  list_date,
  REPLACE(category, '"', '') AS category,
  REPLACE(ingredient_name, '"', '') AS ingredient_name,
  quantity,
  REPLACE(unit, '"', '') AS unit,
  CASE WHEN purchased THEN 1 ELSE 0 END AS purchased,
  source_meal_id,
  TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at
FROM shopping_list
ORDER BY user_id, list_date;

-- ==========================================================================
-- NOTE about "no data" exports:
-- If a table is empty, the Neon SQL Editor returns no rows. That's fine —
-- import is then a no-op for that table.
-- ==========================================================================
