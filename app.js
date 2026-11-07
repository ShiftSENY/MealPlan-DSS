// ==========================================================================
// MealPlan DSS — dashboard controller
// --------------------------------------------------------------------------
// Sections in this file:
//   - small helpers (DOM, formatting, dates)
//   - auth gate (Clerk) + data loading
//   - tab routing
//   - view renderers: suggestions, inventory, meals, weekly plan,
//     shopping list, preferences
//   - dialog helpers
// ==========================================================================

import * as db from "./db.js";
import { rankMeals, normalizeName } from "./recommend.js";
import { parseGroceryCsv } from "./csv-parse.js";

/* ==========================================================================
   Constants and state
   ========================================================================== */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PERIODS = ["breakfast", "lunch", "dinner"];

// Earliest date the planner / shopping history can navigate back to.
const HISTORY_START = "2026-08-10";
const SHOPPING_CATEGORIES = ["Food", "Condiment", "Ingredient", "Other"];

const FILIPINO_DISHES = [
  { name: "Adobo", period: "lunch" },
  { name: "Sinigang", period: "lunch" },
  { name: "Lumpia", period: "snack" },
  { name: "Kare-Kare", period: "dinner" },
  { name: "Pancit", period: "lunch" },
  { name: "Tinola", period: "dinner" },
  { name: "Pinakbet", period: "dinner" },
  { name: "Menudo", period: "lunch" },
];

const CATEGORIES = [
  "vegetable", "fruit", "meat", "seafood", "grain", "dairy",
  "canned good", "condiment", "spice", "oil", "other",
];
const STORAGE = ["pantry", "refrigerator", "freezer", "other"];
const CUSTOM_CATEGORIES_KEY = "mealplan.customInventoryCategories";
const WEEKLY_INVENTORY_REVIEW_KEY = "mealplan.weeklyInventoryReview"; // { userId, weekStart, previousWeekStart, checkedAt }

function saveWeeklyInventoryReview(review) {
  try {
    localStorage.setItem(WEEKLY_INVENTORY_REVIEW_KEY, JSON.stringify(review));
  } catch {
    // Reminders cannot persist when browser storage is unavailable.
  }
}

function loadWeeklyInventoryReview(userId = state.userId) {
  try {
    const review = JSON.parse(localStorage.getItem(WEEKLY_INVENTORY_REVIEW_KEY) || "null");
    return review && review.userId === userId ? review : null;
  } catch {
    return null;
  }
}

function loadCustomCategories() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((c) => typeof c === "string" && c.trim())
      : [];
  } catch {
    return [];
  }
}

function rememberCategory(name) {
  const clean = String(name || "").trim();
  if (!clean) return;
  const known = new Set(
    [...CATEGORIES, ...loadCustomCategories()].map((c) => c.toLowerCase())
  );
  if (known.has(clean.toLowerCase())) return;
  try {
    localStorage.setItem(
      CUSTOM_CATEGORIES_KEY,
      JSON.stringify([...loadCustomCategories(), clean])
    );
  } catch {
    // Storage may be unavailable (private mode); the item still saves.
  }
}

// Default categories + user-created ones + any already used by inventory items.
function allInventoryCategories() {
  const seen = new Set();
  const out = [];
  const candidates = [
    ...CATEGORIES,
    ...loadCustomCategories(),
    ...state.inventory.map((item) => item.category),
  ];
  candidates.forEach((candidate) => {
    const value = String(candidate || "").trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

const state = {
  user: null,
  userId: null,
  inventory: [],
  meals: [],
  plan: [],
  planStart: null,       // Monday of the displayed plan week (YYYY-MM-DD)
  shopping: [],
  shoppingDate: null,    // Monday of the displayed shopping week (YYYY-MM-DD)
  profile: null,
  view: "suggestions",
  search: { suggestions: "", inventory: "", meals: "" },
};

/* ==========================================================================
   Small helpers
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
}

function asArray(value) {
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

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A meal can belong to several periods. Handles the new JSONB array plus the
// old single meal_period value for any data not yet migrated.
function mealPeriods(meal) {
  const raw = meal?.meal_periods ?? meal?.meal_period ?? [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      // not JSON, fall through to treat it as a single value
    }
    return raw ? [raw] : [];
  }
  return [];
}

function numOrNull(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function mealMatchesQuery(meal, query) {
  if (!query || !meal) return false;
  const q = String(query).toLowerCase();
  const fields = [
    meal.name,
    asArray(meal.ingredients).map((i) => i.name).join(" "),
    asArray(meal.dietary_tags).join(" "),
  ];
  return fields.some((f) => String(f || "").toLowerCase().includes(q));
}

function inventoryMatchesQuery(item, query) {
  if (!query || !item) return false;
  const q = String(query).toLowerCase();
  const fields = [
    item.item_name,
    item.category,
    item.storage_location,
    item.notes,
  ];
  return fields.some((f) => String(f || "").toLowerCase().includes(q));
}

function bindViewSearch(section, key) {
  const input = $(".search-input", section);
  if (!input) return;
  input.addEventListener("input", () => {
    state.search[key] = input.value;
    const pos = input.selectionStart;
    renderView();
    const next = $(".search-input", section);
    if (next) {
      next.focus();
      try {
        next.setSelectionRange(pos, pos);
      } catch {
        // ignore
      }
    }
  });
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function parseDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Normalise a date-ish value into the "YYYY-MM-DD" an <input type=date> expects.
function toDateInput(value) {
  if (!value) return "";
  const date = parseDate(value);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toDateInput(new Date());
}

// Monday of the week containing the given date (ISO "YYYY-MM-DD").
function startOfWeek(value) {
  const date = parseDate(value) || parseDate(todayISO());
  const dow = date.getDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return toDateInput(date);
}

function addDaysISO(value, count) {
  const date = parseDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + count);
  return toDateInput(date);
}

function currentWeekStart() {
  return startOfWeek(todayISO());
}

function weekLabel(startValue) {
  return `${fmtDate(startValue)} – ${fmtDate(addDaysISO(startValue, 6))}`;
}

// Plan up to a year ahead. Weeks are clamped to [HISTORY_START, horizon].
const PLAN_HORIZON_WEEKS = 52;

function maxWeekStart() {
  return addDaysISO(currentWeekStart(), PLAN_HORIZON_WEEKS * 7);
}

function maxPlanDate() {
  return addDaysISO(maxWeekStart(), 6);
}

function clampWeekStart(value) {
  let start = startOfWeek(value);
  const max = maxWeekStart();
  if (start < HISTORY_START) start = HISTORY_START;
  if (start > max) start = max;
  return start;
}

function weekdayName(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("en-PH", { weekday: "long" }) : "";
}

function fmtDate(value) {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function expiryInfo(value) {
  const date = parseDate(value);
  if (!date) return { key: "none", label: "Expire: N/A" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date - today) / 86400000);
  if (days < 0) return { key: "past", label: `Expired ${Math.abs(days)}d ago` };
  if (days === 0) return { key: "soon", label: "Expires today" };
  if (days <= 3) return { key: "soon", label: `${days}d left` };
  return { key: "fresh", label: `${days}d left` };
}

function inventoryItemWeekStart(item) {
  const dateValue = item?.purchase_date || item?.created_at;
  const date = parseDate(dateValue);
  return date ? startOfWeek(toDateInput(date)) : null;
}

function previousWeekInventoryItems(weekStart = currentWeekStart()) {
  return state.inventory.filter((item) => {
    const itemWeek = inventoryItemWeekStart(item);
    return itemWeek && itemWeek < weekStart;
  });
}

function weeklyInventoryReviewInfo() {
  const weekStart = currentWeekStart();
  const previousWeekStart = addDaysISO(weekStart, -7);
  const review = loadWeeklyInventoryReview(state.userId);
  const reviewed = Boolean(review?.weekStart === weekStart && review.checkedAt);
  const previousItems = previousWeekInventoryItems(weekStart);
  const due = previousWeekStart >= HISTORY_START && previousItems.length > 0 && !reviewed;

  return { weekStart, previousWeekStart, previousItems, reviewed, due };
}

let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

/* ==========================================================================
   Auth gate (Clerk)
   ========================================================================== */

let authMounted = false;
let mountedAuthNode = null;
let mountedAuthMode = null;

function waitForClerk(timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.Clerk) return resolve(window.Clerk);
      if (Date.now() - started > timeout) return reject(new Error("Sign-in service did not load."));
      setTimeout(poll, 100);
    })();
  });
}

function mountAuth(mode) {
  if (!window.Clerk) return;
  const root = $("#auth-root");
  if (!root) return;

  // Clerk keeps internal state tied to a mount node, so never re-use one.
  // Tear down the previous instance and remove its node completely.
  if (mountedAuthNode) {
    try {
      if (mountedAuthMode === "sign-up") window.Clerk.unmountSignUp?.(mountedAuthNode);
      else window.Clerk.unmountSignIn?.(mountedAuthNode);
    } catch (err) { /* already gone */ }
    mountedAuthNode.remove();
    mountedAuthNode = null;
    mountedAuthMode = null;
  }
  root.innerHTML = "";

  // Clear a leftover Clerk hash route (e.g. "#/sign-up") so the requested
  // component renders instead of redirecting to the other flow.
  if (window.location.hash.startsWith("#/")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  const node = document.createElement("div");
  node.className = "auth__frame";
  root.appendChild(node);

  $$("[data-auth-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.authMode === mode);
  });

  try {
    if (mode === "sign-up") window.Clerk.mountSignUp(node);
    else window.Clerk.mountSignIn(node);
    mountedAuthNode = node;
    mountedAuthMode = mode;
  } catch (err) {
    console.error("Clerk inline mount failed, opening the modal instead:", err);
    node.remove();
    // Fallback: Clerk's own modal always works, so account access is never blocked.
    try {
      if (mode === "sign-up") window.Clerk.openSignUp();
      else window.Clerk.openSignIn();
    } catch (inner) {
      root.innerHTML = `<p class="small text-muted">Could not load the form. Please refresh the page.</p>`;
    }
  }
  authMounted = true;
}

function showAuth() {
  $("#dashboard").hidden = true;
  $("#auth-screen").hidden = false;
  if (!authMounted) mountAuth("sign-in");
}

async function boot() {
  try {
    const Clerk = await waitForClerk();
    await Clerk.load();

    Clerk.addListener(({ user }) => {
      if (user) startApp(user);
      else showAuth();
    });

    if (Clerk.user) startApp(Clerk.user);
    else showAuth();
  } catch (err) {
    console.error(err);
    const root = $("#auth-root");
    if (root) {
      root.innerHTML = `<p class="small text-muted">${escapeHtml(err.message)} Check your connection and try again.</p>`;
    }
  }
}

async function startApp(user) {
  state.user = user;
  state.userId = user.id;
  authMounted = false; // allow the sign-in form to remount after logout

  $("#auth-screen").hidden = true;
  $("#dashboard").hidden = false;
  $("#user-email").textContent =
    user.primaryEmailAddress?.emailAddress || user.username || "Signed in";

  // The PHP API is always reachable from the same origin; there is no
  // separate "database not configured" state anymore.
  $("#db-banner").hidden = true;
  await loadAll();
  renderView();
}

/* ==========================================================================
   Data loading / refreshing
   ========================================================================== */

