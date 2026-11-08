<?php
/**
 * MealPlan DSS — CSV importer for Neon exports (cPanel-safe, phpMyAdmin-free).
 *
 * Why this exists: phpMyAdmin's CSV importer treats empty fields as ''
 * instead of SQL NULL, which breaks on DATE/DECIMAL columns. This script
 * converts empty fields to real NULLs, normalizes dates, and inserts with
 * PDO prepared statements, printing a per-row report.
 *
 * Usage (CLI):
 *   php tools/import_csv.php <csv_file> <table> [--dry]
 * Usage (browser — upload temporarily):
 *   https://mealplan-dss.jensentortega.online/tools/import_csv.php?csv=<path>&table=<name>[&dry=1]
 *
 * >>> DELETE THIS SCRIPT FROM THE SERVER WHEN DONE <<<
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/db.php';

/* -------------------------------------------------------------------------
 * Allowed tables and their canonical column order (matches the Neon
 * export order in database/migration_from_neon.sql). A header row is
 * auto-detected and skipped, so both headed and header-less exports work.
 * ----------------------------------------------------------------------- */
const TABLES = [
    'profiles' => [
        'columns' => ['user_id', 'budget', 'max_cook_time_minutes', 'dietary_preferences', 'disliked_ingredients', 'nutrition_goals', 'meal_variety', 'created_at', 'updated_at'],
        'json'    => ['dietary_preferences', 'disliked_ingredients', 'nutrition_goals'],
        'ints'    => ['max_cook_time_minutes'],
        'dates'   => ['created_at', 'updated_at'],
    ],
    'meal_catalog' => [
        'columns' => ['id', 'user_id', 'name', 'meal_periods', 'ingredients', 'estimated_cost', 'prep_time_minutes', 'cook_time_minutes', 'nutrition_notes', 'dietary_tags', 'created_at', 'updated_at'],
        'json'    => ['meal_periods', 'ingredients', 'dietary_tags'],
        'ints'    => ['prep_time_minutes', 'cook_time_minutes'],
        'dates'   => ['created_at', 'updated_at'],
    ],
    'inventory' => [
        'columns' => ['id', 'user_id', 'item_name', 'category', 'quantity', 'unit', 'purchase_date', 'expiration_date', 'storage_location', 'notes', 'created_at', 'updated_at'],
        'dates'   => ['purchase_date', 'expiration_date', 'created_at', 'updated_at'],
    ],
    'weekly_plan' => [
        'columns' => ['id', 'user_id', 'meal_date', 'meal_period', 'meal_id', 'leftover_from', 'assigned_at'],
        'dates'   => ['meal_date', 'assigned_at'],
    ],
    'shopping_list' => [
        'columns' => ['id', 'user_id', 'list_date', 'category', 'ingredient_name', 'quantity', 'unit', 'purchased', 'source_meal_id', 'created_at'],
        'ints'    => ['purchased'],
        'dates'   => ['list_date', 'created_at'],
    ],
];

$isCli = PHP_SAPI === 'cli';

function out(string $msg): void
{
    global $isCli;
    if ($isCli) {
        echo $msg . PHP_EOL;
    } else {
        echo htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . "<br>\n";
    }
}

/* Empty field -> real NULL (the actual fix phpMyAdmin cannot do). */
function to_null($value)
{
    if ($value === null) {
        return null;
    }
    $value = trim((string) $value);
    if ($value === '' || strcasecmp($value, 'NULL') === 0) {
        return null;
    }
    return $value;
}

/* Normalize to 'YYYY-MM-DD HH:mm:ss' (UTC). */
function normalize_datetime(string $value): ?string
{
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d', 'm/d/Y', 'd/m/Y'] as $fmt) {
        $dt = DateTimeImmutable::createFromFormat($fmt, $value);
        if ($dt) {
            return $dt->format('Y-m-d H:i:s');
        }
    }
    $ts = strtotime($value);
    return $ts !== false ? date('Y-m-d H:i:s', $ts) : null;
}

/* Is this row a header from Neon's export ("id","user_id",...)? */
function is_header_row(array $fields, array $columns): bool
{
    foreach ($fields as $field) {
        $name = strtolower(trim((string) $field, " \t\n\r\0\x0B\""));
        if (in_array($name, $columns, true)) {
            return true;
        }
    }
    return false;
}

