-- ==========================================================================
-- Migration 003 — allow a meal to belong to multiple meal periods
-- --------------------------------------------------------------------------
-- Replaces meal_catalog.meal_period (single value) with meal_periods (JSONB
-- array), e.g. ["lunch","dinner"]. Existing values become one-item arrays.
-- Safe to run more than once.
-- ==========================================================================

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'meal_catalog'
      and column_name = 'meal_period'
  ) then
    execute 'alter table meal_catalog add column if not exists meal_periods jsonb default ''[]''::jsonb';
    execute 'update meal_catalog
                set meal_periods = jsonb_build_array(meal_period)
              where (meal_periods is null or meal_periods = ''[]''::jsonb)
                and meal_period is not null
                and meal_period <> ''''';
    execute 'alter table meal_catalog drop column meal_period';
  else
    execute 'alter table meal_catalog add column if not exists meal_periods jsonb default ''[]''::jsonb';
  end if;
end $$;
