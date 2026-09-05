<?php
/**
 * Exchange a handoff code for a GitHub access token.
 *
 * The desktop app receives this code via the automaeye://github deep link
 * after the user presses Authorize on GitHub. The actual token is encrypted
 * inside that code and only the server can decrypt it — the server itself
 * never stores it anywhere.
 */
require __DIR__ . '/../../src/bootstrap.php';

header('Content-Type: application/json');

$handoff = (string) ($_POST['handoff'] ?? $_GET['handoff'] ?? '');
if ($handoff === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing handoff code.']);
    exit;
}

$data = Auth::consumeGithubHandoff($handoff);
if (!$data) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Handoff code is invalid or has expired.']);
    exit;
}

echo json_encode(['ok' => true, 'token' => $data['token'], 'login' => $data['login']]);