function import_csv(string $csvPath, string $table, bool $dry = false): array
{
    if (!isset(TABLES[$table])) {
        throw new RuntimeException("Unknown table: $table");
    }
    $spec   = TABLES[$table];
    $cols   = $spec['columns'];
    $handle = fopen($csvPath, 'r');
    if (!$handle) {
        throw new RuntimeException("Cannot open CSV: $csvPath");
    }

    $db      = $dry ? null : get_db();
    $stmt    = null;
    $ensureProfile = null;

    if (!$dry && $db instanceof PDO) {
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $stmt = $db->prepare(sprintf(
            'INSERT INTO %s (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s',
            $table,
            implode(', ', $cols),
            $placeholders,
            implode(', ', array_map(static fn($c) => "`$c` = VALUES(`$c`)", $cols))
        ));

        // FK guard: auto-create a stub profile row when needed.
        if ($table !== 'profiles') {
            $ensureProfile = function (string $userId) use ($db): void {
                $check = $db->prepare('SELECT COUNT(*) FROM profiles WHERE user_id = ?');
                $check->execute([$userId]);
                if ((int) $check->fetchColumn() === 0) {
                    $db->prepare('INSERT IGNORE INTO profiles (user_id) VALUES (?)')->execute([$userId]);
                }
            };
        }
    }

    $rowNum = 0;
    $inserted = 0;
    $skipped  = 0;
    $failed   = [];

    while (($fields = fgetcsv($handle)) !== false) {
        $rowNum++;

        // Skip blank lines and an optional Neon header row.
        if (count($fields) === 1 && trim((string) $fields[0]) === '') {
            continue;
        }
        if (is_header_row($fields, $cols)) {
            continue;
        }

        if (count($fields) !== count($cols)) {
            $failed[$rowNum] = sprintf('expected %d columns, got %d', count($cols), count($fields));
            $skipped++;
            continue;
        }

        try {
            $row = array_combine($cols, $fields);

            if (!$dry && isset($row['user_id']) && $ensureProfile) {
                $ensureProfile((string) $row['user_id']);
            }

            $values = [];
            foreach ($cols as $col) {
                $value = $row[$col];
                if (in_array($col, $spec['dates'] ?? [], true)) {
                    $value = normalize_datetime((string) $value);
                } elseif (in_array($col, $spec['ints'] ?? [], true)) {
                    $value = $value !== '' ? (int) $value : null;
                } elseif (in_array($col, $spec['json'] ?? [], true)) {
                    $value = $value !== '' ? $value : null; // keep JSON text as-is
                } else {
                    $value = to_null($value);
                }
                $values[] = $value;
            }

            if ($dry) {
                $inserted++; // validation only — no write
                continue;
            }

            $stmt->execute($values);
            $inserted++;
        } catch (Throwable $e) {
            $failed[$rowNum] = $e->getMessage();
            $skipped++;
        }
    }

    fclose($handle);

    return ['inserted' => $inserted, 'skipped' => $skipped, 'failed' => $failed];
}

/* -------------------------------------------------------------------------
 * Entry point
 * ----------------------------------------------------------------------- */
function main(array $argv, bool $isCli): void
{
    $csv = $argv[1] ?? ($_GET['csv'] ?? null);
    $tbl = $argv[2] ?? ($_GET['table'] ?? null);
    $dry = in_array('--dry', $argv, true) || !empty($_GET['dry']);

    if (!$csv || !$tbl) {
        out('Usage: php tools/import_csv.php <csv_file> <table> [--dry]');
        out('Tables: ' . implode(', ', array_keys(TABLES)));
        if (!$isCli) {
            out('Browser mode: ?csv=<path>&table=<name>[&dry=1]');
        }
        exit(1);
    }

    if (!file_exists($csv)) {
        out("CSV not found: $csv");
        exit(1);
    }

    out("Importing into '$tbl' from $csv" . ($dry ? ' (dry run)' : ''));

    $result = import_csv($csv, $tbl, $dry);

    out(sprintf('Done. Inserted: %d, Skipped: %d', $result['inserted'], $result['skipped']));

    if ($result['failed']) {
        out('Failures by row:');
        foreach ($result['failed'] as $line => $msg) {
            out("  Row $line: $msg");
        }
    }

    if (!$isCli) {
        out('Remember to DELETE this script from the server when you are done.');
    }
}

main($argv ?? [], $isCli);