# MealPlan DSS — PHP / cPanel deploy

The app uses **Clerk** for auth (unchanged) and replaces Neon (PostgreSQL)
with the **cPanel MySQL database** via a small PHP API in `api/`.

---

## 1. Create the database in cPanel

1. **cPanel → MySQL Databases → Create New Database**
   - Name: `mealplan_dss` (any name; note the full prefixed name, e.g.
     `youruser_mealplan_dss`).
2. **Create New User** — e.g. `mealplan_dss_user`, set a strong password,
   then **Add User To Database** with `ALL PRIVILEGES`.
3. **phpMyAdmin** → select the new database → **Import** →
   upload `database/schema.sql`.
4. (Existing data?) In the **Neon SQL Editor**, run each block of
   `database/migration_from_neon.sql` in order (profiles → meal_catalog →
   inventory → weekly_plan → shopping_list), download each result as CSV,
   then in phpMyAdmin **CSV import** each file into the matching table
   with:
   - **Fields terminated by:** `,`
   - **Fields enclosed by:** `"`
   - **"Tick this box if the first row contains column names" — ON**
   The export SQL already strips embedded quotes from free-text columns
   and converts timestamps to UTC `YYYY-MM-DD HH:mm:ss`, avoiding the
   `#1366 Incorrect decimal value: 'quantity'` error (header row treated
   as data) and the `+00` / microseconds-in-timestamp errors. Empty
   tables export zero rows — that is fine, their import is a no-op.

## 2. Configure the API

1. Copy `api/config.example.php` → `api/config.php`.
2. Fill in the exact prefixed names from step 1:

   ```php
   return [
       'db_host' => 'localhost',
       'db_name' => 'youruser_mealplan_dss',
       'db_user' => 'youruser_mealplan_dss_user',
       'db_pass' => 'the_password_you_set',
   ];
   ```

   `api/config.php` is not committed and must never be served publicly.
3. Upload the whole project folder (or zip) to your domain's `public_html`
   — except `neon-config*.js` (no longer needed) and
   `tools/create-demo-user.php` after step 3b.

## 3. Login / demo account (Clerk — unchanged)

- **Create the demo account once** (script, then delete it):
  ```bash
  php tools/create-demo-user.php <your_clerk_secret_key>
  ```
  or upload `tools/create-demo-user.php` to the server temporarily, visit
  `https://mealplan-dss.jensentortega.online/tools/create-demo-user.php?key=<secret>`,
  then **delete the file from the server**.
  - Demo login: `account@user.com` / `MealPlanDSS`
  - The credentials are shown on the auth screen (`app.html`) as required.
- Clerk dashboard: ensure **email + password** sign-in is enabled
  (already true per SETUP.md — no publishable-key changes needed).

## 4. Frontend wiring (required after deploy)

`app.js` still calls Neon directly. To use the PHP API:

1. Point `neon.js` / `db.js` consumers at `api/*.php` — replace the Neon
   `getSql()` calls in `db.js` with `fetch('/api/inventory.php?user_id=…')`
   etc. (endpoints are ready; this is a mechanical swap mirroring `db.js`).
2. Bump **`CACHE_VERSION`** in `service-worker.js` so returning clients
   fetch the new code (the API endpoints are network-first; static files
   stay cache-first).
3. Delete `neon-config.js` / `neon-config.example.js` (secret no longer
   needed in the frontend).

## 5. HTTPS / SSL (PWAs require it)

- **cPanel → Security → Let's Encrypt** (or your host's auto-SSL) →
  issue a certificate for `mealplan-dss.jensentortega.online`.
- Force HTTPS: `cPanel → Domains → (your domain) → Force HTTPS Administration`
  *or* add to the root `.htaccess`:
  ```apache
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
  ```
- Verify: `https://mealplan-dss.jensentortega.online` loads over HTTPS and
  the PWA manifest + service worker register without errors.

## 6. Verify (installability + data)

1. Open DevTools → **Application** → Manifest: name, icons (512 + 192),
   theme color and `display: standalone` all show.
2. DevTools → **Lighthouse** (PWA category): installability, offline
   support and HTTPS should all pass.
3. Application → **Service Workers**: activate, reload, then cut network —
   the page still loads (offline app shell).
4. Sign in as the demo account, add an ingredient and a meal, generate a
   plan: rows appear in phpMyAdmin under the same `user_id` you had in Neon.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Database connection failed." | `api/config.php` credentials / prefixed names mismatch |
| 401 Missing or invalid user_id | frontend not passing the Clerk `user_id` to the API |
| Tables missing | re-import `database/schema.sql` in phpMyAdmin |
| Old code in browser | bump `CACHE_VERSION` in `service-worker.js` |
| SW won't register | site must be HTTPS (or `localhost`); no `file://` |
| Demo user missing | re-run `tools/create-demo-user.php` with a valid Clerk secret key |

## Files added for this migration

| File | Purpose |
| --- | --- |
| `database/schema.sql` | MySQL port of the Neon schema + migrations 001–004 |
| `database/migration_from_neon.sql` | Ordered Neon export queries (CSV for phpMyAdmin) |
| `api/helpers.php`, `api/db.php` | JSON helpers, PDO connection, Clerk-identity passthrough, profile bootstrap |
| `api/config.example.php` | Template for cPanel credentials |
| `api/get_user.php` | Resolves Clerk `user_id`, creates empty profile on first use |
| `api/profiles.php` | Save preferences (upsert keyed by `user_id`) |
| `api/inventory.php` | Inventory CRUD + purge-prior-week |
| `api/meals.php` | Meal catalog CRUD |
| `api/plans.php` | Dated plans: assign/remove/clear/move/shift/bulk-fill |
| `api/shopping.php` | Shopping list CRUD + history |
| `tools/create-demo-user.php` | One-off Clerk demo account script (**delete after use**) |

The recommendation engine (`recommend.js`) stays client-side — it is pure
rule-based logic with no database queries, so nothing is lost by keeping it
in the browser.
