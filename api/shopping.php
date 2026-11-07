<?php
/**
 * MealPlan DSS — /api/shopping.php (Clerk user id required, never trusted blindly)
 *
 * Mirrors db.js shopping-list functions (dated lists + history).
 *
 *  Methods (all JSON):
 *   GET    ?user_id=<uid>&list_date=YYYY-MM-DD           one date's items
 *   POST   {user_id, action, ...}                        actions below
 *
 *  Actions (POST body):
 *   add        {list_date, category?, ingredient_name, quantity?, unit?, purchased?, source_meal_id?}
 *   update     {id, category?, ingredient_name, quantity?, unit?, purchased?}
 *   purchased  {id, purchased}                            toggle purchased flag
 *   delete     {id}
 *   clear_date {list_date}                                delete whole date
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

/* ---------- routes ---------- */

switch ($method) {
    case 'GET':
        $listDate = parse_date_field($_GET['list_date'] ?? null);

        if ($listDate === null) {
            json_response(['error' => 'list_date (YYYY-MM-DD) is required.'], 422);
        }

        $stmt = $db->prepare(
            'SELECT * FROM shopping_list
             WHERE user_id = :uid AND list_date = :d
             ORDER BY category IS NULL, category ASC, ingredient_name ASC'
        );
        $stmt->execute(['uid' => $userId, 'd' => $listDate]);
        json_response($stmt->fetchAll());
        break;

    case 'POST':
        $body   = request_json();
        $action = strtolower(str_or_empty($body['action'] ?? null));

        switch ($action) {
            case 'add': {
                $listDate = parse_date_field($body['list_date'] ?? null);
                $name     = str_or_empty($body['ingredient_name'] ?? null);

                if (!$listDate || $name === '') {
                    json_response(['error' => 'list_date and ingredient_name are required.'], 422);
                }

                $id = uuid_v4();
                $db->prepare(
                    'INSERT INTO shopping_list (
                        id, user_id, list_date, category, ingredient_name,
                        quantity, unit, purchased, source_meal_id
                     ) VALUES (
                        :id, :uid, :d, :cat, :name, :q, :u, :p, :src
                     )'
                )->execute([
                    'id'   => $id,
                    'uid'  => $userId,
                    'd'    => $listDate,
                    'cat'  => str_or_empty($body['category'] ?? null) ?: null,
                    'name' => $name,
                    'q'    => isset($body['quantity']) && $body['quantity'] !== '' ? (float) $body['quantity'] : null,
                    'u'    => str_or_empty($body['unit'] ?? null) ?: null,
                    'p'    => !empty($body['purchased']) ? 1 : 0,
                    'src'  => str_or_empty($body['source_meal_id'] ?? null) ?: null,
                ]);

                json_response(['id' => $id], 201);
                break;
            }

            case 'update': {
                $id = str_or_empty($body['id'] ?? null);
                $name = str_or_empty($body['ingredient_name'] ?? null);

                if ($id === '' || $name === '') {
                    json_response(['error' => 'id and ingredient_name are required.'], 422);
                }

                $stmt = $db->prepare(
                    'UPDATE shopping_list SET
                        category = :cat, ingredient_name = :name,
                        quantity = :q, unit = :u, purchased = :p
                     WHERE id = :id AND user_id = :uid'
                );
                $stmt->execute([
                    'cat'  => str_or_empty($body['category'] ?? null) ?: null,
                    'name' => $name,
                    'q'    => isset($body['quantity']) && $body['quantity'] !== '' ? (float) $body['quantity'] : null,
                    'u'    => str_or_empty($body['unit'] ?? null) ?: null,
                    'p'    => !empty($body['purchased']) ? 1 : 0,
                    'id'   => $id,
                    'uid'  => $userId,
                ]);

                json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
                break;
            }

            case 'purchased': {
                $id = str_or_empty($body['id'] ?? null);
                if ($id === '') {
                    json_response(['error' => 'id is required.'], 422);
                }

                $stmt = $db->prepare(
                    'UPDATE shopping_list SET purchased = :p WHERE id = :id AND user_id = :uid'
                );
                $stmt->execute(['p' => !empty($body['purchased']) ? 1 : 0, 'id' => $id, 'uid' => $userId]);

                json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
                break;
            }

            case 'delete': {
                $id = str_or_empty($body['id'] ?? null);
                if ($id === '') {
                    json_response(['error' => 'id is required.'], 422);
                }

                $stmt = $db->prepare('DELETE FROM shopping_list WHERE id = :id AND user_id = :uid');
                $stmt->execute(['id' => $id, 'uid' => $userId]);

                json_response($stmt->rowCount() ? ['ok' => true] : ['error' => 'Not found.'], $stmt->rowCount() ? 200 : 404);
                break;
            }

            case 'clear_date': {
                $listDate = parse_date_field($body['list_date'] ?? null);
                if ($listDate === null) {
                    json_response(['error' => 'list_date is required.'], 422);
                }

                $stmt = $db->prepare(
                    'DELETE FROM shopping_list WHERE user_id = :uid AND list_date = :d'
                );
                $stmt->execute(['uid' => $userId, 'd' => $listDate]);

                json_response(['ok' => true, 'deleted' => $stmt->rowCount()]);
                break;
            }

            default:
                json_response(['error' => 'Unknown action.'], 422);
        }
        break;

    default:
        json_response(['error' => 'Method not allowed.'], 405);
}
