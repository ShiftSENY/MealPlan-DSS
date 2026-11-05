// ==========================================================================
// Data access layer — every query is scoped to the signed-in user's id.
// The Neon HTTP driver returns rows as plain objects / arrays.
// ==========================================================================

import { getSql } from "./neon.js";

/* -------------------------------------------------------------------------
   Profiles (budget + preferences)
   ------------------------------------------------------------------------- */

export async function getProfile(userId) {
  const sql = await getSql();
  const rows = await sql`select * from profiles where user_id = ${userId} limit 1`;
  return rows[0] || null;
}

export async function saveProfile(userId, p) {
  const sql = await getSql();
  const rows = await sql`
    insert into profiles (
      user_id, budget, max_cook_time_minutes, dietary_preferences,
      disliked_ingredients, meal_variety, updated_at
    ) values (
      ${userId},
      ${p.budget ?? null},
      ${p.max_cook_time_minutes ?? null},
      ${JSON.stringify(p.dietary_preferences || [])}::jsonb,
      ${JSON.stringify(p.disliked_ingredients || [])}::jsonb,
      ${p.meal_variety || "balanced"},
      now()
    )
    on conflict (user_id) do update set
      budget = excluded.budget,
      max_cook_time_minutes = excluded.max_cook_time_minutes,
      dietary_preferences = excluded.dietary_preferences,
      disliked_ingredients = excluded.disliked_ingredients,
      meal_variety = excluded.meal_variety,
      updated_at = now()
    returning *`;
  return rows[0];
}

/* -------------------------------------------------------------------------
   Inventory
   ------------------------------------------------------------------------- */

export async function listInventory(userId) {
  const sql = await getSql();
  return sql`select * from inventory where user_id = ${userId} order by item_name asc`;
}

export async function addInventory(userId, item) {
  const sql = await getSql();
  const rows = await sql`
    insert into inventory (
      user_id, item_name, category, quantity, unit,
      purchase_date, expiration_date, storage_location, notes
    ) values (
      ${userId}, ${item.item_name}, ${item.category || null},
      ${item.quantity ?? null}, ${item.unit || null},
      ${item.purchase_date || null}, ${item.expiration_date || null},
      ${item.storage_location || null}, ${item.notes || null}
    )
    returning *`;
  return rows[0];
}

export async function updateInventory(userId, id, item) {
  const sql = await getSql();
  const rows = await sql`
    update inventory set
      item_name = ${item.item_name},
      category = ${item.category || null},
      quantity = ${item.quantity ?? null},
      unit = ${item.unit || null},
      purchase_date = ${item.purchase_date || null},
      expiration_date = ${item.expiration_date || null},
      storage_location = ${item.storage_location || null},
      notes = ${item.notes || null},
      updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning *`;
  return rows[0];
}

export async function deleteInventory(userId, id) {
  const sql = await getSql();
  await sql`delete from inventory where id = ${id} and user_id = ${userId}`;
}

export async function setInventoryQuantity(userId, id, quantity) {
  const sql = await getSql();
  await sql`
    update inventory set quantity = ${quantity}, updated_at = now()
    where id = ${id} and user_id = ${userId}`;
}

export async function clearPreviousWeekInventory(userId, currentWeekStart) {
  const sql = await getSql();
  return sql`
    delete from inventory
    where user_id = ${userId}
      and coalesce(purchase_date, created_at::date) < ${currentWeekStart}
    returning id, item_name`;
}

/* -------------------------------------------------------------------------
   Meal catalog
   ------------------------------------------------------------------------- */

export async function listMeals(userId) {
  const sql = await getSql();
  return sql`select * from meal_catalog where user_id = ${userId} order by created_at desc`;
}

