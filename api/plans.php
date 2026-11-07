<?php
/**
 * MealPlan DSS — /api/plans.php (Clerk user id required, never trusted blindly)
 *
 * Dated weekly plans, one row per user/date/period.
 * Mirrors db.js date-based functions 1:1 (MySQL instead of Postgres).
 *
 *  Methods (all JSON):
 *   GET    ?user_id=<uid>&from=YYYY-MM-DD&to=YYYY-MM-DD     plan rows joined w/ meal info
 *   POST   {user_id, action, ...}                          actions below
 *
 *  Actions (POST body):
 *   assign        {meal_date, meal_period, meal_id, leftover_from?}
 *   remove        {meal_date, meal_period}
 *   clear_week    {from, to}
 *   move          {from_date, period, to_date}
 *   shift_week    {old_start, new_start}
 *   bulk_fill     {period, meal_id, from, to, overwrite?}
 *
 * Leftovers: a slot with leftover_from set means "cook fresh earlier, reuse here".
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

$userId = require_user_id();
$db     = get_db();
$method = $_SERVER['REQUEST_METHOD'];

/* ---------- helpers ---------- */

function parse_date_field($value): ?string
{
    $d = str_or_empty($value);
    if ($d === '') {
        return null;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $d);
    return ($dt && $dt->format('Y-m-d') === $d) ? $d : null;
}

function parse_period($value): ?string
{
    $p = strtolower(str_or_empty($value));
    return in_array($p, ['breakfast', 'lunch', 'dinner'], true) ? $p : null;
}

/** Assign or update a slot (upsert keyed by user/date/period). */
function assign_slot(PDO $db, string $uid, string $date, string $period, string $mealId, ?string $leftoverFrom): void
{
    $db->prepare(
        'INSERT INTO weekly_plan (id, user_id, meal_date, meal_period, meal_id, leftover_from)
         VALUES (:id, :uid, :date, :period, :meal, :lo)
         ON DUPLICATE KEY UPDATE
            meal_id = VALUES(meal_id),
            leftover_from = VALUES(leftover_from)'
    )->execute([
        'id'     => uuid_v4(),
        'uid'    => $uid,
        'date'   => $date,
        'period' => $period,
        'meal'   => $mealId,
        'lo'     => $leftoverFrom,
    ]);
}

/* ---------- routes ---------- */

