// ==========================================================================
// Data access layer — every query is scoped to the signed-in user's id.
// Now backed by the PHP API (api/*.php) instead of Neon direct calls.
// Clerk remains the auth layer; user_id is the Clerk user id string.
// Every function signature matches the previous Neon-based db.js exactly,
// so app.js requires no changes.
// ==========================================================================

const API = "/api";

/* -------------------------------------------------------------------------
   Transport helpers
   ------------------------------------------------------------------------- */

function qs(params) {
  return params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
    .join("&");
}

async function apiGet(path, userId, extra = {}) {
  const res = await fetch(`${API}/${path}?${qs([["user_id", userId], ...Object.entries(extra)])}`);
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function apiPost(path, userId, body = {}) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, ...body }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function apiDelete(path, userId, extra = {}) {
  const res = await fetch(`${API}/${path}?${qs([["user_id", userId], ...Object.entries(extra)])}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function apiPut(path, userId, body = {}) {
  const res = await fetch(`${API}/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, ...body }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function errorText(res) {
  try {
    const data = await res.json();
    return data?.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

/* JSON-in-MySQL helpers (Neon JSONB -> MySQL JSON strings) */

function parseJsonField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowWithJsonArrays(row, columns) {
  if (!row) return row;
  const out = { ...row };
  columns.forEach((col) => {
    if (col in out) out[col] = parseJsonField(out[col]);
  });
  return out;
}

/* -------------------------------------------------------------------------
   Profiles (budget + preferences)
   ------------------------------------------------------------------------- */

export async function getProfile(userId) {
  const data = await apiGet("get_user.php", userId);
  const profile = data?.profile;
  return profile
    ? rowWithJsonArrays(profile, ["dietary_preferences", "disliked_ingredients", "nutrition_goals"])
    : null;
}

export async function saveProfile(userId, p) {
  await apiPost("profiles.php", userId, {
    budget: p.budget ?? null,
    max_cook_time_minutes: p.max_cook_time_minutes ?? null,
    dietary_preferences: p.dietary_preferences || [],
    disliked_ingredients: p.disliked_ingredients || [],
    nutrition_goals: p.nutrition_goals || [],
    meal_variety: p.meal_variety || "balanced",
  });
  return getProfile(userId);
}

/* -------------------------------------------------------------------------
   Inventory
   ------------------------------------------------------------------------- */

export async function listInventory(userId) {
  return apiGet("inventory.php", userId);
}

export async function addInventory(userId, item) {
  const result = await apiPost("inventory.php", userId, item);
  return result?.id || result;
}

export async function updateInventory(userId, id, item) {
  await apiPut("inventory.php", userId, { id, ...item });
  return { id, ...item };
}

export async function deleteInventory(userId, id) {
  await apiDelete("inventory.php", userId, { id });
}

export async function setInventoryQuantity(userId, id, quantity) {
  await apiPut("inventory.php", userId, { id, quantity });
}

export async function clearPreviousWeekInventory(userId, currentWeekStart) {
  return apiDelete("inventory.php", userId, { week_start: currentWeekStart });
}

/* -------------------------------------------------------------------------
   Meal catalog
   ------------------------------------------------------------------------- */

export async function listMeals(userId) {
  const rows = await apiGet("meals.php", userId);
  return rows.map((r) =>
    rowWithJsonArrays(r, ["meal_periods", "ingredients", "dietary_tags"])
  );
}

export async function addMeal(userId, m) {
  const result = await apiPost("meals.php", userId, m);
  return result?.id || result;
}

export async function updateMeal(userId, id, m) {
  await apiPut("meals.php", userId, { id, ...m });
  return { id, ...m };
}

export async function deleteMeal(userId, id) {
  await apiDelete("meals.php", userId, { id });
}

/* -------------------------------------------------------------------------
   Date helpers (local calendar days, "YYYY-MM-DD") — unchanged
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
  return apiGet("plans.php", userId, { from, to });
}

export async function assignMeal(userId, mealDate, period, mealId, leftoverFrom = null) {
  await apiPost("plans.php", userId, {
    action: "assign",
    meal_date: mealDate,
    meal_period: period,
    meal_id: mealId,
    leftover_from: leftoverFrom,
  });
}

export async function removeMeal(userId, mealDate, period) {
  await apiPost("plans.php", userId, {
    action: "remove",
    meal_date: mealDate,
    meal_period: period,
  });
}

export async function clearPlanWeek(userId, from, to) {
  await apiPost("plans.php", userId, {
    action: "clear_week",
    from,
    to,
  });
}

// Move a single meal to another date (per-slot "Move to date").
export async function moveMeal(userId, fromDate, period, toDate) {
  if (toISODate(toLocalDate(fromDate)) === toISODate(toLocalDate(toDate))) return;
  await apiPost("plans.php", userId, {
    action: "move",
    from_date: fromDate,
    to_date: toDate,
    period,
  });
}

// Shift every entry in a week by the same offset so the whole week moves.
export async function shiftWeek(userId, oldStart, newStart) {
  const result = await apiPost("plans.php", userId, {
    action: "shift_week",
    old_start: oldStart,
    new_start: newStart,
  });
  return result?.moved ?? 0;
}

// Fill one meal period across a date range. Empty slots only unless overwrite.
export async function bulkFillPeriod(userId, period, mealId, from, to, overwrite = false) {
  const result = await apiPost("plans.php", userId, {
    action: "bulk_fill",
    period,
    meal_id: mealId,
    from,
    to,
    overwrite,
  });
  return result?.filled ?? 0;
}

/* -------------------------------------------------------------------------
   Shopping list (dated history)
   ------------------------------------------------------------------------- */

export async function listShoppingByDate(userId, listDate) {
  return apiGet("shopping.php", userId, { list_date: listDate });
}

export async function addShoppingItem(userId, listDate, item) {
  const result = await apiPost("shopping.php", userId, {
    action: "add",
    list_date: listDate,
    ...item,
  });
  return result?.id || result;
}

export async function updateShoppingItem(userId, id, item) {
  await apiPost("shopping.php", userId, {
    action: "update",
    id,
    ...item,
  });
  return { id, ...item };
}

export async function setShoppingPurchased(userId, id, purchased) {
  await apiPost("shopping.php", userId, {
    action: "purchased",
    id,
    purchased,
  });
}

export async function deleteShopping(userId, id) {
  await apiPost("shopping.php", userId, {
    action: "delete",
    id,
  });
}

export async function clearShoppingDate(userId, listDate) {
  await apiPost("shopping.php", userId, {
    action: "clear_date",
    list_date: listDate,
  });
}
