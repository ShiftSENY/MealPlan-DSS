<?php
/**
 * MealPlan DSS — shared helpers for the API.
 * Small, dependency-free utilities used by every endpoint.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** Send a JSON response and stop execution. */
function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

/** Parse the JSON request body (endpoints return JSON, not form data). */
function request_json(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Trim + stringify a request value safely. */
function str_or_empty($value): string
{
    return is_string($value) ? trim($value) : '';
}

/**
 * Generate a UUIDv4 compatible with the Neon gen_random_uuid() format.
 * (Neon seeded UUIDs used in migrated data keep their original values.)
 */
function uuid_v4(): string
{
    $data = random_bytes(16);
    $data[6]  = chr(ord($data[6]) & 0x0f | 0x40); // version 4
    $data[8]  = chr(ord($data[8]) & 0x3f | 0x80); // variant
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/**
 * Resolve and validate the current user.
 *
 * The frontend sends the signed-in Clerk user id (verified by Clerk in the
 * browser). The id is never trusted blindly: the row in profiles is
 * created on first use, and every endpoint scopes its queries by this id.
 *
 * NOTE: For production hardening, verify the Clerk session token
 * server-side via Clerk's API instead of trusting the id from the client.
 */
function require_user_id(): string
{
    $userId = str_or_empty($_GET['user_id'] ?? ($_POST['user_id'] ?? null));

    if ($userId === '') {
        $body = request_json();
        $userId = str_or_empty($body['user_id'] ?? null);
    }

    if ($userId === '' || !preg_match('/^[A-Za-z0-9_]+$/', $userId)) {
        json_response(['error' => 'Missing or invalid user_id.'], 401);
    }

    return $userId;
}

/** Fetch the profile row, creating an empty one on first use (like Clerk). */
function ensure_profile(string $userId): array
{
    $db = get_db();
    $stmt = $db->prepare('SELECT * FROM profiles WHERE user_id = :uid');
    $stmt->execute(['uid' => $userId]);
    $row = $stmt->fetch();

    if (!$row) {
        $db->prepare('INSERT INTO profiles (user_id) VALUES (:uid)')
           ->execute(['uid' => $userId]);

        $stmt->execute(['uid' => $userId]);
        $row = $stmt->fetch();
    }

    // Decode JSON columns so the client treats them as arrays.
    foreach (['dietary_preferences', 'disliked_ingredients', 'nutrition_goals'] as $col) {
        if (isset($row[$col]) && is_string($row[$col])) {
            $row[$col] = json_decode($row[$col], true) ?: [];
        }
    }

    return $row;
}

/** Normalize a JSON-ish field into a JSON string (or a default). */
function json_col($value): string
{
    return is_array($value) ? json_encode($value) : '[]';
}