async function loadAll() {
  try {
    state.planStart = clampWeekStart(state.planStart || todayISO());
    state.shoppingDate = clampWeekStart(state.shoppingDate || todayISO());

    const [inventory, meals, plan, shopping, profile] = await Promise.all([
      db.listInventory(state.userId),
      db.listMeals(state.userId),
      db.getPlanForRange(state.userId, state.planStart, addDaysISO(state.planStart, 6)),
      db.listShoppingByDate(state.userId, state.shoppingDate),
      db.getProfile(state.userId),
    ]);
    state.inventory = inventory;
    state.meals = meals;
    state.plan = plan;
    state.shopping = shopping;
    state.profile = profile || {
      budget: null, max_cook_time_minutes: null,
      dietary_preferences: [], disliked_ingredients: [],
      meal_variety: "balanced",
    };

    // Other tables reference profiles(user_id); make sure the row exists for
    // brand-new accounts before they add inventory or plan meals.
    if (!profile) {
      try {
        state.profile = await db.saveProfile(state.userId, state.profile);
      } catch (err) {
        console.warn("Could not create default profile:", err);
      }
    }
  } catch (err) {
    console.error(err);
    toast("Could not load your data: " + err.message);
  }
}

async function refreshInventory() {
  state.inventory = await db.listInventory(state.userId);
}
async function refreshMeals() {
  state.meals = await db.listMeals(state.userId);
}
async function refreshPlan() {
  state.plan = await db.getPlanForRange(
    state.userId, state.planStart, addDaysISO(state.planStart, 6)
  );
}
async function refreshShopping() {
  state.shopping = await db.listShoppingByDate(state.userId, state.shoppingDate);
}

/* ==========================================================================
   Backup / restore (profile panel)
   --------------------------------------------------------------------------
   Serialises everything the dashboard owns (inventory, meal catalog, plan
   history window, shopping history, preferences) into a versioned JSON
   file. Restore re-creates rows via the same PHP API calls the app uses
   for normal CRUD — new rows get fresh UUIDs, so old UUID references
   (plan->meal, shopping->meal) are remapped through an id map.
   ========================================================================== */

async function buildBackupData() {
  const [profile, inventory, meals] = await Promise.all([
    db.getProfile(state.userId),
    db.listInventory(state.userId),
    db.listMeals(state.userId),
  ]);

  // The plan and shopping APIs are date-ranged, so we export the widest
  // window the planner supports: HISTORY_START .. today + 52 weeks.
  const plan = await db.getPlanForRange(state.userId, HISTORY_START, maxPlanDate());
  const shopping = await db.listShoppingByDate(state.userId, HISTORY_START);

  return {
    app: "mealplan-dss",
    version: 1,
    exportedAt: new Date().toISOString(),
    userId: state.userId,
    profile: profile || null,
    inventory: inventory || [],
    mealCatalog: meals || [],
    weeklyPlan: plan || [],
    shoppingList: shopping || [],
  };
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function backupAll() {
  toast("Building your backup…");
  try {
    const data = await buildBackupData();
    downloadJson(`mealplan-backup-${data.exportedAt.slice(0, 10)}.json`, data);
    toast(`Backup saved (${data.inventory.length} inventory, ${data.mealCatalog.length} meals, ${data.weeklyPlan.length} plan slots).`);
  } catch (err) {
    console.error(err);
    toast("Backup failed: " + err.message);
  }
}

async function restoreBackup(parsed) {
  if (!parsed || parsed.app !== "mealplan-dss") {
    throw new Error("That file does not look like a MealPlan DSS backup.");
  }
  if (!Array.isArray(parsed.inventory) || !Array.isArray(parsed.mealCatalog) ||
      !Array.isArray(parsed.weeklyPlan)) {
    throw new Error("The backup file is missing data sections.");
  }

  const uid = state.userId;

  // 1. Preferences (saveProfile upserts — this restores the profile row).
  if (parsed.profile) {
    const p = parsed.profile;
    await db.saveProfile(uid, {
      budget: p.budget ?? null,
      max_cook_time_minutes: p.max_cook_time_minutes ?? null,
      dietary_preferences: asArray(p.dietary_preferences),
      disliked_ingredients: asArray(p.disliked_ingredients),
      nutrition_goals: asArray(p.nutrition_goals),
      meal_variety: p.meal_variety || "balanced",
    });
  }

  // 2. Meal catalog first (plan and shopping rows reference meal ids).
  const mealIdMap = new Map(); // oldId -> newId
  for (const meal of parsed.mealCatalog) {
    const created = await db.addMeal(uid, {
      name: meal.name,
      meal_periods: asArray(meal.meal_periods),
      ingredients: asArray(meal.ingredients),
      estimated_cost: meal.estimated_cost ?? null,
      prep_time_minutes: meal.prep_time_minutes ?? null,
      cook_time_minutes: meal.cook_time_minutes ?? null,
      nutrition_notes: meal.nutrition_notes || null,
      dietary_tags: asArray(meal.dietary_tags),
    });
    if (created?.id && meal.id) mealIdMap.set(meal.id, created.id);
  }

  // 3. Inventory.
  for (const item of parsed.inventory) {
    await db.addInventory(uid, {
      item_name: item.item_name,
      category: item.category || null,
      quantity: item.quantity ?? null,
      unit: item.unit || null,
      purchase_date: item.purchase_date || null,
      expiration_date: item.expiration_date || null,
      storage_location: item.storage_location || null,
      notes: item.notes || null,
    });
  }

  // 4. Weekly plan (remap meal ids; skip slots whose meal didn't restore).
  let restoredSlots = 0;
  for (const slot of parsed.weeklyPlan) {
    const mealId = mealIdMap.get(slot.meal_id) || slot.meal_id;
    if (!slot.meal_date || !slot.meal_period || !mealId) continue;
    await db.assignMeal(uid, slot.meal_date, slot.meal_period, mealId, slot.leftover_from || null);
    restoredSlots++;
  }

  // 5. Shopping history (remap source meal ids when available).
  for (const row of parsed.shoppingList || []) {
    await db.addShoppingItem(uid, row.list_date, {
      category: row.category || null,
      ingredient_name: row.ingredient_name,
      quantity: row.quantity ?? null,
      unit: row.unit || null,
      purchased: Boolean(row.purchased),
      source_meal_id: row.source_meal_id ? (mealIdMap.get(row.source_meal_id) || null) : null,
    });
  }

  refreshedAllCounts(uid, parsed, restoredSlots);
}

async function refreshedAllCounts(uid, parsed, restoredSlots) {
  if (state.userId !== uid) return;
  await Promise.all([
    refreshInventory(), refreshMeals(), refreshPlan(), refreshShopping(),
  ]);
  renderView();
  toast(
    `Restored ${parsed.inventory?.length || 0} inventory, ${parsed.mealCatalog?.length || 0} meals, ` +
    `${restoredSlots} plan slots.`
  );
}

// Week navigation (clamped to today, no future weeks).
async function goToPlanWeek(start) {
  state.planStart = clampWeekStart(start);
  await refreshPlan();
  renderView();
}

async function goToShoppingWeek(start) {
  state.shoppingDate = clampWeekStart(start);
  await refreshShopping();
  renderView();
}

/* ==========================================================================
   Routing
   ========================================================================== */

function renderView() {
  $$(".view").forEach((v) => { v.hidden = true; });
  $$(".app-tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.view === state.view);
  });

  const section = $("#view-" + state.view);
  if (!section) return;
  section.hidden = false;

  // Data comes from the PHP API (api/*.php) — nothing to configure in the
  // browser anymore, so this guard from the old Neon era is gone.

  switch (state.view) {
    case "suggestions": renderSuggestions(section); break;
    case "inventory": renderInventory(section); break;
    case "meals": renderMeals(section); break;
    case "plan": renderPlan(section); break;
    case "shopping": renderShopping(section); break;
    case "preferences": renderPreferences(section); break;
  }
}

  // (notConfiguredHtml was removed — no Neon connection string to configure.)

/* ==========================================================================
   Suggestions view
   ========================================================================== */

