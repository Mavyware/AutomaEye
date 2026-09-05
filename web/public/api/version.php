<?php
/**
 * Latest desktop app version.
 *
 * Read by the app at startup to determine whether the user needs to update.
 * The source is a single JSON file on the server, so a new release only
 * needs to replace that file without touching any code.
 *
 * Response shape:
 *   { ok, version, minVersion, url, notes }
 *
 * version    : the latest version available
 * minVersion : the oldest version that is STILL allowed to be used. An app
 *              below this must update before it can be used - used when
 *              there's a change that makes the old version no longer
 *              compatible (e.g. the label format or login flow changed).
 */
require __DIR__ . '/../../src/bootstrap.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');

$file = STORAGE_DIR . '/app-version.json';
$data = null;

if (is_readable($file)) {
    $data = json_decode((string) file_get_contents($file), true);
}

if (!is_array($data) || empty($data['version'])) {
    // No release has been announced yet. Don't guess: reply as-is so the
    // app knows this isn't "your version is out of date".
    echo json_encode([
        'ok' => false,
        'error' => 'Belum ada informasi rilis.',
    ]);
    exit;
}

echo json_encode([
    'ok' => true,
    'version' => (string) $data['version'],
    'minVersion' => (string) ($data['minVersion'] ?? $data['version']),
    'url' => (string) ($data['url'] ?? (defined('DOWNLOAD_URL') ? DOWNLOAD_URL : '')),
    'notes' => (string) ($data['notes'] ?? ''),
]);
