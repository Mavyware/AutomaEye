<?php
/**
 * Versi aplikasi desktop terbaru.
 *
 * Dibaca aplikasi saat start untuk menentukan apakah user perlu memperbarui.
 * Sumbernya satu berkas JSON di server, supaya rilis baru cukup mengganti
 * berkas itu tanpa menyentuh kode.
 *
 * Bentuk balasan:
 *   { ok, version, minVersion, url, notes }
 *
 * version    : versi terbaru yang tersedia
 * minVersion : versi paling lama yang MASIH boleh dipakai. Aplikasi di bawah
 *              ini wajib memperbarui sebelum bisa dipakai - dipakai kalau ada
 *              perubahan yang membuat versi lama tidak lagi kompatibel
 *              (mis. format label atau alur login berubah).
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
    // Belum ada rilis yang diumumkan. Jangan menebak-nebak: balas apa adanya
    // supaya aplikasi tahu ini bukan "versi Anda kedaluwarsa".
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