function renderSuggestions(section) {
  const query = (state.search?.suggestions || "").toLowerCase();
  const ranked = rankMeals(state.meals, state.inventory, state.profile, state.plan)
    .filter((r) => !query || mealMatchesQuery(r.meal, query));

  const head = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Recommended for you</h2>
        <p class="view__sub">Ranked from your meal catalog against your inventory and preferences.</p>
      </div>
      <div class="view__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-go="preferences">Edit preferences</button>
      </div>
    </div>
    <div class="search-bar">
      <label for="search-suggestions" class="text-muted">Search</label>
      <input id="search-suggestions" class="search-input" type="search" placeholder="Search dishes or ingredients…"
             value="${escapeHtml(state.search?.suggestions || "")}">
    </div>`;

  if (!state.meals.length) {
    section.innerHTML = head + emptyCatalogHtml();
    bindFilipinoChips(section);
    bindGoButtons(section);
    return;
  }

  const inventoryNote = state.inventory.length
    ? ""
    : `<p class="small text-muted" style="margin-bottom:1rem">Tip: add ingredients to your inventory so the ranking can favour meals you can already cook.</p>`;

  const cards = ranked.slice(0, 12).map((r) => {
    const meta = [];
    const periods = mealPeriods(r.meal);
    if (periods.length) meta.push(periods.map(capitalize).join(" / "));
    if (r.totalTime) meta.push(`~${r.totalTime} min`);
    if (r.cost) meta.push(money(r.cost));

    const status = r.ingredientStatus || [];
    const haveCount = status.filter((ing) => ing.available).length;

    return `
      <article class="suggest ${r.unsuitable ? "suggest--unsuitable" : ""}" data-suggest-card tabindex="0">
        <div class="suggest__top">
          <div>
            <h3 class="suggest__name">${escapeHtml(r.meal.name)}</h3>
            ${meta.length ? `<p class="card__meta">${escapeHtml(meta.join(" · "))}</p>` : ""}
          </div>
          <span class="suggest__score" tabindex="0"
                data-tip="Overall match score: ingredients you have, cook time, cost, diet, variety and expiring items."
                aria-label="Overall match score">${Math.round(r.score * 100)}%</span>
        </div>
        <ul class="suggest__reasons">
          ${r.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
        <div class="suggest__ingredients" hidden>
          ${status.length
        ? `<ul class="ing-status">
                ${status.map((ing) => `
                  <li class="ing-status__row ${ing.available ? "is-available" : "is-missing"}">
                    <span class="ing-status__check" aria-hidden="true">${ing.available ? "✓" : "!"}</span>
                    <span class="ing-status__name">${escapeHtml(ing.name)}${ing.main ? ' <span class="ing-main">Main</span>' : ""}</span>
                    <span class="ing-status__qty">${ing.quantity != null ? `${escapeHtml(String(ing.quantity))}${ing.unit ? " " + escapeHtml(ing.unit) : ""}` : ""}</span>
                    <span class="ing-status__tag">${ing.available ? "Have" : "Need"}</span>
                  </li>`).join("")}
              </ul>`
        : `<p class="small text-muted">No ingredients listed for this meal.</p>`}
        </div>
        <div class="card__row">
          <button class="btn btn--primary btn--sm" type="button" data-assign-meal="${r.meal.id}">Add to plan</button>
          <button class="btn btn--ghost btn--sm" type="button" data-suggest-toggle aria-expanded="false">
            Ingredients <span class="suggest__count">${haveCount}/${status.length}</span>
          </button>
        </div>
      </article>`;
  }).join("");

  section.innerHTML = head + inventoryNote +
    (cards
      ? `<div class="grid suggest-grid">${cards}</div>`
      : `<p class="text-muted">No meals match “${escapeHtml(state.search?.suggestions || "")}”.</p>`);

  bindViewSearch(section, "suggestions");
  bindGoButtons(section);
  $$("[data-assign-meal]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      const meal = state.meals.find((m) => m.id === btn.dataset.assignMeal);
      if (meal) openAssignDialog(meal);
    });
  });

  // Clicking a suggestion card reveals its ingredients (available ones ticked).
  $$("[data-suggest-card]", section).forEach((card) => {
    const panel = $(".suggest__ingredients", card);
    const toggle = $("[data-suggest-toggle]", card);
    if (!panel) return;

    const setOpen = (open) => {
      panel.hidden = !open;
      card.classList.toggle("is-open", open);
      if (toggle) toggle.setAttribute("aria-expanded", String(open));
    };

    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea, label")) return;
      if (event.target.closest(".suggest__ingredients")) return;
      setOpen(panel.hidden);
    });

    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setOpen(panel.hidden);
    });

    if (toggle) {
      toggle.addEventListener("click", () => setOpen(panel.hidden));
    }
  });
}

function emptyCatalogHtml() {
  return `
    <div class="empty">
      <h3>Your meal catalog is empty</h3>
      <p>Add the Filipino dishes you actually cook, along with their ingredients.
         Recommendations appear here once your catalog has meals. Start with a suggestion:</p>
      <div class="chips">
        ${FILIPINO_DISHES.map((d) => `
          <button class="chip" type="button" data-dish-name="${escapeHtml(d.name)}" data-dish-period="${escapeHtml(d.period)}">
            ${escapeHtml(d.name)}
          </button>`).join("")}
      </div>
    </div>`;
}

function bindFilipinoChips(root) {
  $$("[data-dish-name]", root).forEach((chip) => {
    chip.addEventListener("click", () => {
      openMealDialog(null, {
        name: chip.dataset.dishName,
        meal_periods: [chip.dataset.dishPeriod],
      });
    });
  });
}

function bindGoButtons(root) {
  $$("[data-go]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.go;
      renderView();
    });
  });
}

/* ==========================================================================
   Inventory view
   ========================================================================== */

function inventoryCategoryKey(item) {
  const category = String(item?.category || "").trim();
  return category ? category.toLowerCase() : "\\0uncategorized";
}

function inventoryCategoryLabel(key) {
  return key === "\\0uncategorized" ? "Uncategorized" : capitalize(key);
}

function groupInventoryByCategory(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = inventoryCategoryKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return Array.from(groups.entries())
    .map(([key, groupItems]) => ({
      key,
      label: inventoryCategoryLabel(key),
      items: [...groupItems].sort((a, b) =>
        String(a.item_name || "").localeCompare(String(b.item_name || ""))
      ),
    }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

function renderInventory(section) {
  const reviewInfo = weeklyInventoryReviewInfo();
  const query = (state.search?.inventory || "").toLowerCase();
  const items = state.inventory.filter((item) =>
    !query || inventoryMatchesQuery(item, query)
  );

  const weeklyPrompt = reviewInfo.due
    ? `
      <div class="weekly-review" role="status">
        <div>
          <strong>New week — check your inventory</strong>
          <span>${reviewInfo.previousItems.length} item${reviewInfo.previousItems.length === 1 ? "" : "s"} from ${weekLabel(reviewInfo.previousWeekStart)} may no longer be relevant. Clear them, or keep them if you replenished their stocks.</span>
        </div>
        <div class="weekly-review__actions">
          <button class="btn btn--primary btn--sm" type="button" data-weekly-clear>Clear previous week</button>
          <button class="btn btn--ghost btn--sm" type="button" data-weekly-keep>Keep — I replenished</button>
        </div>
      </div>`
    : "";

  const completionNotice = !reviewInfo.due && reviewInfo.reviewed
    ? `<p class="weekly-review__notice">Checked for this week — kept as replenished.</p>`
    : "";

  const head = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Ingredient inventory</h2>
        <p class="view__sub">${query ? `${items.length} of ${state.inventory.length}` : `${state.inventory.length} item${state.inventory.length === 1 ? "" : "s"}`} tracked · purchase dates are editable.</p>
      </div>
      <div class="view__actions">
        <button class="btn btn--primary btn--sm" type="button" data-add-inventory>Add ingredient</button>
      </div>
    </div>
    ${weeklyPrompt}
    ${completionNotice}
    <div class="search-bar">
      <label for="search-inventory" class="text-muted">Search</label>
      <input id="search-inventory" class="search-input" type="search" placeholder="Search ingredients, category or storage…"
             value="${escapeHtml(state.search?.inventory || "")}">
    </div>`;

  if (!state.inventory.length) {
    section.innerHTML = head + `
      <div class="empty">
        <h3>No ingredients yet</h3>
        <p>Add what is in your kitchen so the system knows what you can cook. You can record a purchase date with the date picker.</p>
        <button class="btn btn--primary" type="button" data-add-inventory>Add your first ingredient</button>
      </div>`;
  } else if (!items.length) {
    section.innerHTML = head + `<p class="text-muted">No inventory items match “${escapeHtml(state.search?.inventory || "")}”.</p>`;
  } else {
    const categoryCards = groupInventoryByCategory(items).map((group) => `
      <section class="inventory-category" data-inventory-category="${escapeHtml(group.key)}">
        <button class="inventory-category__toggle" type="button" aria-expanded="true">
          <span>${escapeHtml(group.label)}</span>
          <span class="inventory-category__count">${group.items.length}</span>
          <span class="inventory-category__chevron" aria-hidden="true">‹</span>
        </button>
        <div class="inventory-category__body">
          ${group.items.map((item) => {
      const exp = expiryInfo(item.expiration_date);
      return `
              <div class="inventory-item">
                <div class="inventory-item__main">
                  <strong>${escapeHtml(item.item_name)}</strong>
                  ${item.notes ? `<span class="text-muted">${escapeHtml(item.notes)}</span>` : ""}
                  <span class="inventory-item__meta">
                    ${item.quantity ?? "—"} ${escapeHtml(item.unit || "")}
                    · Purchased ${item.purchase_date ? fmtDate(item.purchase_date) : "—"}
                    · ${escapeHtml(item.storage_location || "—")}
                  </span>
                </div>
                <span class="badge badge--${exp.key}">${escapeHtml(exp.label)}</span>
                <div class="inventory-item__actions">
                  <button class="btn btn--ghost btn--sm" type="button" data-edit-inventory="${item.id}">Edit</button>
                  <button class="btn btn--danger btn--sm" type="button" data-delete-inventory="${item.id}">Delete</button>
                </div>
              </div>`;
    }).join("")}
        </div>
      </section>`).join("");

    section.innerHTML = head + `<div class="inventory-categories">${categoryCards}</div>`;
  }

  $$("[data-inventory-category]", section).forEach((category) => {
    const toggle = $(".inventory-category__toggle", category);
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const open = !category.classList.contains("is-collapsed");
      category.classList.toggle("is-collapsed", open);
      toggle.setAttribute("aria-expanded", String(!open));
    });
  });

  bindViewSearch(section, "inventory");

  const keepBtn = $("[data-weekly-keep]", section);
  if (keepBtn) {
    keepBtn.addEventListener("click", () => {
      saveWeeklyInventoryReview({
        userId: state.userId,
        weekStart: reviewInfo.weekStart,
        previousWeekStart: reviewInfo.previousWeekStart,
        checkedAt: new Date().toISOString(),
        action: "kept",
      });
      renderView();
      toast("Inventory kept as replenished for this week.");
    });
  }

  const clearBtn = $("[data-weekly-clear]", section);
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!window.confirm(`Clear ${reviewInfo.previousItems.length} inventory item${reviewInfo.previousItems.length === 1 ? "" : "s"} from ${weekLabel(reviewInfo.previousWeekStart)}?`)) return;
      clearBtn.disabled = true;
      try {
        await db.clearPreviousWeekInventory(state.userId, reviewInfo.weekStart);
        await refreshInventory();
        saveWeeklyInventoryReview({
          userId: state.userId,
          weekStart: reviewInfo.weekStart,
          previousWeekStart: reviewInfo.previousWeekStart,
          checkedAt: new Date().toISOString(),
          action: "cleared",
        });
        renderView();
        toast("Previous-week inventory cleared.");
      } catch (err) {
        toast(err.message);
        clearBtn.disabled = false;
      }
    });
  }

  $$("[data-add-inventory]", section).forEach((btn) => {
    btn.addEventListener("click", () => openInventoryDialog(null));
  });
  $$("[data-edit-inventory]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.inventory.find((i) => i.id === btn.dataset.editInventory);
      if (item) openInventoryDialog(item);
    });
  });
  $$("[data-delete-inventory]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Delete this ingredient?")) return;
      try {
        await db.deleteInventory(state.userId, btn.dataset.deleteInventory);
        await refreshInventory();
        renderView();
        toast("Ingredient deleted.");
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function openInventoryDialog(item) {
  const isEdit = !!item;
  const current = item || {};
  const options = (list, selected) => list
    .map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(capitalize(v))}</option>`)
    .join("");

  const categories = allInventoryCategories();
  if (current.category && !categories.some((c) => c.toLowerCase() === String(current.category).toLowerCase())) {
    categories.push(current.category);
  }

  const body = `
    <div class="meal-form">
      <!-- Section 1: Item & Category -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Item Identification</span>
          <span class="meal-form__card-sub">Name & kitchen classification</span>
        </header>

        <div class="field">
          <label for="inv-name">Ingredient Name</label>
          <input id="inv-name" name="item_name" class="meal-form__name-input" required placeholder="e.g. Garlic, Soy sauce, Chicken wings" value="${escapeHtml(current.item_name || "")}">
        </div>

        <div class="form-grid form-grid--2" style="margin-top:0.75rem">
          <div class="field">
            <label for="inv-category">Category</label>
            <div class="field-row">
              <select id="inv-category" name="category">
                <option value="">— Select Category —</option>
                ${options(categories, current.category || "")}
                <option value="__new__">＋ Create new category…</option>
              </select>
              <button class="btn btn--ghost btn--sm" type="button" data-new-cat>+ New</button>
            </div>
            <input id="inv-category-new" name="new_category" placeholder="Type new category" autocomplete="off" hidden style="margin-top:0.4rem">
          </div>

          <div class="field">
            <label for="inv-storage">Storage Location</label>
            <select id="inv-storage" name="storage_location">
              <option value="">— Select Location —</option>
              ${options(STORAGE, current.storage_location || "")}
            </select>
          </div>
        </div>
      </section>

      <!-- Section 2: Stock Quantity & Dates -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Stock & Expiry Tracking</span>
          <span class="meal-form__card-sub">Helps prioritize items before spoiling</span>
        </header>

        <div class="form-grid form-grid--2">
          <div class="metric-field">
            <label class="metric-field__label" for="inv-qty">
              <span class="metric-field__icon">⚖️</span>
              <span>Quantity</span>
            </label>
            <div class="metric-field__control">
              <input id="inv-qty" name="quantity" type="number" step="any" min="0" placeholder="0" value="${current.quantity ?? ""}">
            </div>
          </div>

          <div class="metric-field">
            <label class="metric-field__label" for="inv-unit">
              <span class="metric-field__icon">📏</span>
              <span>Unit of Measure</span>
            </label>
            <div class="metric-field__control">
              <input id="inv-unit" name="unit" placeholder="pcs, g, ml, bottle" value="${escapeHtml(current.unit || "")}">
            </div>
          </div>
        </div>

        <div class="form-grid form-grid--2" style="margin-top:0.75rem">
          <div class="field">
            <label for="inv-purchase">Purchase Date</label>
            <input id="inv-purchase" name="purchase_date" type="date" value="${toDateInput(current.purchase_date)}">
          </div>

          <div class="field">
            <label for="inv-expiry">Expiration / Best Before</label>
            <input id="inv-expiry" name="expiration_date" type="date" value="${toDateInput(current.expiration_date)}">
          </div>
        </div>
      </section>

      <!-- Section 3: Notes -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Additional Notes</span>
          <span class="meal-form__card-sub">Brand, condition or shelf details</span>
        </header>

        <div class="field">
          <label for="inv-notes">Notes</label>
          <textarea id="inv-notes" name="notes" rows="2" placeholder="e.g. In crisper drawer, opened yesterday">${escapeHtml(current.notes || "")}</textarea>
        </div>
      </section>
    </div>`;

  const dialog = openDialog({
    title: isEdit ? "Edit ingredient" : "Add ingredient",
    bodyHTML: body,
    submitLabel: isEdit ? "Save changes" : "Add ingredient",
    onSubmit: async (form, dialog) => {
      const select = form.querySelector('[name="category"]');
      const newInput = form.querySelector('[name="new_category"]');
      let chosen = select.value;
      if (chosen === "__new__" || (!newInput.hidden && newInput.value.trim())) {
        chosen = newInput.value.trim();
      }
      if (chosen) {
        const canonical = categories.find((c) => c.toLowerCase() === chosen.toLowerCase());
        chosen = canonical || chosen;
        rememberCategory(chosen);
      }

      const payload = {
        item_name: form.querySelector('[name="item_name"]').value.trim(),
        category: chosen,
        quantity: numOrNull(form.querySelector('[name="quantity"]').value),
        unit: form.querySelector('[name="unit"]').value.trim(),
        purchase_date: form.querySelector('[name="purchase_date"]').value || null,
        expiration_date: form.querySelector('[name="expiration_date"]').value || null,
        storage_location: form.querySelector('[name="storage_location"]').value,
        notes: form.querySelector('[name="notes"]').value.trim(),
      };
      if (!payload.item_name) { form.querySelector('[name="item_name"]').focus(); return; }

      if (isEdit) await db.updateInventory(state.userId, item.id, payload);
      else await db.addInventory(state.userId, payload);

      await refreshInventory();
      dialog.close(); dialog.remove();
      renderView();
      toast(isEdit ? "Ingredient updated." : "Ingredient added.");
    },
  });

  const select = $("#inv-category", dialog);
  const newInput = $("#inv-category-new", dialog);
  const revealNew = () => {
    newInput.hidden = false;
    select.value = "__new__";
    newInput.focus();
  };

  $("[data-new-cat]", dialog).addEventListener("click", revealNew);
  select.addEventListener("change", () => {
    if (select.value === "__new__") {
      newInput.hidden = false;
      newInput.focus();
    } else {
      newInput.hidden = true;
      newInput.value = "";
    }
  });
}

/* ==========================================================================
   Meal catalog view
   ========================================================================== */

function renderMeals(section) {
  const query = (state.search?.meals || "").toLowerCase();
  const meals = state.meals.filter((meal) => !query || mealMatchesQuery(meal, query));

  const head = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Meal catalog</h2>
        <p class="view__sub">${query ? `${meals.length} of ${state.meals.length}` : `${state.meals.length} dish${state.meals.length === 1 ? "" : "es"}`} · fully customized by you.</p>
      </div>
      <div class="view__actions">
        <button class="btn btn--primary btn--sm" type="button" data-add-meal>Add meal</button>
      </div>
    </div>
    <div class="search-bar">
      <label for="search-meals" class="text-muted">Search</label>
      <input id="search-meals" class="search-input" type="search" placeholder="Search dishes, ingredients or tags…"
             value="${escapeHtml(state.search?.meals || "")}">
    </div>`;

  if (!state.meals.length) {
    section.innerHTML = head + emptyCatalogHtml();
    bindFilipinoChips(section);
  } else if (!meals.length) {
    section.innerHTML = head + `<p class="text-muted">No dishes match “${escapeHtml(state.search?.meals || "")}”.</p>`;
  } else {
    const cards = meals.map((meal) => {
      const ings = asArray(meal.ingredients);
      const meta = [];
      const periods = mealPeriods(meal);
      const periodBadges = periods.length
        ? periods.map((p) => `<span class="period-badge period-badge--${p}">${capitalize(p)}</span>`).join(" ")
        : "";
      const totalTime = (Number(meal.prep_time_minutes) || 0) + (Number(meal.cook_time_minutes) || 0);
      if (totalTime) meta.push(`~${totalTime} min`);
      if (Number(meal.estimated_cost)) meta.push(money(meal.estimated_cost));

      return `
        <article class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
            <h3 class="card__title" style="margin:0">${escapeHtml(meal.name)}</h3>
            <div style="display:flex;gap:0.25rem;flex-wrap:wrap;justify-content:flex-end">${periodBadges}</div>
          </div>
          ${meta.length ? `<p class="card__meta" style="margin-top:0.35rem">${escapeHtml(meta.join(" · "))}</p>` : ""}
          <p class="small text-muted">
            ${ings.length ? "Ingredients: " + ings.map((i) => escapeHtml(i.name)).join(", ") : "No ingredients listed."}
          </p>
          <div class="card__row">
            <button class="btn btn--ghost btn--sm" type="button" data-edit-meal="${meal.id}">Edit</button>
            <button class="btn btn--danger btn--sm" type="button" data-delete-meal="${meal.id}">Delete</button>
          </div>
        </article>`;
    }).join("");

    section.innerHTML = head + `
      <div class="grid grid--2">${cards}</div>
      <div class="empty" style="margin-top:1rem">
        <h3>Add another dish</h3>
        <p>Pick a suggestion to start, or create your own from scratch.</p>
        <div class="chips">
          ${FILIPINO_DISHES.map((d) => `
            <button class="chip" type="button" data-dish-name="${escapeHtml(d.name)}" data-dish-period="${escapeHtml(d.period)}">
              ${escapeHtml(d.name)}
            </button>`).join("")}
        </div>
      </div>`;
    bindFilipinoChips(section);
  }

  bindViewSearch(section, "meals");
  $$("[data-add-meal]", section).forEach((btn) => {
    btn.addEventListener("click", () => openMealDialog(null));
  });
  $$("[data-edit-meal]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      const meal = state.meals.find((m) => m.id === btn.dataset.editMeal);
      if (meal) openMealDialog(meal);
    });
  });
  $$("[data-delete-meal]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Delete this meal from your catalog? Any plan slots using it will be emptied.")) return;
      try {
        await db.deleteMeal(state.userId, btn.dataset.deleteMeal);
        await Promise.all([refreshMeals(), refreshPlan()]);
        renderView();
        toast("Meal deleted.");
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function ingRowHtml(ing = {}) {
  return `
    <div class="ing-row">
      <label class="ing-row__main" title="Check if this is a primary/key ingredient">
        <input type="checkbox" data-ing="main" ${ing.main ? "checked" : ""} aria-label="Main ingredient">
        <span class="ing-row__star" aria-hidden="true">★</span>
      </label>
      <input class="ing-row__name" placeholder="e.g. Chicken breast" data-ing="name" value="${escapeHtml(ing.name || "")}">
      <input class="ing-row__qty" placeholder="Qty" type="number" step="any" min="0" data-ing="quantity" value="${ing.quantity ?? ""}">
      <input class="ing-row__unit" placeholder="Unit (g, tbsp)" data-ing="unit" value="${escapeHtml(ing.unit || "")}">
      <button type="button" class="ing-row__remove" data-remove-ing aria-label="Remove ingredient" title="Remove">&times;</button>
    </div>`;
}

function openMealDialog(meal, prefill) {
  const isEdit = !!meal;
  const current = { ...(meal || {}), ...(prefill || {}) };
  const ingredients = asArray(current.ingredients);
  const selectedPeriods = mealPeriods(current);
  const periodChecks = ["breakfast", "lunch", "dinner", "snack"]
    .map((p) => `<label class="period-pill-toggle period-pill-toggle--${p}">
        <input type="checkbox" name="meal_periods" value="${p}" ${selectedPeriods.includes(p) ? "checked" : ""}>
        <span class="period-pill-toggle__label">${capitalize(p)}</span>
      </label>`)
    .join("");

  const body = `
    <div class="meal-form">
      <!-- Section 1: Basic Information -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Dish Details</span>
          <span class="meal-form__card-sub">Name & meal periods</span>
        </header>

        <div class="field">
          <label for="meal-name">Dish Name</label>
          <input id="meal-name" name="name" class="meal-form__name-input" required placeholder="e.g. Chicken Adobo, Sinigang na Baboy" value="${escapeHtml(current.name || "")}">
        </div>

        <div class="field" style="margin-top:0.75rem">
          <label>Meal Periods <span class="field__hint">(select all that apply)</span></label>
          <div class="period-pills-wrap">${periodChecks}</div>
        </div>
      </section>

      <!-- Section 2: Metrics (Cost, Times) -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Estimates & Timing</span>
          <span class="meal-form__card-sub">Used for budget & scheduling support</span>
        </header>

        <div class="metrics-grid">
          <div class="metric-field">
            <label class="metric-field__label" for="meal-cost">
              <span class="metric-field__icon">💰</span>
              <span>Est. Cost</span>
            </label>
            <div class="metric-field__control">
              <span class="metric-field__affix">₱</span>
              <input id="meal-cost" name="estimated_cost" type="number" step="any" min="0" placeholder="0.00" value="${current.estimated_cost ?? ""}">
            </div>
          </div>

          <div class="metric-field">
            <label class="metric-field__label" for="meal-prep">
              <span class="metric-field__icon">🔪</span>
              <span>Prep Time</span>
            </label>
            <div class="metric-field__control">
              <input id="meal-prep" name="prep_time_minutes" type="number" min="0" placeholder="0" value="${current.prep_time_minutes ?? ""}">
              <span class="metric-field__affix metric-field__affix--suffix">min</span>
            </div>
          </div>

          <div class="metric-field">
            <label class="metric-field__label" for="meal-cook">
              <span class="metric-field__icon">🔥</span>
              <span>Cook Time</span>
            </label>
            <div class="metric-field__control">
              <input id="meal-cook" name="cook_time_minutes" type="number" min="0" placeholder="0" value="${current.cook_time_minutes ?? ""}">
              <span class="metric-field__affix metric-field__affix--suffix">min</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3: Required Ingredients -->
      <section class="meal-form__card ing-section">
        <header class="meal-form__card-head">
          <div>
            <span class="meal-form__card-title">Required Ingredients</span>
            <span class="meal-form__card-sub">Mark main ingredients with ★</span>
          </div>
        </header>

        <div class="ing-section__header-row">
          <span class="ing-col-lbl ing-col-lbl--main" title="Is this a primary ingredient?">Main</span>
          <span class="ing-col-lbl ing-col-lbl--name">Ingredient Name</span>
          <span class="ing-col-lbl ing-col-lbl--qty">Qty</span>
          <span class="ing-col-lbl ing-col-lbl--unit">Unit</span>
          <span class="ing-col-lbl ing-col-lbl--act"></span>
        </div>

        <div class="ing-rows" data-ing-rows>
          ${ingredients.length ? ingredients.map(ingRowHtml).join("") : ""}
        </div>
        ${ingredients.length ? "" : `<div class="ing-rows__empty" data-ing-empty>
          <span class="ing-rows__empty-icon">🍳</span>
          <span>No ingredients added yet. Click <strong>+ Add ingredient</strong> below to begin.</span>
        </div>`}

        <button type="button" class="ing-add-btn" data-add-ing>
          <span class="ing-add-btn__icon" aria-hidden="true">+</span>
          <span>Add ingredient</span>
        </button>
      </section>

      <!-- Section 4: Dietary & Nutrition -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Tags & Nutrition Notes</span>
          <span class="meal-form__card-sub">Preferences and dietary criteria</span>
        </header>

        <div class="field">
          <label for="meal-tags">Dietary Tags <span class="field__hint">(comma separated)</span></label>
          <input id="meal-tags" name="dietary_tags" placeholder="e.g. vegetarian, low-carb, dairy-free" value="${escapeHtml(asArray(current.dietary_tags).join(", "))}">
        </div>

        <div class="field" style="margin-top:0.75rem">
          <label for="meal-nutrition">Nutrition Notes</label>
          <textarea id="meal-nutrition" name="nutrition_notes" rows="2" placeholder="e.g. High protein, rich in iron, approx. 450 kcal">${escapeHtml(current.nutrition_notes || "")}</textarea>
        </div>
      </section>
    </div>`;

  const dialog = openDialog({
    title: isEdit ? "Edit meal" : "Add meal",
    bodyHTML: body,
    submitLabel: isEdit ? "Save changes" : "Add meal",
    onSubmit: async (form, dlg) => {
      const rows = $$("[data-ing-rows] .ing-row", dlg);
      const ingredientsPayload = rows.map((row) => ({
        name: row.querySelector('[data-ing="name"]').value.trim(),
        quantity: numOrNull(row.querySelector('[data-ing="quantity"]').value),
        unit: row.querySelector('[data-ing="unit"]').value.trim(),
        main: row.querySelector('[data-ing="main"]')?.checked || false,
      })).filter((ing) => ing.name);

      const payload = {
        name: form.querySelector('[name="name"]').value.trim(),
        meal_periods: $$('input[name="meal_periods"]:checked', form).map((cb) => cb.value),
        estimated_cost: numOrNull(form.querySelector('[name="estimated_cost"]').value),
        prep_time_minutes: numOrNull(form.querySelector('[name="prep_time_minutes"]').value),
        cook_time_minutes: numOrNull(form.querySelector('[name="cook_time_minutes"]').value),
        nutrition_notes: form.querySelector('[name="nutrition_notes"]').value.trim(),
        dietary_tags: parseList(form.querySelector('[name="dietary_tags"]').value),
        ingredients: ingredientsPayload,
      };
      if (!payload.name) { form.querySelector('[name="name"]').focus(); return; }

      if (isEdit) await db.updateMeal(state.userId, meal.id, payload);
      else await db.addMeal(state.userId, payload);

      await Promise.all([refreshMeals(), refreshPlan()]);
      dlg.close(); dlg.remove();
      renderView();
      toast(isEdit ? "Meal updated." : "Meal added to your catalog.");
    },
  });

  // Ingredient row controls
  const rowsWrap = $("[data-ing-rows]", dialog);
  const emptyNote = $("[data-ing-empty]", dialog);

  $("[data-add-ing]", dialog).addEventListener("click", () => {
    if (emptyNote) emptyNote.hidden = true;
    rowsWrap.insertAdjacentHTML("beforeend", ingRowHtml());
    const newRow = rowsWrap.lastElementChild;
    const nameInput = newRow ? newRow.querySelector('[data-ing="name"]') : null;
    if (nameInput) nameInput.focus();
    newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Pressing Enter in the last input row can quickly add another ingredient
  rowsWrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      const activeInput = event.target.closest("input");
      if (activeInput && activeInput.dataset.ing === "unit") {
        event.preventDefault();
        $("[data-add-ing]", dialog).click();
      }
    }
  });

  rowsWrap.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-ing]");
    if (removeBtn) removeBtn.closest(".ing-row").remove();
  });
}

