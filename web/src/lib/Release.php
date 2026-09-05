<?php
declare(strict_types=1);

/**
 * The latest published Windows release.
 *
 * Looked up rather than written down: the asset filename carries the version,
 * so a hardcoded URL has to be edited on every release, and forgetting once
 * quietly serves an old build. The version shown on the page had drifted the
 * same way — it read "v0.1" while 0.2.0 was current.
 *
 * The answer is cached for an hour. GitHub rate-limits unauthenticated calls,
 * and a download button that starts failing because a limit was reached would
 * be very hard to explain.
 */
final class Release
{
    private const CACHE_TTL = 3600;

    /** @var array{url:string,tag:string}|null|false false = not looked up yet */
    private static $memo = false;

    /** Direct download URL of the newest installer, or null. */
    public static function url(): ?string
    {
        $r = self::fetch();
        return $r['url'] ?? null;
    }

    /** Version string of the newest release (e.g. "0.2.0"), or null. */
    public static function version(): ?string
    {
        $r = self::fetch();
        if (empty($r['tag'])) {
            return null;
        }
        return ltrim((string) $r['tag'], 'vV');
    }

    /** @return array{url:string,tag:string}|null */
    private static function fetch(): ?array
    {
        if (self::$memo !== false) {
            return self::$memo;
        }

        $cache = STORAGE_DIR . '/latest-release.json';

        if (is_readable($cache) && (time() - (int) filemtime($cache)) < self::CACHE_TTL) {
            $c = json_decode((string) file_get_contents($cache), true);
            if (is_array($c) && !empty($c['url'])) {
                return self::$memo = ['url' => (string) $c['url'], 'tag' => (string) ($c['tag'] ?? '')];
            }
        }

        $fresh = self::askGitHub();
        if ($fresh !== null) {
            @file_put_contents($cache, json_encode($fresh + ['at' => time()]));
            return self::$memo = $fresh;
        }

        // Lookup failed. A stale cached entry still points at a real installer,
        // and an older version is far better than a dead button.
        if (is_readable($cache)) {
            $c = json_decode((string) file_get_contents($cache), true);
            if (is_array($c) && !empty($c['url'])) {
                return self::$memo = ['url' => (string) $c['url'], 'tag' => (string) ($c['tag'] ?? '')];
            }
        }

        return self::$memo = null;
    }

    /** @return array{url:string,tag:string}|null */
    private static function askGitHub(): ?array
    {
        if (!defined('RELEASE_REPO') || RELEASE_REPO === '') {
            return null;
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

        if (!is_array($data) || empty($data['assets'])) {
            return null;
        }

        foreach ($data['assets'] as $a) {
            if (isset($a['name'], $a['browser_download_url'])
                && str_ends_with((string) $a['name'], '.exe')) {
                return [
                    'url' => (string) $a['browser_download_url'],
                    'tag' => (string) ($data['tag_name'] ?? ''),
                ];
            }
        }

        return null;
    }
}
