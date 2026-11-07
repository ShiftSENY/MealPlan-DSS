<?php
/**
 * MealPlan DSS — /api/meals.php (Clerk user id required, never trusted blindly)
 *
 *   GET    list all (or one row when ?id=<uuid> is given)
 *   POST   {user_id, name, meal_periods[], ingredients[], estimated_cost,
 *           prep_time_minutes, cook_time_minutes, nutrition_notes, dietary_tags[]}
 *   PUT    same + {id}    update
 *   DELETE ?id=<uuid>     delete
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

function validate_meal(array $data): array
{
    $name = str_or_empty($data['name'] ?? null);
    if ($name === '') {
        json_response(['error' => 'name is required.'], 422);
    }

    $int = function (string $key) use ($data) {
        return isset($data[$key]) && $data[$key] !== '' ? (int) $data[$key] : null;
    };
    $num = function (string $key) use ($data) {
        return isset($data[$key]) && $data[$key] !== '' ? (float) $data[$key] : null;
    };
    $str = function (string $key) use ($data): ?string {
        $v = str_or_empty($data[$key] ?? null);
        return $v !== '' ? $v : null;
    };

    return [
        'name'              => $name,
        'meal_periods'      => is_array($data['meal_periods'] ?? null) ? $data['meal_periods'] : [],
        'ingredients'       => is_array($data['ingredients'] ?? null) ? $data['ingredients'] : [],
        'estimated_cost'    => $num('estimated_cost'),
        'prep_time_minutes' => $int('prep_time_minutes'),
        'cook_time_minutes' => $int('cook_time_minutes'),
        'nutrition_notes'   => $str('nutrition_notes'),
        'dietary_tags'      => is_array($data['dietary_tags'] ?? null) ? $data['dietary_tags'] : [],
    ];
}

/* ---------- routes ---------- */

switch ($method) {
    case 'GET':
        $id = parse_id();
        if ($id !== null) {
            $stmt = $db->prepare('SELECT * FROM meal_catalog WHERE id = :id AND user_id = :uid');
            $stmt->execute(['id' => $id, 'uid' => $userId]);
            $row = $stmt->fetch();
            json_response($row ?: ['error' => 'Not found.'], $row ? 200 : 404);
        }

        $stmt = $db->prepare(
            'SELECT * FROM meal_catalog WHERE user_id = :uid ORDER BY created_at DESC'
        );
        $stmt->execute(['uid' => $userId]);
        json_response($stmt->fetchAll());
        break;

    case 'POST':
        $v = validate_meal(request_json());
        $id = uuid_v4();

        $db->prepare(
            'INSERT INTO meal_catalog (
                id, user_id, name, meal_periods, ingredients, estimated_cost,
                prep_time_minutes, cook_time_minutes, nutrition_notes, dietary_tags
             ) VALUES (
                :id, :uid, :name, :mp, :ing, :cost, :prep, :cook, :nn, :tags
             )'
        )->execute([
            'id'    => $id,
            'uid'   => $userId,
            'name'  => $v['name'],
            'mp'    => json_encode($v['meal_periods']),
            'ing'   => json_encode($v['ingredients']),
            'cost'  => $v['estimated_cost'],
            'prep'  => $v['prep_time_minutes'],
            'cook'  => $v['cook_time_minutes'],
            'nn'    => $v['nutrition_notes'],
            'tags'  => json_encode($v['dietary_tags']),
        ]);

        json_response(['id' => $id], 201);
        break;

    case 'PUT':
        $data = request_json();
        $id   = str_or_empty($data['id'] ?? null);
        if ($id === '') {
            json_response(['error' => 'Missing id.'], 422);
        }

        $v = validate_meal($data);
        $stmt = $db->prepare(
            'UPDATE meal_catalog SET
                name = :name, meal_periods = :mp, ingredients = :ing,
                estimated_cost = :cost, prep_time_minutes = :prep,
                cook_time_minutes = :cook, nutrition_notes = :nn, dietary_tags = :tags
             WHERE id = :id AND user_id = :uid'
        );
        $stmt->execute([
            'name' => $v['name'],
            'mp'   => json_encode($v['meal_periods']),
            'ing'  => json_encode($v['ingredients']),
            'cost' => $v['estimated_cost'],
            'prep' => $v['prep_time_minutes'],
            'cook' => $v['cook_time_minutes'],
            'nn'   => $v['nutrition_notes'],
            'tags' => json_encode($v['dietary_tags']),
            'id'   => $id,
            'uid'  => $userId,
        ]);

        json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
        break;

    case 'DELETE':
        $id = parse_id();
        if ($id === null) {
            json_response(['error' => 'Missing id.'], 422);
        }

        $stmt = $db->prepare('DELETE FROM meal_catalog WHERE id = :id AND user_id = :uid');
        $stmt->execute(['id' => $id, 'uid' => $userId]);

        json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
        break;

    default:
        json_response(['error' => 'Method not allowed.'], 405);
}