/* ==========================================================================
   Weekly plan view
   ========================================================================== */

function planEntry(mealDate, period) {
  return state.plan.find(
    (p) => toDateInput(p.meal_date) === mealDate && p.meal_period === period
  );
}

/* ==========================================================================
   Export the displayed week as an image (canvas → PNG download)
   --------------------------------------------------------------------------
   Uses the same data renderPlan() reads from state.plan, so the image
   always matches what is on screen. Fully client-side (no new server
   endpoint), which keeps the PWA offline story intact.
   ========================================================================== */

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(" ");
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      lines++;
      if (lines >= maxLines) return;
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y);
}

async function exportPlanAsImage() {
  const start = state.planStart;

  // Canvas layout constants — 2x scale for a crisp screenshot.
  const SCALE = 2;
  const W = 880;
  const pad = 48;
  const dayH = 3 * 64 + 56; // 3 period slots under a day header
  const gap = 14;
  const H = pad * 2 + 76 + 7 * (dayH + gap); // + header row

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  // Background + header.
  ctx.fillStyle = "#f8fbf3";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2c3524";
  ctx.font = "800 30px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("MealPlan DSS — Weekly Meal Plan", pad, pad + 34);
  ctx.font = "500 17px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#5f6b52";
  ctx.fillText(weekLabel(start), pad, pad + 62);

  const periodColors = { breakfast: "#fef3c7", lunch: "#e7f3df", dinner: "#dbeafe" };
  const periodBorder = { breakfast: "#f59e0b", lunch: "#76a923", dinner: "#3b82f6" };

  let y = pad + 76;
  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const date = addDaysISO(start, dayIdx);
    const dayName = DAYS[dayIdx];
    const isToday = date === todayISO();

    // Day header row.
    ctx.fillStyle = isToday ? "#e9f3df" : "#ffffff";
    ctx.strokeStyle = "#dde7cf";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pad, y, W - pad * 2, 40, { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 });
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2c3524";
    ctx.font = "700 17px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(dayName, pad + 14, y + 27);
    ctx.fillStyle = "#5f6b52";
    ctx.font = "500 15px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(fmtDate(date), pad + 150, y + 27);
    y += 40;

    // Period slots.
    for (const period of PERIODS) {
      const entry = planEntry(date, period);
      const hasMeal = entry && entry.meal_id && entry.name;

      ctx.fillStyle = hasMeal ? periodColors[period] : "#ffffff";
      ctx.strokeStyle = hasMeal ? periodBorder[period] : "#dde7cf";
      ctx.beginPath();
      ctx.roundRect(pad + 14, y, W - pad * 2 - 28, 64, 6);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = hasMeal ? 2 : 1;

      ctx.fillStyle = "#5f6b52";
      ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(capitalize(period), pad + 26, y + 20);

      ctx.fillStyle = "#2c3524";
      ctx.font = "600 16px 'Segoe UI', system-ui, sans-serif";
      if (hasMeal) {
        drawWrappedText(
          ctx,
          entry.leftover_from
            ? `Leftovers from ${entry.leftover_from} — ${entry.name}`
            : entry.name,
          pad + 26, y + 44, W - pad * 2 - 52, 19, 1
        );
      } else {
        ctx.fillStyle = "#9aa888";
        ctx.fillText("—", pad + 26, y + 44);
      }

      y += 64;
    }
    y += gap;
  }

  // Actual download.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Canvas export failed.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mealplan-week-${start}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function renderPlan(section) {
  const start = state.planStart;
  const isCurrent = start === currentWeekStart();
  const isFuture = start > currentWeekStart();
  const atOldest = start <= HISTORY_START;
  const atNewest = start >= maxWeekStart();
  const planned = state.plan.filter((p) => p.meal_id && p.name).length;

  const head = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Weekly meal plan</h2>
        <p class="view__sub">${planned} meal${planned === 1 ? "" : "s"} planned · tap a slot to pick a meal.</p>
      </div>
      <div class="view__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-export-plan-image>
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4"/>
            <path d="M4 21h16a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1z"/>
          </svg>
          <span>Save as image</span>
        </button>
        <button class="btn btn--ghost btn--sm" type="button" data-bulk-fill>
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
          <span>Fill breakfast</span>
        </button>
        <button class="btn btn--ghost btn--sm" type="button" data-shift-week>
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>
          </svg>
          <span>Shift week</span>
        </button>
        <button class="btn btn--ghost btn--sm" type="button" data-copy-prev>
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="13" height="13" x="9" y="9" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy previous week</span>
        </button>
        ${planned ? `<button class="btn btn--danger btn--sm" type="button" data-clear-plan>
          <svg class="btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>
          </svg>
          <span>Clear week</span>
        </button>` : ""}
      </div>
    </div>
    <div class="week-nav">
      <button class="btn btn--ghost btn--sm" type="button" data-nav="-1" ${atOldest ? "disabled" : ""}>‹ Prev</button>
      <div class="week-nav__label">
        <strong>${weekLabel(start)}</strong>
        ${isCurrent
      ? `<span class="week-nav__badge">This week</span>`
      : `${isFuture ? `<span class="week-nav__badge">Upcoming</span>` : ""}<button class="link-btn" type="button" data-today>Jump to this week</button>`}
      </div>
      <button class="btn btn--ghost btn--sm" type="button" data-nav="1" ${atNewest ? "disabled" : ""}>Next ›</button>
    </div>`;

  const days = DAYS.map((dayName, index) => {
    const date = addDaysISO(start, index);
    const isToday = date === todayISO();

    const slots = PERIODS.map((period) => {
      const entry = planEntry(date, period);
      const hasMeal = entry && entry.meal_id && entry.name;
      const isLeftover = hasMeal && Boolean(entry.leftover_from);
      const note = !hasMeal
        ? ""
        : isLeftover
          ? `Leftovers from ${capitalize(entry.leftover_from)}`
          : [entry.prep_time_minutes || entry.cook_time_minutes
            ? `~${(Number(entry.prep_time_minutes) || 0) + (Number(entry.cook_time_minutes) || 0)} min`
            : "", Number(entry.estimated_cost) ? money(entry.estimated_cost) : ""]
            .filter(Boolean).join(" · ") || "Tap to change";

      // Offer a one-click leftover shortcut when an earlier slot has a meal.
      const earlierMeals = PERIODS.slice(0, PERIODS.indexOf(period))
        .map((p) => planEntry(date, p))
        .filter((e) => e && e.meal_id && e.name);
      const leftoverSource = earlierMeals.length ? earlierMeals[earlierMeals.length - 1] : null;
      const showLeftover = leftoverSource &&
        !(hasMeal && entry.leftover_from === leftoverSource.meal_period);
      const leftoverShortcut = showLeftover
        ? `<button class="plan__leftover" type="button" data-leftover-slot="${date}|${period}|${leftoverSource.meal_period}">Use ${capitalize(leftoverSource.meal_period)} leftovers</button>`
        : "";

      const periodClass = `plan__slot--${period}`;
      const mealPeriodClass = `plan__meal--${period}`;

      const cell = hasMeal
        ? `<button class="plan__meal ${mealPeriodClass} ${isLeftover ? "plan__meal--leftover" : ""}" type="button" data-slot="${date}|${period}">
             <span class="plan__meal-title">${escapeHtml(entry.name)}</span>
             <span class="plan__meal-meta">${escapeHtml(note)}</span>
           </button>
           ${leftoverShortcut}`
        : `<button class="plan__empty" type="button" data-slot="${date}|${period}">
             <span class="plan__empty-plus">+</span>
             <span>Add meal</span>
           </button>
           ${leftoverShortcut}`;

      return `
        <div class="plan__slot ${periodClass}">
          <div class="plan__slot-label">${capitalize(period)}</div>
          ${cell}
        </div>`;
    }).join("");

    return `<div class="plan__day ${isToday ? "is-today" : ""}">
      <header class="plan__day-header">
        <span class="plan__day-name">${dayName}</span>
        <span class="plan__day-date">${fmtDate(date)}</span>
      </header>
      <div class="plan__day-slots">${slots}</div>
    </div>`;
  }).join("");

  section.innerHTML = head + `<div class="plan">${days}</div>`;

  $$("[data-nav]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      goToPlanWeek(addDaysISO(start, Number(btn.dataset.nav) * 7));
    });
  });
  const todayBtn = $("[data-today]", section);
  if (todayBtn) todayBtn.addEventListener("click", () => goToPlanWeek(todayISO()));

  $$("[data-slot]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      const [date, period] = btn.dataset.slot.split("|");
      openMealPicker(date, period);
    });
  });
  $$("[data-leftover-slot]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [date, period, src] = btn.dataset.leftoverSlot.split("|");
      const source = planEntry(date, src);
      if (!source || !source.meal_id) return;
      btn.disabled = true;
      try {
        await db.assignMeal(state.userId, date, period, source.meal_id, src);
        await refreshPlan();
        renderView();
        toast(`${capitalize(period)} set to leftovers from ${capitalize(src)}.`);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  });

  $("[data-bulk-fill]", section).addEventListener("click", openBulkFillDialog);
  $("[data-export-plan-image]", section).addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      await exportPlanAsImage();
      toast("Week image saved.");
    } catch (err) {
      console.error(err);
      toast("Could not create the image: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });
  $("[data-shift-week]", section).addEventListener("click", openShiftWeekDialog);
  $("[data-copy-prev]", section).addEventListener("click", copyPreviousWeek);

  const clearBtn = $("[data-clear-plan]", section);
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!window.confirm(`Clear ${planned} planned meal${planned === 1 ? "" : "s"} in ${weekLabel(start)}?`)) return;
      clearBtn.disabled = true;
      try {
        await db.clearPlanWeek(state.userId, start, addDaysISO(start, 6));
        await refreshPlan();
        renderView();
        toast("Week cleared.");
      } catch (err) {
        toast(err.message);
        clearBtn.disabled = false;
      }
    });
  }
}

function openMealPicker(mealDate, period) {  const current = planEntry(mealDate, period);
  const ranked = rankMeals(state.meals, state.inventory, state.profile, state.plan);
  const matching = ranked.filter((r) => mealPeriods(r.meal).includes(period));
  const others = ranked.filter((r) => !mealPeriods(r.meal).includes(period));
  const ordered = [...matching, ...others];

  // Any earlier period on the same date with a planned meal can be eaten as
  // leftovers in this slot (e.g. lunch leftovers at dinner).
  const leftoverSources = PERIODS
    .slice(0, PERIODS.indexOf(period))
    .map((p) => ({ period: p, entry: planEntry(mealDate, p) }))
    .filter(({ entry }) => entry && entry.meal_id && entry.name);

  const leftoverNotice = current && current.leftover_from
    ? `<p class="small text-muted">This slot currently uses leftovers from ${capitalize(current.leftover_from)}.</p>`
    : "";

  const leftoverOptions = leftoverSources.length
    ? `<div class="leftover-box">
        <div class="small text-muted">Eating leftovers?</div>
        ${leftoverSources.map(({ period: src, entry }) => `
          <button class="leftover-option" type="button" data-leftover="${src}" data-meal="${entry.meal_id}">
            <span>Use leftovers from ${capitalize(src)}</span>
            <small>${escapeHtml(entry.name)}</small>
          </button>`).join("")}
      </div>`
    : "";

  const periodIndex = PERIODS.indexOf(period);
  const leftoverHint = periodIndex > 0 && !leftoverSources.length
    ? `<p class="small text-muted">To eat leftovers here, plan a meal in an earlier slot on this date first (e.g. ${capitalize(PERIODS[periodIndex - 1])}).</p>`
    : "";

  const list = ordered.length
    ? ordered.map((r) => {
      const periods = mealPeriods(r.meal);
      const usually = periods.length && !periods.includes(period)
        ? ` · usually ${periods.map(capitalize).join(" / ")}`
        : "";
      const periodBadges = periods.length
        ? periods.map((p) => `<span class="period-badge period-badge--${p}">${capitalize(p)}</span>`).join(" ")
        : "";
      return `
        <div class="shop-item" style="align-items:flex-start">
          <div class="shop-item__label">
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
              <strong>${escapeHtml(r.meal.name)}</strong>
              <span class="suggest__score">${Math.round(r.score * 100)}%</span>
              ${periodBadges}
            </div>
            <div class="small text-muted" style="margin-top:0.25rem">${escapeHtml(r.reasons[0] || "")}</div>
          </div>
          <button class="btn btn--primary btn--sm" type="button" data-assign="${r.meal.id}">Assign</button>
        </div>`;
    }).join("")
    : `<p class="text-muted">Your meal catalog is empty. Add meals first.</p>`;

  const moveBtn = current && current.meal_id
    ? `<button class="btn btn--ghost btn--sm" type="button" data-move-current>Move to another date</button>`
    : "";
  const removeBtn = current && current.meal_id
    ? `<button class="btn btn--danger btn--sm" type="button" data-remove-current>Remove current meal</button>`
    : "";

  const { dialog, close } = openPanel({
    title: "Pick a meal",
    bodyHTML: `<div class="stack">${leftoverNotice}${leftoverOptions}${leftoverHint}${list}</div>
      <div class="stack-h" style="margin-top:1rem">${moveBtn}${removeBtn}</div>`,
  });

  $$("[data-leftover]", dialog).forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await db.assignMeal(
          state.userId, mealDate, period, btn.dataset.meal, btn.dataset.leftover
        );
        await refreshPlan();
        close();
        renderView();
        toast(`${capitalize(period)} set to leftovers from ${capitalize(btn.dataset.leftover)}.`);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  });

  $$("[data-assign]", dialog).forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await db.assignMeal(state.userId, mealDate, period, btn.dataset.assign);
        await refreshPlan();
        close();
        renderView();
        toast("Meal added to your plan.");
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  });

  const move = $("[data-move-current]", dialog);
  if (move) {
    move.addEventListener("click", () => {
      close();
      openMoveDialog(mealDate, period);
    });
  }

  const remove = $("[data-remove-current]", dialog);
  if (remove) {
    remove.addEventListener("click", async () => {
      try {
        await db.removeMeal(state.userId, mealDate, period);
        await refreshPlan();
        close();
        renderView();
        toast("Meal removed.");
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

function openMoveDialog(mealDate, period) {
  const maxDate = maxPlanDate();
  openDialog({
    title: `Move ${capitalize(period)} · ${fmtDate(mealDate)}`,
    submitLabel: "Move meal",
    bodyHTML: `
      <div class="field">
        <label for="move-date">New date</label>
        <input id="move-date" name="date" type="date"
               value="${mealDate}" min="${HISTORY_START}" max="${maxDate}" required>
      </div>
      <p class="small text-muted">If a meal already exists on the target date and period, it will be replaced.</p>`,
    onSubmit: async (form, dialog) => {
      const toDate = form.querySelector('[name="date"]').value;
      if (!toDate) return;
      await db.moveMeal(state.userId, mealDate, period, toDate);
      await refreshPlan();
      dialog.close(); dialog.remove();
      renderView();
      toast(`Moved to ${fmtDate(toDate)}.`);
    },
  });
}

function openShiftWeekDialog() {
  const start = state.planStart;
  const maxDate = maxPlanDate();
  const suggested = clampWeekStart(addDaysISO(start, 7));
  openDialog({
    title: "Shift whole week",
    submitLabel: "Shift week",
    bodyHTML: `
      <p class="small text-muted">Every meal in ${weekLabel(start)} moves by the same number of days to the week you pick.</p>
      <div class="field">
        <label for="shift-date">Move the week to start on</label>
        <input id="shift-date" name="date" type="date" value="${suggested}"
               min="${HISTORY_START}" max="${maxDate}" required>
      </div>`,
    onSubmit: async (form, dialog) => {
      const picked = form.querySelector('[name="date"]').value;
      if (!picked) return;
      const target = clampWeekStart(picked);
      if (target === start) {
        toast("Pick a different week to shift to.");
        return;
      }
      const moved = await db.shiftWeek(state.userId, start, target);
      dialog.close(); dialog.remove();
      await goToPlanWeek(target);
      toast(moved ? `Shifted ${moved} meal${moved === 1 ? "" : "s"}.` : "Nothing to shift.");
    },
  });
}

function openBulkFillDialog() {
  if (!state.meals.length) {
    toast("Add meals to your catalog first.");
    return;
  }
  const start = state.planStart;
  const defaultMeal = state.meals.find(
    (m) => normalizeName(m.name) === normalizeName("Scrambled Eggs")
  );
  const options = state.meals.map((m) => `
    <option value="${m.id}" ${defaultMeal && m.id === defaultMeal.id ? "selected" : ""}>${escapeHtml(m.name)}</option>
  `).join("");

  openDialog({
    title: `Fill a meal for the week of ${fmtDate(start)}`,
    submitLabel: "Fill week",
    bodyHTML: `
      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="fill-period">Meal period</label>
          <select id="fill-period" name="period">
            ${PERIODS.map((p) => `<option value="${p}" ${p === "breakfast" ? "selected" : ""}>${capitalize(p)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="fill-meal">Meal</label>
          <select id="fill-meal" name="meal">${options}</select>
        </div>
      </div>
      <label class="check-row" style="margin-top:0.75rem">
        <input type="checkbox" name="overwrite"> Also replace meals already planned in that period
      </label>`,
    onSubmit: async (form, dialog) => {
      const period = form.querySelector('[name="period"]').value;
      const mealId = form.querySelector('[name="meal"]').value;
      const overwrite = form.querySelector('[name="overwrite"]').checked;
      await db.bulkFillPeriod(state.userId, period, mealId, start, addDaysISO(start, 6), overwrite);
      await refreshPlan();
      dialog.close(); dialog.remove();
      renderView();
      toast(`Filled ${period} for the week.`);
    },
  });
}