switch ($method) {
    case 'GET':
        $from = parse_date_field($_GET['from'] ?? null);
        $to   = parse_date_field($_GET['to'] ?? null);

        if ($from === null || $to === null) {
            json_response(['error' => 'from and to (YYYY-MM-DD) are required.'], 422);
        }

        $stmt = $db->prepare(
            'SELECT wp.meal_date, wp.meal_period, wp.meal_id, wp.leftover_from,
                    mc.name, mc.ingredients, mc.estimated_cost,
                    mc.prep_time_minutes, mc.cook_time_minutes, mc.dietary_tags
             FROM weekly_plan wp
             LEFT JOIN meal_catalog mc ON mc.id = wp.meal_id
             WHERE wp.user_id = :uid
               AND wp.meal_date BETWEEN :from AND :to
             ORDER BY wp.meal_date ASC, wp.meal_period ASC'
        );
        $stmt->execute(['uid' => $userId, 'from' => $from, 'to' => $to]);
        json_response($stmt->fetchAll());
        break;

    case 'POST':
        $body   = request_json();
        $action = strtolower(str_or_empty($body['action'] ?? null));

        switch ($action) {
            case 'assign': {
                $date   = parse_date_field($body['meal_date'] ?? null);
                $period = parse_period($body['meal_period'] ?? null);
                $mealId = str_or_empty($body['meal_id'] ?? null);
                $lo     = parse_period($body['leftover_from'] ?? null);

                if (!$date || !$period || $mealId === '') {
                    json_response(['error' => 'meal_date, meal_period and meal_id are required.'], 422);
                }

                assign_slot($db, $userId, $date, $period, $mealId, $lo);
                json_response(['ok' => true]);
                break;
            }

            case 'remove': {
                $date   = parse_date_field($body['meal_date'] ?? null);
                $period = parse_period($body['meal_period'] ?? null);

                if (!$date || !$period) {
                    json_response(['error' => 'meal_date and meal_period are required.'], 422);
                }

                $stmt = $db->prepare(
                    'DELETE FROM weekly_plan
                     WHERE user_id = :uid AND meal_date = :d AND meal_period = :p'
                );
                $stmt->execute(['uid' => $userId, 'd' => $date, 'p' => $period]);

                json_response(['ok' => true]);
                break;
            }

            case 'clear_week': {
                $from = parse_date_field($body['from'] ?? null);
                $to   = parse_date_field($body['to'] ?? null);

                if (!$from || !$to) {
                    json_response(['error' => 'from and to are required.'], 422);
                }

                $stmt = $db->prepare(
                    'DELETE FROM weekly_plan
                     WHERE user_id = :uid AND meal_date BETWEEN :from AND :to'
                );
                $stmt->execute(['uid' => $userId, 'from' => $from, 'to' => $to]);

                json_response(['ok' => true, 'deleted' => $stmt->rowCount()]);
                break;
            }

            case 'move': {
                $fromDate = parse_date_field($body['from_date'] ?? null);
                $toDate   = parse_date_field($body['to_date'] ?? null);
                $period   = parse_period($body['period'] ?? null);

                if (!$fromDate || !$toDate || !$period) {
                    json_response(['error' => 'from_date, to_date and period are required.'], 422);
                }

                // Clear the target slot first so the unique key is not violated.
                $db->prepare(
                    'DELETE FROM weekly_plan
                     WHERE user_id = :uid AND meal_date = :d AND meal_period = :p'
                )->execute(['uid' => $userId, 'd' => $toDate, 'p' => $period]);

                // A leftover only makes sense on its original date, so the moved
                // meal is cooked fresh on the new date (leftover_from cleared).
                $stmt = $db->prepare(
                    'UPDATE weekly_plan
                     SET meal_date = :to, leftover_from = NULL
                     WHERE user_id = :uid AND meal_date = :from AND meal_period = :p'
                );
                $stmt->execute(['uid' => $userId, 'from' => $fromDate, 'to' => $toDate, 'p' => $period]);

                json_response(['ok' => true, 'moved' => $stmt->rowCount()]);
                break;
            }

            case 'shift_week': {
                $oldStart = parse_date_field($body['old_start'] ?? null);
                $newStart = parse_date_field($body['new_start'] ?? null);

                if (!$oldStart || !$newStart) {
                    json_response(['error' => 'old_start and new_start are required.'], 422);
                }

                $oldEnd = (new DateTimeImmutable($oldStart))->modify('+6 days')->format('Y-m-d');
                $stmt = $db->prepare(
                    'SELECT meal_date, meal_period, meal_id, leftover_from
                     FROM weekly_plan
                     WHERE user_id = :uid AND meal_date BETWEEN :from AND :to'
                );
                $stmt->execute(['uid' => $userId, 'from' => $oldStart, 'to' => $oldEnd]);
                $rows = $stmt->fetchAll();

                if (!$rows) {
                    json_response(['ok' => true, 'moved' => 0]);
                }

                $delta = (int) ((new DateTimeImmutable($newStart))->diff(new DateTimeImmutable($oldStart))->format('%a'));

                $db->prepare(
                    'DELETE FROM weekly_plan
                     WHERE user_id = :uid AND meal_date BETWEEN :from AND :to'
                )->execute(['uid' => $userId, 'from' => $oldStart, 'to' => $oldEnd]);

                foreach ($rows as $r) {
                    $newDate = (new DateTimeImmutable($r['meal_date']))
                        ->modify("+{$delta} days")
                        ->format('Y-m-d');
                    assign_slot($db, $userId, $newDate, $r['meal_period'], $r['meal_id'], $r['leftover_from']);
                }

                json_response(['ok' => true, 'moved' => count($rows)]);
                break;
            }

            case 'bulk_fill': {
                $period = parse_period($body['period'] ?? null);
                $mealId = str_or_empty($body['meal_id'] ?? null);
                $from   = parse_date_field($body['from'] ?? null);
                $to     = parse_date_field($body['to'] ?? null);
                $over   = !empty($body['overwrite']);

                if (!$period || $mealId === '' || !$from || !$to) {
                    json_response(['error' => 'period, meal_id, from and to are required.'], 422);
                }

                $cursor = new DateTimeImmutable($from);
                $end    = new DateTimeImmutable($to);
                $count  = 0;

                while ($cursor <= $end) {
                    $date = $cursor->format('Y-m-d');
                    if ($over) {
                        assign_slot($db, $userId, $date, $period, $mealId, null);
                    } else {
                        // Don't overwrite existing slots.
                        $exists = $db->prepare(
                            'SELECT id FROM weekly_plan
                             WHERE user_id = :uid AND meal_date = :d AND meal_period = :p'
                        );
                        $exists->execute(['uid' => $userId, 'd' => $date, 'p' => $period]);
                        if (!$exists->fetch()) {
                            assign_slot($db, $userId, $date, $period, $mealId, null);
                        }
                    }
                    $count++;
                    $cursor = $cursor->modify('+1 day');
                }

                json_response(['ok' => true, 'filled' => $count]);
                break;
            }

            default:
                json_response(['error' => 'Unknown action.'], 422);
        }
        break;

    default:
        json_response(['error' => 'Method not allowed.'], 405);
}
