<?php
/**
 * MealPlan DSS — GET /api/get_user.php
 * Resolves the Clerk user id and bootstraps an empty profile row on first use.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Method not allowed.'], 405);
}

$userId = require_user_id();
$profile = ensure_profile($userId);

json_response([
    'user_id' => $userId,
    'profile' => $profile,
]);
