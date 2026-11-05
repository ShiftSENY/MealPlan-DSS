-- ==========================================================================
-- Migration 004 — leftovers
-- --------------------------------------------------------------------------
-- Marks a plan slot as eating leftovers from an earlier slot on the same
-- date (e.g. dinner = leftovers from lunch). Null means the meal is cooked
-- fresh. Leftover slots are skipped when generating the shopping list so
-- ingredients are not counted twice. Safe to run more than once.
-- ==========================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_plan'
      and column_name = 'leftover_from'
  ) then
    alter table weekly_plan add column leftover_from text;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'weekly_plan_leftover_from_check'
  ) then
    alter table weekly_plan add constraint weekly_plan_leftover_from_check
      check (leftover_from is null or leftover_from in ('breakfast','lunch','dinner'));
  end if;
end $$;
