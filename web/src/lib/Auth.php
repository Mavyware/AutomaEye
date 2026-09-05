<?php
declare(strict_types=1);

final class Auth
{
    public static function findByEmail(string $email): ?array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM users WHERE email = :email');
        $stmt->execute(['email' => strtolower(trim($email))]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public static function findById(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public static function register(string $name, string $email, string $password): array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO users (name, email, password_hash, provider) VALUES (:name, :email, :hash, :provider)'
        );
        $stmt->execute([
            'name' => trim($name),
            'email' => strtolower(trim($email)),
            'hash' => password_hash($password, PASSWORD_DEFAULT),
            'provider' => 'local',
        ]);

        return self::findById((int) $pdo->lastInsertId());
    }

    public static function findOrCreateFromProvider(string $provider, string $providerId, string $name, string $email, ?string $avatarUrl = null): array
    {
        $existing = self::findByEmail($email);
        if ($existing) {
            return $existing;
        }

        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO users (name, email, provider, provider_id, avatar_url) VALUES (:name, :email, :provider, :provider_id, :avatar_url)'
        );
        $stmt->execute([
            'name' => $name,
            'email' => strtolower(trim($email)),
            'provider' => $provider,
            'provider_id' => $providerId,
            'avatar_url' => $avatarUrl,
        ]);

        return self::findById((int) $pdo->lastInsertId());
    }

    public static function attempt(string $email, string $password): ?array
    {
        $user = self::findByEmail($email);
        if (!$user || !$user['password_hash'] || !password_verify($password, $user['password_hash'])) {
            return null;
        }
        return $user;
    }

    public static function login(array $user): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
    }

    public static function logout(): void
    {
        $_SESSION = [];
        session_regenerate_id(true);
    }

    public static function user(): ?array
    {
        if (empty($_SESSION['user_id'])) {
            return null;
        }

        $user = self::findById((int) $_SESSION['user_id']);

        // A session pointing at a user that no longer exists would leave the
        // page in two minds: check() says signed in, user() says nobody, and
        // the header and the hero disagree on the same screen. Treat it as
        // signed out, which is what it actually is.
        if ($user === null) {
            unset($_SESSION['user_id']);
        }

        return $user;
    }

    public static function check(): bool
    {
        return !empty($_SESSION['user_id']);
    }

    public static function issueAppToken(array $user): string
    {
        // Short-lived signed token the desktop app exchanges for a session.
        // HMAC over user id + expiry, keyed by a server secret derived from the session.
        $secret = self::appSecret();
        $expires = time() + 300;
        $payload = $user['id'] . '.' . $expires;
        $signature = hash_hmac('sha256', $payload, $secret);
        return base64_encode($payload . '.' . $signature);
    }

    /**
     * Verifies a token produced by issueAppToken() and returns the user, or
     * null when the token is malformed, tampered with, or past its 5-minute
     * expiry. The desktop app calls this via /api/verify.php right after it
     * receives the automaeye://auth deep link.
     *
     * @return array|null
     */
    public static function verifyAppToken(string $token): ?array
    {
        $decoded = base64_decode($token, true);
        if ($decoded === false) {
            return null;
        }

        $parts = explode('.', $decoded);
        if (count($parts) !== 3) {
            return null;
        }
        [$userId, $expires, $signature] = $parts;

        $expected = hash_hmac('sha256', $userId . '.' . $expires, self::appSecret());
        if (!hash_equals($expected, $signature)) {
            return null;
        }
        if ((int) $expires < time()) {
            return null;
        }

        return self::findById((int) $userId);
    }

    /**
     * Wraps a GitHub access token for handoff to the desktop app.
     *
     * A repo-scoped GitHub token is too valuable to pass raw in a URL (it
     * could end up stored in browser history). So it's encrypted with a
     * server key, signed, and only valid for 5 minutes — the app exchanges
     * it via /api/github-token.php. The server never stores this token at
     * all; it only passes through.
     */
    public static function issueGithubHandoff(string $ghToken, string $login): string
    {
        $secret = self::appSecret();
        $expires = time() + 300;
        $payload = json_encode(['t' => $ghToken, 'l' => $login, 'e' => $expires]);

        $iv = random_bytes(16);
        $cipher = openssl_encrypt($payload, 'aes-256-cbc', hash('sha256', $secret, true), OPENSSL_RAW_DATA, $iv);
        $blob = $iv . $cipher;
        $sig = hash_hmac('sha256', $blob, $secret, true);

        return rtrim(strtr(base64_encode($sig . $blob), '+/', '-_'), '=');
    }

    /** @return array{token:string,login:string}|null */
    public static function consumeGithubHandoff(string $handoff): ?array
    {
        $raw = base64_decode(strtr($handoff, '-_', '+/'), true);
        if ($raw === false || strlen($raw) < 32 + 16 + 1) {
            return null;
        }

        $secret = self::appSecret();
        $sig = substr($raw, 0, 32);
        $blob = substr($raw, 32);
        if (!hash_equals(hash_hmac('sha256', $blob, $secret, true), $sig)) {
            return null;
        }

        $iv = substr($blob, 0, 16);
        $cipher = substr($blob, 16);
        $json = openssl_decrypt($cipher, 'aes-256-cbc', hash('sha256', $secret, true), OPENSSL_RAW_DATA, $iv);
        if ($json === false) {
            return null;
        }

        $data = json_decode($json, true);
        if (!is_array($data) || empty($data['t']) || (int) ($data['e'] ?? 0) < time()) {
            return null;
        }
        return ['token' => (string) $data['t'], 'login' => (string) ($data['l'] ?? '')];
    }

    private static function appSecret(): string
    {
        $keyFile = STORAGE_DIR . '/app_secret.key';
        if (!file_exists($keyFile)) {
            file_put_contents($keyFile, bin2hex(random_bytes(32)));
            chmod($keyFile, 0600);
        }
        return trim((string) file_get_contents($keyFile));
    }
}
