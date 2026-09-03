<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

define('ROOT_DIR', dirname(__DIR__));
define('STORAGE_DIR', ROOT_DIR . '/storage');

if (file_exists(ROOT_DIR . '/config.local.php')) {
    require ROOT_DIR . '/config.local.php';
}

// --- App config (override via config.local.php in production) ---
defined('APP_NAME') || define('APP_NAME', 'AutomaEye');
defined('APP_URL') || define('APP_URL', 'http://localhost:8000');
defined('APP_SCHEME') || define('APP_SCHEME', 'automaeye'); // automaeye://auth?token=...
defined('DOWNLOAD_URL') || define('DOWNLOAD_URL', '#'); // Windows installer URL

// --- Database. Empty DB_HOST falls back to a local SQLite file under storage/. ---
defined('DB_HOST') || define('DB_HOST', '');
defined('DB_NAME') || define('DB_NAME', '');
defined('DB_USER') || define('DB_USER', '');
defined('DB_PASS') || define('DB_PASS', '');

defined('GOOGLE_CLIENT_ID') || define('GOOGLE_CLIENT_ID', '');
defined('GOOGLE_CLIENT_SECRET') || define('GOOGLE_CLIENT_SECRET', '');
defined('GITHUB_CLIENT_ID') || define('GITHUB_CLIENT_ID', '');
defined('GITHUB_CLIENT_SECRET') || define('GITHUB_CLIENT_SECRET', '');

// --- Mail (hosting mailbox SMTP, same pattern as other Code8Byte client sites:
// mail.<domain>:587 STARTTLS with a noreply@<domain> mailbox). MAIL_MAILER=log
// keeps local dev working without real credentials.
defined('MAIL_MAILER') || define('MAIL_MAILER', 'log'); // 'smtp' or 'log'
defined('MAIL_HOST') || define('MAIL_HOST', '');
defined('MAIL_PORT') || define('MAIL_PORT', 587);
defined('MAIL_USERNAME') || define('MAIL_USERNAME', '');
defined('MAIL_PASSWORD') || define('MAIL_PASSWORD', '');
defined('MAIL_ENCRYPTION') || define('MAIL_ENCRYPTION', 'tls'); // 'tls' or 'ssl'
defined('MAIL_FROM_ADDRESS') || define('MAIL_FROM_ADDRESS', 'noreply@automaeyes.local');
defined('MAIL_FROM_NAME') || define('MAIL_FROM_NAME', APP_NAME);

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'samesite' => 'Lax',
    ]);
    session_start();
}

if (file_exists(ROOT_DIR . '/vendor/autoload.php')) {
    require ROOT_DIR . '/vendor/autoload.php';
}

require_once __DIR__ . '/lib/Database.php';
require_once __DIR__ . '/lib/Auth.php';
require_once __DIR__ . '/lib/OAuth.php';
require_once __DIR__ . '/lib/Mailer.php';
require_once __DIR__ . '/lib/helpers.php';