async function copyPreviousWeek() {
  const prevStart = addDaysISO(state.planStart, -7);
  if (prevStart < HISTORY_START) {
    toast("No earlier week to copy from.");
    return;
  }
  try {
    const prev = await db.getPlanForRange(state.userId, prevStart, addDaysISO(prevStart, 6));
    const meals = prev.filter((p) => p.meal_id);
    if (!meals.length) {
      toast("The previous week has no planned meals.");
      return;
    }
    for (const entry of meals) {
      const newDate = addDaysISO(toDateInput(entry.meal_date), 7);
      await db.assignMeal(
        state.userId, newDate, entry.meal_period, entry.meal_id,
        entry.leftover_from || null
      );
    }
    await refreshPlan();
    renderView();
    toast(`Copied ${meals.length} meal${meals.length === 1 ? "" : "s"} from last week.`);
  } catch (err) {
    toast(err.message);
  }
}

function openAssignDialog(meal) {
  const defaultPeriod = mealPeriods(meal)[0] || "";
  openDialog({
    title: `Add "${meal.name}" to your plan`,
    submitLabel: "Add to plan",
    bodyHTML: `
      <div class="form-grid form-grid--2">
        <div class="field">
          <label for="assign-date">Date</label>
          <input id="assign-date" name="date" type="date"
                 value="${state.planStart === currentWeekStart() ? todayISO() : state.planStart}"
                 min="${HISTORY_START}" max="${maxPlanDate()}" required>
        </div>
        <div class="field">
          <label for="assign-period">Meal period</label>
          <select id="assign-period" name="period">
            ${PERIODS.map((p) => `<option value="${p}" ${p === defaultPeriod ? "selected" : ""}>${capitalize(p)}</option>`).join("")}
          </select>
        </div>
      </div>`,
    onSubmit: async (form, dialog) => {
      const date = form.querySelector('[name="date"]').value;
      const period = form.querySelector('[name="period"]').value;
      if (!date) return;
      await db.assignMeal(state.userId, date, period, meal.id);
      await refreshPlan();
      dialog.close(); dialog.remove();
      renderView();
      toast(`Added to ${fmtDate(date)} · ${period}.`);
    },
  });
}

