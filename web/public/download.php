<?php
/**
 * Windows installer download.
 *
 * The button on the site points here instead of at a GitHub release page, so
 * the download starts straight away. Sending people to GitHub means one more
 * page to read and a list of files to pick from — for a shop-floor operator
 * that is a place to get stuck, not a convenience.
 *
 * Two sources, in order:
 *
 *   1. A file hosted next to the site (public/releases/*.exe). Streamed from
 *      here, so the download never leaves automaeyes.my.id.
 *   2. The GitHub release asset, as a redirect. Used when the installer is not
 *      hosted locally — still a direct download, no page in between.
 *
 * The newest file wins when several are present, so publishing a release is
 * just dropping the new .exe in; nothing here needs editing.
 */
require __DIR__ . '/../src/bootstrap.php';

const RELEASE_DIR = __DIR__ . '/releases';

/** Newest AutomaEyes-Setup-*.exe in public/releases, or null. */
function localInstaller(): ?string
{
    if (!is_dir(RELEASE_DIR)) {
        return null;
    }
    $found = glob(RELEASE_DIR . '/AutomaEyes-Setup-*.exe') ?: [];
    if (!$found) {
        return null;
    }
    // Sort by version, not by name: "0.10.0" must beat "0.9.0", and a plain
    // string sort gets that backwards.
    usort($found, static function (string $a, string $b): int {
        return version_compare(versionOf($b), versionOf($a));
    });

    return $found[0];
}

function versionOf(string $path): string
{
    return preg_match('/AutomaEyes-Setup-([0-9.]+)\.exe$/', basename($path), $m) ? $m[1] : '0';
}

/**
 * URL of the newest installer published on GitHub.
 *
 * Looked up rather than hardcoded: the asset filename carries the version, so
 * a fixed URL would have to be edited on every release, and forgetting once
 * quietly serves an old build.
 *
 * The answer is cached for an hour. GitHub rate-limits unauthenticated calls,
 * and a download button that starts failing because a limit was reached would
 * be very hard to explain.
 */
function latestAssetUrl(): ?string
{
    $cache = STORAGE_DIR . '/latest-release.json';

    if (is_readable($cache) && (time() - (int) filemtime($cache)) < 3600) {
        $c = json_decode((string) file_get_contents($cache), true);
        if (is_array($c) && !empty($c['url'])) {
            return (string) $c['url'];
        }
    }

    $ctx = stream_context_create(['http' => [
        'method' => 'GET',
        'timeout' => 6,
        // GitHub rejects requests without a User-Agent.
        'header' => "User-Agent: AutomaEyes-Site\r\nAccept: application/vnd.github+json\r\n",
        'ignore_errors' => true,
    ]]);

    $raw = @file_get_contents(
        'https://api.github.com/repos/' . RELEASE_REPO . '/releases/latest',
        false,
        $ctx
    );
    $data = $raw === false ? null : json_decode($raw, true);

    if (is_array($data) && !empty($data['assets'])) {
        foreach ($data['assets'] as $a) {
            if (isset($a['name'], $a['browser_download_url'])
                && str_ends_with((string) $a['name'], '.exe')) {
                $url = (string) $a['browser_download_url'];
                @file_put_contents($cache, json_encode(['url' => $url, 'at' => time()]));
                return $url;
            }
        }
    }

    // Lookup failed. A stale cached URL still points at a real installer, and
    // an older version is far better than a dead button.
    if (is_readable($cache)) {
        $c = json_decode((string) file_get_contents($cache), true);
        if (is_array($c) && !empty($c['url'])) {
            return (string) $c['url'];
        }
    }

    return null;
}

$file = localInstaller();

if ($file === null) {
    // Nothing hosted here — hand the browser straight to the release asset.
    $url = latestAssetUrl()
        ?? (defined('DOWNLOAD_URL') && DOWNLOAD_URL !== '#' ? DOWNLOAD_URL : '');

    if ($url === '') {
        http_response_code(503);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><title>Download unavailable</title>'
            . '<p style="font:14px system-ui;padding:24px">The Windows installer is not available '
            . 'right now. Please try again shortly.</p>';
        exit;
    }

    header('Location: ' . $url, true, 302);
    exit;
}

// Serve the local file as a download.
$name = basename($file);
$size = filesize($file);

// A stale cached copy would hand out an old installer, so revalidate every time.
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . $size);
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-cache, must-revalidate');

// Clear any buffering first: a 90 MB file must not be built up in memory.
while (ob_get_level() > 0) {
    ob_end_clean();
}
readfile($file);