export async function addMeal(userId, m) {
  const sql = await getSql();
  const rows = await sql`
    insert into meal_catalog (
      user_id, name, meal_periods, ingredients, estimated_cost,
      prep_time_minutes, cook_time_minutes, nutrition_notes, dietary_tags
    ) values (
      ${userId}, ${m.name}, ${JSON.stringify(m.meal_periods || [])}::jsonb,
      ${JSON.stringify(m.ingredients || [])}::jsonb,
      ${m.estimated_cost ?? null},
      ${m.prep_time_minutes ?? null}, ${m.cook_time_minutes ?? null},
      ${m.nutrition_notes || null},
      ${JSON.stringify(m.dietary_tags || [])}::jsonb
    )
    returning *`;
  return rows[0];
}

export async function updateMeal(userId, id, m) {
  const sql = await getSql();
  const rows = await sql`
    update meal_catalog set
      name = ${m.name},
      meal_periods = ${JSON.stringify(m.meal_periods || [])}::jsonb,
      ingredients = ${JSON.stringify(m.ingredients || [])}::jsonb,
      estimated_cost = ${m.estimated_cost ?? null},
      prep_time_minutes = ${m.prep_time_minutes ?? null},
      cook_time_minutes = ${m.cook_time_minutes ?? null},
      nutrition_notes = ${m.nutrition_notes || null},
      dietary_tags = ${JSON.stringify(m.dietary_tags || [])}::jsonb,
      updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning *`;
  return rows[0];
}

export async function deleteMeal(userId, id) {
  const sql = await getSql();
  await sql`delete from meal_catalog where id = ${id} and user_id = ${userId}`;
}

/* -------------------------------------------------------------------------
   Date helpers (local calendar days, "YYYY-MM-DD")
   ------------------------------------------------------------------------- */

function toLocalDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(value, count) {
  const date = toLocalDate(value);
  date.setDate(date.getDate() + count);
  return toISODate(date);
}

export function daysBetween(from, to) {
  return Math.round((toLocalDate(to) - toLocalDate(from)) / 86400000);
}

/* -------------------------------------------------------------------------
   Weekly plan (date-based)
   ------------------------------------------------------------------------- */

export async function getPlanForRange(userId, from, to) {
  const sql = await getSql();
  return sql`
    select wp.meal_date, wp.meal_period, wp.meal_id, wp.leftover_from,
           mc.name, mc.ingredients, mc.estimated_cost,
           mc.prep_time_minutes, mc.cook_time_minutes, mc.dietary_tags
    from weekly_plan wp
    left join meal_catalog mc on mc.id = wp.meal_id
    where wp.user_id = ${userId}
      and wp.meal_date between ${from} and ${to}
    order by wp.meal_date asc, wp.meal_period asc`;
}

export async function assignMeal(userId, mealDate, period, mealId, leftoverFrom = null) {
  const sql = await getSql();
  const rows = await sql`
    insert into weekly_plan (user_id, meal_date, meal_period, meal_id, leftover_from)
    values (${userId}, ${mealDate}, ${period}, ${mealId}, ${leftoverFrom})
    on conflict (user_id, meal_date, meal_period)
    do update set meal_id = excluded.meal_id,
                  leftover_from = excluded.leftover_from,
                  assigned_at = now()
    returning *`;
  return rows[0];
}

export async function removeMeal(userId, mealDate, period) {
  const sql = await getSql();
  await sql`
    delete from weekly_plan
    where user_id = ${userId} and meal_date = ${mealDate} and meal_period = ${period}`;
}

export async function clearPlanWeek(userId, from, to) {
  const sql = await getSql();
  await sql`
    delete from weekly_plan
    where user_id = ${userId} and meal_date between ${from} and ${to}`;
}

// Move a single meal to another date (per-slot "Move to date").
export async function moveMeal(userId, fromDate, period, toDate) {
  if (toISODate(toLocalDate(fromDate)) === toISODate(toLocalDate(toDate))) return;
  const sql = await getSql();
  // Clear the target slot first so the unique constraint is not violated.
  await sql`
    delete from weekly_plan
    where user_id = ${userId} and meal_date = ${toDate} and meal_period = ${period}`;
  // A leftover only makes sense on its original date, so moving it makes the
  // meal cooked fresh on the new date.
  await sql`
    update weekly_plan set meal_date = ${toDate}, leftover_from = null, assigned_at = now()
    where user_id = ${userId} and meal_date = ${fromDate} and meal_period = ${period}`;
}