/* ==========================================================================
   Shopping list view
   ========================================================================== */

function shoppingCategoryKey(item) {
  const category = String(item?.category || "").trim();
  return category ? category.toLowerCase() : "\\0other";
}

function shoppingCategoryLabel(key) {
  return key === "\\0other" ? "Other" : capitalize(key);
}

function groupShoppingByCategory(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = shoppingCategoryKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const orderedKeys = SHOPPING_CATEGORIES
    .map((category) => category.toLowerCase())
    .filter((key) => groups.has(key));
  [...groups.keys()].forEach((key) => {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });

  return orderedKeys.map((key) => ({
    key,
    label: shoppingCategoryLabel(key),
    items: [...groups.get(key)].sort((a, b) =>
      (a.purchased ? 1 : 0) - (b.purchased ? 1 : 0) ||
      String(a.ingredient_name).localeCompare(String(b.ingredient_name))
    ),
  }));
}

function renderShopping(section) {
  const start = state.shoppingDate;
  const isCurrent = start === currentWeekStart();
  const isFuture = start > currentWeekStart();
  const atOldest = start <= HISTORY_START;
  const atNewest = start >= maxWeekStart();
  const pending = state.shopping.filter((s) => !s.purchased);
  const done = state.shopping.filter((s) => s.purchased);

  const quickEntry = `
    <form class="shop-note" data-quick-add>
      <label class="visually-hidden" for="shop-note-item">Add item</label>
      <input id="shop-note-item" name="ingredient_name" required autocomplete="off"
             placeholder="Add item… (e.g. 2 packs biscuits)">
      <button class="btn btn--primary" type="submit">Add</button>
    </form>`;

  const quickStatus = `<p class="shop-note__hint">Press Enter to add a new note. Import CSV or add advanced details when needed.</p>`;

  const head = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Shopping list</h2>
        <p class="view__sub">${pending.length} to buy · ${done.length} purchased</p>
      </div>
      <div class="view__actions">
        <button class="btn btn--primary btn--sm" type="button" data-import>Import CSV</button>
        <button class="btn btn--ghost btn--sm" type="button" data-transfer-inventory" ${pending.length ? "" : "disabled"}>Transfer to inventory</button>
        ${state.shopping.length ? `<button class="btn btn--danger btn--sm" type="button" data-clear>Clear week</button>` : ""}
      </div>
    </div>
    <div class="week-nav">
      <button class="btn btn--ghost btn--sm" type="button" data-shop-nav="-1" ${atOldest ? "disabled" : ""}>‹ Prev</button>
      <div class="week-nav__label">
        <strong>${weekLabel(start)}</strong>
        ${isCurrent
      ? `<span class="week-nav__badge">This week</span>`
      : `${isFuture ? `<span class="week-nav__badge">Upcoming</span>` : ""}<button class="link-btn" type="button" data-shop-today>Jump to this week</button>`}
      </div>
      <button class="btn btn--ghost btn--sm" type="button" data-shop-nav="1" ${atNewest ? "disabled" : ""}>Next ›</button>
    </div>
    ${quickEntry}
    ${quickStatus}`;

  if (!state.shopping.length) {
    section.innerHTML = head + `
      <div class="empty">
        <h3>Nothing on this week's list</h3>
        <p>Add items with the note above, import a grocery-list CSV, or use the item dialog for quantities and categories.</p>
        <div class="stack-h">
          <button class="btn btn--primary" type="button" data-import>Import CSV</button>
          <button class="btn btn--ghost" type="button" data-add-item>Add item</button>
        </div>
      </div>`;
  } else {
    const itemHtml = (item) => `
      <div class="shop-item ${item.purchased ? "is-done" : ""}">
        <input type="checkbox" ${item.purchased ? "checked" : ""} data-toggle="${item.id}" aria-label="Mark purchased">
        <div class="shop-item__label">
          ${escapeHtml(item.ingredient_name)}
          ${item.quantity != null ? `<small> · ${item.quantity} ${escapeHtml(item.unit || "")}</small>` : ""}
        </div>
        <div class="shop-item__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-edit-item="${item.id}">Edit</button>
          <button class="btn btn--ghost btn--sm" type="button" data-add-inventory-from="${item.id}">To inventory</button>
          <button class="btn btn--danger btn--sm" type="button" data-delete-shop="${item.id}">Delete</button>
        </div>
      </div>`;

    const body = `<div class="shopping-checklist">${groupShoppingByCategory(state.shopping).map((group) => {
      const left = group.items.filter((i) => !i.purchased).length;
      return `<section class="shop-group">
        <h3 class="shop-group__title">${escapeHtml(group.label)}<span>${left}/${group.items.length} left</span></h3>
        ${group.items.map(itemHtml).join("")}
      </section>`;
    }).join("")}</div>`;

    section.innerHTML = head + body;
  }

  $$("[data-shop-nav]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      goToShoppingWeek(addDaysISO(start, Number(btn.dataset.shopNav) * 7));
    });
  });
  const todayBtn = $("[data-shop-today]", section);
  if (todayBtn) todayBtn.addEventListener("click", () => goToShoppingWeek(todayISO()));

  $$("[data-import]", section).forEach((btn) => btn.addEventListener("click", openImportDialog));
  $$("[data-add-item]", section).forEach((btn) => btn.addEventListener("click", () => openShoppingItemDialog(null)));

  const quickForm = $("[data-quick-add]", section);
  if (quickForm) {
    quickForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = quickForm.querySelector("[name='ingredient_name']");
      const value = input.value.trim();
      if (!value) return;
      try {
        await db.addShoppingItem(state.userId, state.shoppingDate, {
          ingredient_name: value,
          category: "Other",
          quantity: null,
          unit: "",
          purchased: false,
        });
        await refreshShopping();
        renderView();
        const nextInput = $("[data-quick-add] [name='ingredient_name']", section);
        if (nextInput) nextInput.focus();
        toast("Item added.");
      } catch (err) {
        toast(err.message);
      }
    });
  }

  $$("[data-edit-item]", section).forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.shopping.find((s) => String(s.id) === btn.dataset.editItem);
      if (item) openShoppingItemDialog(item);
    });
  });

  $$("[data-clear]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm(`Clear the shopping list for ${weekLabel(start)}?`)) return;
      try {
        await db.clearShoppingDate(state.userId, start);
        await refreshShopping();
        renderView();
        toast("Week cleared.");
      } catch (err) { toast(err.message); }
    });
  });

  $$("[data-toggle]", section).forEach((box) => {
    box.addEventListener("change", async () => {
      try {
        await db.setShoppingPurchased(state.userId, box.dataset.toggle, box.checked);
        await refreshShopping();
        renderView();
      } catch (err) { toast(err.message); }
    });
  });

  $$("[data-delete-shop]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await db.deleteShopping(state.userId, btn.dataset.deleteShop);
        await refreshShopping();
        renderView();
      } catch (err) { toast(err.message); }
    });
  });

  $$("[data-add-inventory-from]", section).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = state.shopping.find((s) => String(s.id) === btn.dataset.addInventoryFrom);
      if (!item) return;
      try {
        await db.addInventory(state.userId, {
          item_name: item.ingredient_name,
          category: item.category || null,
          quantity: item.quantity,
          unit: item.unit,
          purchase_date: todayISO(),
        });
        await db.deleteShopping(state.userId, item.id);
        await Promise.all([refreshInventory(), refreshShopping()]);
        renderView();
        toast("Added to inventory.");
      } catch (err) { toast(err.message); }
    });
  });

  const transferBtn = $("[data-transfer-inventory]", section);
  if (transferBtn) {
    transferBtn.addEventListener("click", async () => {
      const items = state.shopping.filter((item) => !item.purchased);
      if (!items.length) return;
      if (!window.confirm(`Transfer ${items.length} unchecked item${items.length === 1 ? "" : "s"} to inventory?`)) return;
      transferBtn.disabled = true;
      try {
        for (const item of items) {
          await db.addInventory(state.userId, {
            item_name: item.ingredient_name,
            category: item.category || null,
            quantity: item.quantity,
            unit: item.unit,
            purchase_date: todayISO(),
          });
        }
        await Promise.all(items.map((item) => db.deleteShopping(state.userId, item.id)));
        await Promise.all([refreshInventory(), refreshShopping()]);
        renderView();
        toast(`${items.length} item${items.length === 1 ? "" : "s"} transferred to inventory.`);
      } catch (err) {
        toast(err.message);
        transferBtn.disabled = false;
      }
    });
  }
}

function openShoppingItemDialog(item) {
  const isEdit = Boolean(item);
  const category = item?.category || "Food";
  openDialog({
    title: isEdit ? "Edit shopping item" : "Add shopping item",
    submitLabel: isEdit ? "Save item" : "Add to list",
    bodyHTML: `
      <div class="meal-form">
        <!-- Section 1: Item & Category -->
        <section class="meal-form__card">
          <header class="meal-form__card-head">
            <span class="meal-form__card-title">Item Details</span>
            <span class="meal-form__card-sub">Grocery item & aisle</span>
          </header>

          <div class="field">
            <label for="shop-name">Item Name</label>
            <input id="shop-name" name="ingredient_name" class="meal-form__name-input" required
                   value="${escapeHtml(item?.ingredient_name || "")}" placeholder="e.g. Eggs, White onion, Olive oil">
          </div>

          <div class="field" style="margin-top:0.75rem">
            <label for="shop-cat">Category / Department</label>
            <select id="shop-cat" name="category">
              ${SHOPPING_CATEGORIES.map((c) => `<option value="${c}" ${c === category ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
        </section>

        <!-- Section 2: Quantity & Status -->
        <section class="meal-form__card">
          <header class="meal-form__card-head">
            <span class="meal-form__card-title">Quantity & Purchase Status</span>
            <span class="meal-form__card-sub">Specify amount needed</span>
          </header>

          <div class="form-grid form-grid--2">
            <div class="metric-field">
              <label class="metric-field__label" for="shop-qty">
                <span class="metric-field__icon">🔢</span>
                <span>Quantity</span>
              </label>
              <div class="metric-field__control">
                <input id="shop-qty" name="quantity" type="number" step="any" min="0" placeholder="0"
                       value="${item?.quantity ?? ""}">
              </div>
            </div>

            <div class="metric-field">
              <label class="metric-field__label" for="shop-unit">
                <span class="metric-field__icon">📦</span>
                <span>Unit</span>
              </label>
              <div class="metric-field__control">
                <input id="shop-unit" name="unit" value="${escapeHtml(item?.unit || "")}" placeholder="pack, kg, tray">
              </div>
            </div>
          </div>

          <div style="margin-top:0.85rem;padding-top:0.75rem;border-top:1px solid var(--border)">
            <label class="check-row">
              <input type="checkbox" name="purchased" ${item?.purchased ? "checked" : ""}>
              <span>Already purchased / in cart</span>
            </label>
          </div>
        </section>
      </div>`,
    onSubmit: async (form, dialog) => {
      const payload = {
        ingredient_name: form.querySelector('[name="ingredient_name"]').value.trim(),
        quantity: numOrNull(form.querySelector('[name="quantity"]').value),
        unit: form.querySelector('[name="unit"]').value.trim(),
        category: form.querySelector('[name="category"]').value,
        purchased: form.querySelector('[name="purchased"]').checked,
      };
      if (!payload.ingredient_name) return;
      if (isEdit) {
        await db.updateShoppingItem(state.userId, item.id, payload);
      } else {
        await db.addShoppingItem(state.userId, state.shoppingDate, payload);
      }
      await refreshShopping();
      dialog.close(); dialog.remove();
      renderView();
      toast(isEdit ? "Item updated." : "Item added.");
    },
  });
}

