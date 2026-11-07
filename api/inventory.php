<?php
/**
 * MealPlan DSS — /api/inventory.php (Clerk user id required, never trusted blindly)
 *
 *   GET    list all (optionally ?week_start= to clear prior-week items first,
 *          is handled by DELETE /clear below instead — listing is plain)
 *   GET    ?id=<uuid>      one row
 *   POST   {user_id, item_name, category, quantity, unit, purchase_date,
 *           expiration_date, storage_location, notes}
 *   PUT    same + {id}    update (returns the updated row, like db.js)
 *   DELETE ?id=<uuid>     delete
 *   DELETE ?week_start=YYYY-MM-DD
 *                             purge items purchased before that date
 *                             (mirrors db.js clearPreviousWeekInventory;
 *                             returns [{id, item_name}] of removed rows)
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

$userId = require_user_id();
$db     = get_db();
$method = $_SERVER['REQUEST_METHOD'];

/* ---------- helpers ---------- */

function parse_id(): ?string
{
    $id = str_or_empty($_GET['id'] ?? null);
    return $id !== '' ? $id : null;
}

function parse_date($value): ?string
{
    $d = str_or_empty($value);
    if ($d === '') {
        return null;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $d);
    return ($dt && $dt->format('Y-m-d') === $d) ? $d : null;
}

function validate_item(array $data): array
{
    $name = str_or_empty($data['item_name'] ?? null);
    if ($name === '') {
        json_response(['error' => 'item_name is required.'], 422);
    }

    foreach (['purchase_date', 'expiration_date'] as $field) {
        $raw = str_or_empty($data[$field] ?? null);
        if ($raw !== '' && parse_date($raw) === null) {
            json_response(['error' => "$field must be a valid YYYY-MM-DD date."], 422);
        }
    }

    $num = function (string $key) use ($data) {
        return isset($data[$key]) && $data[$key] !== '' ? (float) $data[$key] : null;
    };

    $str = function (string $key) use ($data): ?string {
        $v = str_or_empty($data[$key] ?? null);
        return $v !== '' ? $v : null;
    };

    return [
        'item_name'        => $name,
        'category'         => $str('category'),
        'quantity'         => $num('quantity'),
        'unit'             => $str('unit'),
        'purchase_date'    => parse_date($data['purchase_date'] ?? null),
        'expiration_date'  => parse_date($data['expiration_date'] ?? null),
        'storage_location' => $str('storage_location'),
        'notes'            => $str('notes'),
    ];
}

/* ---------- routes ---------- */

switch ($method) {
    case 'GET':
        $id = parse_id();
        if ($id !== null) {
            $stmt = $db->prepare('SELECT * FROM inventory WHERE id = :id AND user_id = :uid');
            $stmt->execute(['id' => $id, 'uid' => $userId]);
            $row = $stmt->fetch();
            json_response($row ?: ['error' => 'Not found.'], $row ? 200 : 404);
        }

        $stmt = $db->prepare(
            'SELECT * FROM inventory WHERE user_id = :uid ORDER BY item_name ASC'
        );
        $stmt->execute(['uid' => $userId]);
        json_response($stmt->fetchAll());
        break;

    case 'POST':
        $v = validate_item(request_json());
        $id = uuid_v4();

        $db->prepare(
            'INSERT INTO inventory (
                id, user_id, item_name, category, quantity, unit,
                purchase_date, expiration_date, storage_location, notes
             ) VALUES (
                :id, :uid, :name, :cat, :q, :u, :pd, :ed, :sl, :notes
             )'
        )->execute([
            'id'    => $id,
            'uid'   => $userId,
            'name'  => $v['item_name'],
            'cat'   => $v['category'],
            'q'     => $v['quantity'],
            'u'     => $v['unit'],
            'pd'    => $v['purchase_date'],
            'ed'    => $v['expiration_date'],
            'sl'    => $v['storage_location'],
            'notes' => $v['notes'],
        ]);

        json_response(['id' => $id], 201);
        break;

    case 'PUT':
        $data = request_json();
        $id   = str_or_empty($data['id'] ?? null);
        if ($id === '') {
            json_response(['error' => 'Missing id.'], 422);
        }

        $v = validate_item($data);
        $stmt = $db->prepare(
            'UPDATE inventory SET
                item_name = :name, category = :cat, quantity = :q, unit = :u,
                purchase_date = :pd, expiration_date = :ed,
                storage_location = :sl, notes = :notes
             WHERE id = :id AND user_id = :uid'
        );
        $stmt->execute([
            'name'  => $v['item_name'],
            'cat'   => $v['category'],
            'q'     => $v['quantity'],
            'u'     => $v['unit'],
            'pd'    => $v['purchase_date'],
            'ed'    => $v['expiration_date'],
            'sl'    => $v['storage_location'],
            'notes' => $v['notes'],
            'id'    => $id,
            'uid'   => $userId,
        ]);

        if (!$stmt->rowCount()) {
            json_response(['error' => 'Not found.'], 404);
        }
        json_response(['ok' => true]);
        break;

    case 'DELETE':
        $weekStart = parse_date($_GET['week_start'] ?? null);
        if ($weekStart !== null) {
            // Purge items bought before the current week (returns removed rows).
            $find = $db->prepare(
                'SELECT id, item_name FROM inventory
                 WHERE user_id = :uid
                   AND COALESCE(purchase_date, DATE(created_at)) < :ws'
            );
            $find->execute(['uid' => $userId, 'ws' => $weekStart]);
            $removed = $find->fetchAll();

            $db->prepare(
                'DELETE FROM inventory
                 WHERE user_id = :uid AND COALESCE(purchase_date, DATE(created_at)) < :ws'
            )->execute(['uid' => $userId, 'ws' => $weekStart]);

            json_response($removed ?: []);
            break;
        }

        $id = parse_id();
        if ($id === null) {
            json_response(['error' => 'Missing id.'], 422);
        }

        $stmt = $db->prepare('DELETE FROM inventory WHERE id = :id AND user_id = :uid');
        $stmt->execute(['id' => $id, 'uid' => $userId]);

        json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
        break;

    default:
        json_response(['error' => 'Method not allowed.'], 405);
}
