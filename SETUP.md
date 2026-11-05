# MealPlan DSS — Setup

This app has two parts:

- **`index.html`** — the marketing homepage (no login needed).
- **`app.html`** — the dashboard. Login is required before any inventory or
  planning data can be saved.

Authentication uses **Clerk** and data is stored in **Neon** (PostgreSQL).
The browser talks to Neon directly (Option A), so the app needs to be served
over `http://` / `https://` — not opened as a `file://` path.

---

## 1. Serve the app

From the project folder, run any static server, for example:

```powershell
# Python 3
python -m http.server 8080

# or Node
npx serve .
```

Then open <http://localhost:8080/index.html> and click **Get started**.

> ES modules (used by `app.js`) do not load from `file://`. Always use a server.

---

## 2. Create the Neon database

1. Log in to <https://console.neon.tech>.
2. **Create a project** named `mealplan-dss` (any region).
3. Open the **SQL Editor** and paste the contents of `schema.sql`, then run it.
   This creates `profiles`, `inventory`, `meal_catalog`, `weekly_plan` and
   `shopping_list`.

   **Already created the tables with the older schema?** Run
   `migration_001_dates.sql` instead of `schema.sql`. It converts the weekday
   meal plan into dated plans and adds the date + category columns used by the
   shopping history. It is safe to re-run.

   If saving preferences or editing meals fails, run `migration_002_align.sql`
   as well. It converts the early `text[]` list columns to JSONB and adds the
   missing `updated_at` timestamps. Also safe to re-run.

   To let a dish belong to multiple meal periods, run
   `migration_003_meal_periods.sql`. To support leftovers, run
   `migration_004_leftovers.sql` (or use the current `schema.sql` for a fresh
   install). Both are safe to re-run.
4. Copy the **connection string** (use the **Pooled** connection).
   It looks like:
   `postgresql://neondb_owner:...@ep-...aws.neon.tech/neondb?sslmode=require`
5. Open **`neon-config.js`** and replace the placeholder value:

   ```js
   export const NEON_CONNECTION_STRING =
     "postgresql://neondb_owner:YOUR_PASSWORD@ep-YOUR-ENDPOINT.aws.neon.tech/neondb?sslmode=require";
   ```

6. Reload `app.html`. The yellow "Database not configured" banner disappears
   once the string is valid.

> **Security note:** In this browser-only setup the connection string is visible
> to anyone who loads the page. That is fine for a personal/learning project.
> `neon-config.js` is listed in `.gitignore` so it is never committed to a public
> repository. If you later need production-grade security, put a small backend
> proxy (Cloudflare Worker / Vercel Function) in front of Neon.

### Keeping Neon awake

Neon's free tier can suspend a project after inactivity. To keep it warm, add a
tiny scheduled request (e.g. cron-job.org or a GitHub Actions schedule) that
opens `app.html` once a day, or upgrade the Neon plan if the app grows.

---

## 3. Clerk (already configured)

The publishable key is in `clerk-config.js` and in the `app.html` script tag.
It is a **publishable** key, safe to expose. No secret key is used.

In the Clerk dashboard, make sure **email + password** sign-in is enabled.
You do **not** need to set redirect/paths for this setup — sign-in and sign-up
are embedded directly inside `app.html`.

---

## 4. Using the app

1. Open `app.html` and **create an account** (or sign in).
2. **Inventory** — add ingredients. Purchase and expiration dates use date
   pickers and are fully editable.