// Shift every entry in a week by the same offset so the whole week moves.
export async function shiftWeek(userId, oldStart, newStart) {
  const sql = await getSql();
  const oldEnd = addDays(oldStart, 6);
  const rows = await sql`
    select meal_date, meal_period, meal_id, leftover_from from weekly_plan
    where user_id = ${userId} and meal_date between ${oldStart} and ${oldEnd}`;
  if (!rows.length) return 0;

  const delta = daysBetween(oldStart, newStart);
  if (delta === 0) return rows.length;

  await sql`
    delete from weekly_plan
    where user_id = ${userId} and meal_date between ${oldStart} and ${oldEnd}`;

  for (const row of rows) {
    const newDate = addDays(row.meal_date, delta);
    await sql`
      insert into weekly_plan (user_id, meal_date, meal_period, meal_id, leftover_from)
      values (${userId}, ${newDate}, ${row.meal_period}, ${row.meal_id}, ${row.leftover_from})
      on conflict (user_id, meal_date, meal_period)
      do update set meal_id = excluded.meal_id,
                    leftover_from = excluded.leftover_from,
                    assigned_at = now()`;
  }
  return rows.length;
}

// Fill one meal period across a date range. Empty slots only unless overwrite.
export async function bulkFillPeriod(userId, period, mealId, from, to, overwrite = false) {
  const sql = await getSql();
  const dates = [];
  const end = toLocalDate(to);
  for (let d = toLocalDate(from); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(toISODate(d));
  }

  for (const date of dates) {
    if (overwrite) {
      await sql`
        insert into weekly_plan (user_id, meal_date, meal_period, meal_id, leftover_from)
        values (${userId}, ${date}, ${period}, ${mealId}, null)
        on conflict (user_id, meal_date, meal_period)
        do update set meal_id = excluded.meal_id,
                      leftover_from = null,
                      assigned_at = now()`;
    } else {
      await sql`
        insert into weekly_plan (user_id, meal_date, meal_period, meal_id, leftover_from)
        values (${userId}, ${date}, ${period}, ${mealId}, null)
        on conflict (user_id, meal_date, meal_period) do nothing`;
    }
  }
  return dates.length;
}

/* -------------------------------------------------------------------------
   Shopping list (dated history)
   ------------------------------------------------------------------------- */

export async function listShoppingByDate(userId, listDate) {
  const sql = await getSql();
  return sql`
    select * from shopping_list
    where user_id = ${userId} and list_date = ${listDate}
    order by category asc nulls last, ingredient_name asc`;
}

export async function addShoppingItem(userId, listDate, item) {
  const sql = await getSql();
  const rows = await sql`
    insert into shopping_list (user_id, list_date, category, ingredient_name, quantity, unit, purchased, source_meal_id)
    values (${userId}, ${listDate}, ${item.category || null}, ${item.ingredient_name},
            ${item.quantity ?? null}, ${item.unit || null}, ${item.purchased ?? false},
            ${item.source_meal_id || null})
    returning *`;
  return rows[0];
}

export async function updateShoppingItem(userId, id, item) {
  const sql = await getSql();
  const rows = await sql`
    update shopping_list set
      category = ${item.category || null},
      ingredient_name = ${item.ingredient_name},
      quantity = ${item.quantity ?? null},
      unit = ${item.unit || null},
      purchased = ${item.purchased ?? false}
    where id = ${id} and user_id = ${userId}
    returning *`;
  return rows[0];
}

export async function setShoppingPurchased(userId, id, purchased) {
  const sql = await getSql();
  await sql`
    update shopping_list set purchased = ${purchased}
    where id = ${id} and user_id = ${userId}`;
}

export async function deleteShopping(userId, id) {
  const sql = await getSql();
  await sql`delete from shopping_list where id = ${id} and user_id = ${userId}`;
}

export async function clearShoppingDate(userId, listDate) {
  const sql = await getSql();
  await sql`
    delete from shopping_list
    where user_id = ${userId} and list_date = ${listDate}`;
}