function openImportDialog() {
  const date = state.shoppingDate;
  let dialog;
  let textarea;
  let preview;

  dialog = openDialog({
    title: `Import grocery CSV · week of ${fmtDate(date)}`,
    submitLabel: "Import items",
    bodyHTML: `
      <div class="field">
        <label for="csv-file">Choose a CSV file (optional)</label>
        <input id="csv-file" type="file" accept=".csv,text/csv">
      </div>
      <div class="field">
        <label for="csv-text">…or paste the CSV contents</label>
        <textarea id="csv-text" rows="8" placeholder="Quantity,Food,,Quantity,Condiment,,Quantity,Ingredient&#10;18,Eggs,,1,Soy Sauce,,4,Onions"></textarea>
      </div>
      <div class="import-preview" data-preview hidden></div>
      <div class="stack-h" style="margin-top:0.5rem">
        <button class="btn btn--ghost btn--sm" type="button" data-preview-btn>Preview</button>
      </div>
      <label class="check-row" style="margin-top:0.75rem">
        <input type="checkbox" name="replace" checked> Replace items already on this week's list
      </label>
      <p class="small text-muted">Imported items are marked as purchased so they become history.</p>`,
    onSubmit: async (form) => {
      const { items } = parseGroceryCsv(textarea.value);
      if (!items.length) {
        toast("No items to import.");
        return;
      }
      if (form.querySelector('[name="replace"]').checked) {
        await db.clearShoppingDate(state.userId, date);
      }
      for (const entry of items) {
        await db.addShoppingItem(state.userId, date, { ...entry, purchased: true });
      }
      await refreshShopping();
      dialog.close();
      dialog.remove();
      renderView();
      toast(`Imported ${items.length} items.`);
    },
  });

  textarea = $("#csv-text", dialog);
  preview = $("[data-preview]", dialog);

  const showPreview = () => {
    const { items, errors } = parseGroceryCsv(textarea.value);
    if (!textarea.value.trim()) {
      preview.hidden = true;
      return;
    }
    const counts = {};
    items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ");
    preview.hidden = false;
    preview.innerHTML = items.length
      ? `<strong>${items.length} items found</strong><div class="small text-muted">${summary}</div>
         <ul class="import-list">${items.map((i) => `<li>${escapeHtml(i.ingredient_name)}${i.quantity != null ? ` · ${i.quantity}${i.unit ? " " + escapeHtml(i.unit) : ""}` : ""}</li>`).join("")}</ul>`
      : `<span class="text-muted">No items recognised.</span>`;
    if (errors.length) {
      preview.innerHTML += `<div class="small" style="color:#b91c1c">${errors.map(escapeHtml).join("<br>")}</div>`;
    }
  };

  $("#csv-file", dialog).addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result || "");
      showPreview();
    };
    reader.readAsText(file);
  });

  $("[data-preview-btn]", dialog).addEventListener("click", showPreview);
}