3. **Meal Catalog** — your catalog starts empty. Add your own Filipino dishes
   (or click a suggestion chip such as Adobo, Sinigang, Kare-Kare). Each meal
   lists its required ingredients, cost and times. A dish can be tagged for
   **more than one period** (e.g., lunch and dinner).

   When a slot is planned, any earlier period on the same date that already has
   a meal offers **“Use leftovers from …”** (e.g. dinner eats lunch's leftovers).
   Leftover slots are marked on the plan and skipped when generating the
   shopping list so ingredients are not counted twice.
4. **Preferences** — set budget, max cooking time, dietary preferences,
   dislikes, nutrition goals and variety.
5. **Suggestions** — meals are ranked against your inventory and preferences,
   with a short explanation for each score.
6. **Weekly Plan** — navigate back through the weeks (earliest is
   **2026-08-10**) or forward to plan future weeks (up to a year ahead), tap any
   dated slot to assign a ranked meal, **Move** a meal to another date, **Shift
   week** to offset the whole week, **Copy previous week**, or **Fill breakfast**
   (defaults to Scrambled Eggs) across the week.
7. **Shopping List** — navigate per week to see history or plan ahead. You can:
   - **Import CSV** — load a weekly grocery list (see format below). Imported
     items are marked purchased and become history; they do **not** touch
     inventory.
   - **Add item** / **Edit** — manually add or correct items, with category
     (Food / Condiment / Ingredient / Other).
   - **Generate from plan** — lists only ingredients still missing from
     inventory for the displayed plan week.
   - Tick items purchased and push them to inventory one by one.

### Grocery CSV format

Three side-by-side groups, `Quantity` then item name, separated by blank columns:

```csv
Quantity,Food,,Quantity,Condiment,,Quantity,Ingredient
18,Eggs,,1,Soy Sauce,,4,Onions
3,Bags of Mung beans,,1,Vinegar,,3,Garlic
```

Fractions (`1/2`, `1 1/2`) and leading units (`Bags`, `Bundle`, `Bottles`,
`Pack`, `Can`, …) are understood. After import, the week shows a grouped list.

---

## 5. Troubleshooting

- **"Database not configured" banner** — `neon-config.js` still contains the
  placeholder. Paste your real connection string and reload.
- **Sign-in form does not appear** — check the browser console. The Clerk script
  loads from a CDN, so you need an internet connection. Confirm the publishable
  key in `clerk-config.js` matches your Clerk application.
- **Queries fail with a network/CORS error** — the Neon HTTP endpoint normally
  allows browser requests, but if your network blocks it, run the app behind a
  tiny proxy (Cloudflare Worker / Vercel Function) instead of calling Neon
  directly. This does not change the app logic, only where `db.js` points.
- **Tables missing** — re-run `schema.sql` in the Neon SQL Editor.
- **Data shows for one account only** — every row carries your Clerk `user_id`;
  signing into a different account shows a separate dataset (as intended).
- **Code changes do not appear** — the service worker caches app files. Bump
  `CACHE_VERSION` in `service-worker.js`, or in DevTools open
  **Application → Service Workers → Update** (tick "Update on reload" while
  developing). `neon-config.js` and `clerk-config.js` are always fetched fresh.

## 6. Files

| File | Purpose |
| --- | --- |
| `index.html` / `style.css` / `script.js` | Marketing homepage |
| `app.html` / `app.css` / `app.js` | Dashboard shell + controller |
| `clerk-config.js` | Clerk publishable key |
| `neon.js` | Neon driver wrapper (lazy-loaded) |
| `neon-config.js` | Your Neon connection string (gitignored) |
| `neon-config.example.js` | Template for the above |
| `db.js` | All database queries, scoped by user id |
| `recommend.js` | Rule-based ranking + explanations |
| `csv-parse.js` | Grocery CSV parser (pure, unit-testable) |
| `schema.sql` | Neon tables (fresh installs) |
| `migration_001_dates.sql` | Upgrades an existing DB to dated plans + history |
| `migration_002_align.sql` | Converts early `text[]` columns to JSONB + timestamps |
| `migration_003_meal_periods.sql` | Lets a meal belong to multiple meal periods |
| `migration_004_leftovers.sql` | Marks plan slots as leftovers from an earlier slot |
| `manifest.json` / `service-worker.js` | PWA install + offline app shell |
