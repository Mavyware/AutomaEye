<?php
/**
 * Desktop-app token verification.
 *
 * The app receives a short-lived token via the automaeye://auth deep link
 * (issued by login.php / auth/callback.php) and posts it here to find out
 * who it belongs to. Only the server can check the HMAC, so this endpoint
 * is what turns that opaque token into a user identity for the app.
 */
require __DIR__ . '/../../src/bootstrap.php';

header('Content-Type: application/json');

$token = (string) ($_POST['token'] ?? $_GET['token'] ?? '');
if ($token === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing token.']);
    exit;
}

$user = Auth::verifyAppToken($token);
if (!$user) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Token is invalid or has expired.']);
    exit;
}

echo json_encode([
    'ok' => true,
    'user' => [
        'id' => (int) $user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'avatar_url' => $user['avatar_url'] ?? null,
    ],
]);