/* ==========================================================================
   Preferences view
   ========================================================================== */

function renderPreferences(section) {
  const p = state.profile || {};
  section.innerHTML = `
    <div class="view__head">
      <div>
        <h2 class="view__title">Preferences</h2>
        <p class="view__sub">Fine-tune the algorithm and constraints that shape your weekly meal recommendations.</p>
      </div>
    </div>

    <form class="meal-form" data-preferences style="max-width:760px">
      <!-- Section 1: Budget & Time Dials -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Budget & Cooking Limits</span>
          <span class="meal-form__card-sub">Guides meal affordability & recipe selection</span>
        </header>

        <div class="form-grid form-grid--2">
          <div class="metric-field">
            <label class="metric-field__label" for="pref-budget">
              <span class="metric-field__icon">💰</span>
              <span>Weekly Budget</span>
            </label>
            <div class="metric-field__control">
              <span class="metric-field__affix">₱</span>
              <input id="pref-budget" name="budget" type="number" step="any" min="0" placeholder="0.00" value="${p.budget ?? ""}">
            </div>
          </div>

          <div class="metric-field">
            <label class="metric-field__label" for="pref-time">
              <span class="metric-field__icon">⏱️</span>
              <span>Max Cook Time per Meal</span>
            </label>
            <div class="metric-field__control">
              <input id="pref-time" name="max_cook_time_minutes" type="number" min="0" placeholder="e.g. 45" value="${p.max_cook_time_minutes ?? ""}">
              <span class="metric-field__affix metric-field__affix--suffix">min</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 2: Dietary Guidelines -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Dietary Rules & Exclusions</span>
          <span class="meal-form__card-sub">Meals with these values will be filtered or flagged</span>
        </header>

        <div class="field">
          <label for="pref-diet">Dietary Preferences / Restrictions <span class="field__hint">(comma separated)</span></label>
          <input id="pref-diet" name="dietary_preferences" placeholder="e.g. vegetarian, low-carb, no pork, pescatarian" value="${escapeHtml(asArray(p.dietary_preferences).join(", "))}">
        </div>

        <div class="field" style="margin-top:0.75rem">
          <label for="pref-dislikes">Disliked Ingredients <span class="field__hint">(comma separated)</span></label>
          <input id="pref-dislikes" name="disliked_ingredients" placeholder="e.g. cilantro, liver, bitter melon" value="${escapeHtml(asArray(p.disliked_ingredients).join(", "))}">
        </div>
      </section>

      <!-- Section 3: Recommendation Behavior -->
      <section class="meal-form__card">
        <header class="meal-form__card-head">
          <span class="meal-form__card-title">Recommendation Behavior</span>
          <span class="meal-form__card-sub">Variety balance for the planner</span>
        </header>

        <div class="field">
          <label for="pref-variety">Preferred Meal Variety</label>
          <select id="pref-variety" name="meal_variety">
            ${["low", "balanced", "high"].map((v) => `<option value="${v}" ${(p.meal_variety || "balanced") === v ? "selected" : ""}>${capitalize(v)} variety</option>`).join("")}
          </select>
          <span class="field__hint" style="margin-top:0.3rem">"Balanced" rotates meats and dish styles; "High" avoids repeating main ingredients across consecutive days.</span>
        </div>
      </section>

      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn--primary" type="submit" style="padding:0.6rem 1.4rem;font-weight:700">Save preferences</button>
      </div>
    </form>`;

  $("[data-preferences]", section).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      budget: numOrNull(form.querySelector('[name="budget"]').value),
      max_cook_time_minutes: numOrNull(form.querySelector('[name="max_cook_time_minutes"]').value),
      dietary_preferences: parseList(form.querySelector('[name="dietary_preferences"]').value),
      disliked_ingredients: parseList(form.querySelector('[name="disliked_ingredients"]').value),
      meal_variety: form.querySelector('[name="meal_variety"]').value,
    };
    try {
      const saved = await db.saveProfile(state.userId, payload);
      state.profile = saved;
      toast("Preferences saved.");
    } catch (err) {
      toast(err.message);
    }
  });
}

/* ==========================================================================
   Dialog helpers
   ========================================================================== */

function openDialog({ title, bodyHTML, submitLabel = "Save", onSubmit }) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = `
    <form>
      <div class="modal__head">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="modal__close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal__body">${bodyHTML}</div>
      <div class="modal__foot">
        <button type="button" class="btn btn--ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn--primary">${escapeHtml(submitLabel)}</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector("form");
  const close = () => { dialog.close(); dialog.remove(); };
  $("[data-close]", dialog).addEventListener("click", close);
  $("[data-cancel]", dialog).addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await onSubmit(form, dialog);
    } catch (err) {
      console.error(err);
      toast(err.message || "Something went wrong.");
    } finally {
      if (submitBtn && submitBtn.isConnected) submitBtn.disabled = false;
    }
  });

  dialog.showModal();
  return dialog;
}

function openPanel({ title, bodyHTML }) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = `
    <div class="modal__head">
      <h2>${escapeHtml(title)}</h2>
      <button type="button" class="modal__close" data-close aria-label="Close">&times;</button>
    </div>
    <div class="modal__body">${bodyHTML}</div>`;
  document.body.appendChild(dialog);

  const close = () => { dialog.close(); dialog.remove(); };
  $("[data-close]", dialog).addEventListener("click", close);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dialog.showModal();
  return { dialog, close };
}

/* ==========================================================================
   Wire up static controls and boot
   ========================================================================== */

$$("[data-auth-mode]").forEach((btn) => {
  btn.addEventListener("click", () => mountAuth(btn.dataset.authMode));
});

const dashboard = $("#dashboard");
const sidebarToggle = $("#sidebar-toggle");

function setSidebarCollapsed(collapsed) {
  if (!dashboard || !sidebarToggle) return;
  dashboard.classList.toggle("is-sidebar-collapsed", collapsed);
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
}

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    setSidebarCollapsed(!dashboard.classList.contains("is-sidebar-collapsed"));
  });
}

const profileToggle = $("#profile-toggle");
const profilePanel = $("#profile-panel");
const profileMenu = $("#profile-menu");

function closeProfileMenu() {
  if (!profilePanel || !profileToggle) return;
  profilePanel.hidden = true;
  profileToggle.setAttribute("aria-expanded", "false");
}

if (profileToggle && profilePanel) {
  profileToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !profilePanel.hidden;
    profilePanel.hidden = isOpen;
    profileToggle.setAttribute("aria-expanded", String(!isOpen));
  });
  profilePanel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", (event) => {
    if (!profileMenu?.contains(event.target)) closeProfileMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProfileMenu();
  });
}

$$(".app-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    renderView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

const logoutBtn = $("#logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try { await window.Clerk.signOut(); } catch (err) { console.error(err); }
    showAuth();
  });
}

// Backup / restore — wired here so it exists from boot, not just post-login.
const backupBtn = $("#backup-btn");
if (backupBtn) {
  backupBtn.addEventListener("click", async () => {
    if (!state.userId) { toast("Sign in first."); return; }
    await backupAll();
  });
}
const restoreBtn = $("#restore-btn");
const restoreFile = $("#restore-file");
if (restoreBtn && restoreFile) {
  restoreBtn.addEventListener("click", () => {
    if (!state.userId) { toast("Sign in first."); return; }
    restoreFile.click();
  });
  restoreFile.addEventListener("change", async () => {
    const file = restoreFile.files && restoreFile.files[0];
    restoreFile.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        toast("Restoring your backup…");
        await restoreBackup(parsed);
      } catch (err) {
        console.error(err);
        toast("Restore failed: " + err.message);
      }
    };
    reader.onerror = () => toast("Could not read that file.");
    reader.readAsText(file);
  });
}

// Register the service worker here too, in case the user lands on the dashboard first.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

window.addEventListener("offline", () => {
  toast("You are offline — live data needs a connection.");
});

boot();
