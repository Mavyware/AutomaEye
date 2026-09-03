<?php
/**
 * Tukar kode serah-terima jadi access token GitHub.
 *
 * Aplikasi desktop menerima kode ini lewat deep link automaeye://github
 * setelah user menekan Authorize di GitHub. Token aslinya terenkripsi di
 * dalam kode tersebut dan hanya server yang bisa membukanya — server sendiri
 * tidak menyimpannya di mana pun.
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
