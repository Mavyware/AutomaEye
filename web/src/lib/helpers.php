<?php
declare(strict_types=1);

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . htmlspecialchars(csrf_token(), ENT_QUOTES) . '">';
}

function verify_csrf(): bool
{
    $token = $_POST['_csrf'] ?? '';
    return is_string($token) && !empty($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

function flash(string $key, ?string $message = null): ?string
{
    if ($message !== null) {
        $_SESSION['flash'][$key] = $message;
        return null;
    }
    $value = $_SESSION['flash'][$key] ?? null;
    unset($_SESSION['flash'][$key]);
    return $value;
}

function old(string $key): string
{
    $value = $_SESSION['old'][$key] ?? '';
    return e((string) $value);
}

function set_old(array $data): void
{
    $_SESSION['old'] = $data;
}

function clear_old(): void
{
    unset($_SESSION['old']);
}

/** Safe redirect target for the desktop app deep link (?redirect=automaeye://...) */
/**
 * URL halaman serah-terima ke aplikasi desktop.
 *
 * Selalu lewat /auth/handoff.php, jangan langsung ke automaeye://, karena
 * redirect server ke custom scheme sering diblokir browser.
 */
function app_handoff_url(string $redirect, string $token): string
{
    return '/auth/handoff.php?redirect=' . urlencode($redirect) . '&token=' . urlencode($token);
}

function sanitize_app_redirect(?string $redirect): ?string
{
    if (!$redirect) {
        return null;
    }
    $parts = parse_url($redirect);
    if (!$parts || ($parts['scheme'] ?? '') !== APP_SCHEME) {
        return null;
    }
    return $redirect;
}
