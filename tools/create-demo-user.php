<?php
/**
 * MealPlan DSS — one-off script: create the demo Clerk user.
 *
 * Usage (from the project root on any PHP 8 setup, or via browser):
 *   php tools/create-demo-user.php <clerk_secret_key>
 * Or temporarily upload to the server and visit:
 *   https://mealplan-dss.jensentortega.online/tools/create-demo-user.php
 *   (pass the secret key via the ?key=... query param — then DELETE this file.)
 *
 * After the account exists, DELETE this file (it contains a live key).
 * Account credentials (shown on the auth screen):
 *   Email:    account@user.com
 *   Password: MealPlanDSS
 *
 * Requires: curl (built into PHP) and a valid Clerk secret key
 * (Clerk dashboard → API Keys → Secret Key, sk_test_...).
 */

declare(strict_types=1);

$apiBase = 'https://api.clerk.dev/v1/users';
$email    = 'account@user.com';
$password = 'MealPlanDSS';
$fullname = 'Demo User';

function fail(string $msg): void
{
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Error: $msg\n";
    exit;
}

function post_json(string $url, string $apiKey, array $payload): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT    => 15,
    ]);

    $raw  = curl_exec($ch);
    $err  = curl_error($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err !== '') {
        fail("cURL error: $err");
    }

    $decoded = json_decode((string) $raw, true) ?: [];
    if ($code < 200 || $code >= 300) {
        fail("Clerk API returned $code: " . json_encode($decoded));
    }

    return $decoded;
}

/* ---------- main ---------- */

$secretKey = $argv[1] ?? ($_GET['key'] ?? null);
if (!$secretKey) {
    fail('Pass the Clerk secret key: php tools/create-demo-user.php <key> (or ?key=... in browser)');
}

$nameParts = explode(' ', trim($fullname), 2);

$response = post_json($apiBase, $secretKey, [
    'email_address'   => [$email],
    'password'        => $password,
    'password_digest' => null, // let Clerk hash it
    'first_name'      => $nameParts[0] ?? 'Demo',
    'last_name'       => $nameParts[1] ?? 'User',
]);

// Note: email_verification is left at the default (Clerk does not send
// verification for this test environment when not enabled). The user can
// sign in immediately.
echo "Clerk demo user created.\n";
echo "  id:       " . ($response['id'] ?? '(unknown)') . "\n";
echo "  email:    $email\n";
echo "  password: $password\n";
echo "\nNext steps:\n";
echo "  1. DELETE this file (it holds a live secret key).\n";
echo "  2. In the Clerk dashboard, make sure email+password sign-in is enabled.\n";
echo "  3. Sign in on the live site with the credentials above.\n";
