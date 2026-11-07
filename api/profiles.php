<?php
/**
 * MealPlan DSS — /api/profiles.php
 *
 *   GET   list values are handled by get_user.php; this is the save endpoint.
 *   POST  { user_id, budget, max_cook_time_minutes, dietary_preferences,
 *           disliked_ingredients, nutrition_goals, meal_variety }
 *
 * Upsert keyed by user_id (mirrors db.js saveProfile 'on conflict').
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

$userId = require_user_id();
$db     = get_db();
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'POST':
        ensure_profile($userId);

        $data = request_json();
        $num  = function (string $key) use ($data) {
            return isset($data[$key]) && $data[$key] !== '' ? $data[$key] : null;
        };

        $stmt = $db->prepare(
            'INSERT INTO profiles (
                user_id, budget, max_cook_time_minutes, dietary_preferences,
                disliked_ingredients, nutrition_goals, meal_variety
             ) VALUES (
                :uid, :budget, :mct, :dp, :di, :ng, :mv
             )
             ON DUPLICATE KEY UPDATE
                budget = VALUES(budget),
                max_cook_time_minutes = VALUES(max_cook_time_minutes),
                dietary_preferences = VALUES(dietary_preferences),
                disliked_ingredients = VALUES(disliked_ingredients),
                nutrition_goals = VALUES(nutrition_goals),
                meal_variety = VALUES(meal_variety)'
        );
        $stmt->execute([
            'uid'    => $userId,
            'budget' => $num('budget'),
            'mct'    => $num('max_cook_time_minutes'),
            'dp'     => json_col($data['dietary_preferences'] ?? []),
            'di'     => json_col($data['disliked_ingredients'] ?? []),
            'ng'     => json_col($data['nutrition_goals'] ?? []),
            'mv'     => str_or_empty($data['meal_variety'] ?? null) ?: 'balanced',
        ]);

        json_response(['ok' => true]);
        break;

    default:
        json_response(['error' => 'Method not allowed.'], 405);
}
