<?php
declare(strict_types=1);

final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        self::$pdo = DB_HOST !== '' ? self::connectMysql() : self::connectSqlite();

        return self::$pdo;
    }

    private static function connectMysql(): PDO
    {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS users (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(190) NOT NULL,
                email VARCHAR(190) NOT NULL UNIQUE,
                password_hash VARCHAR(255),
                provider VARCHAR(20) NOT NULL DEFAULT 'local',
                provider_id VARCHAR(190),
                avatar_url VARCHAR(500),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        SQL);

        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS password_resets (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(190) NOT NULL,
                token_hash VARCHAR(64) NOT NULL,
                expires_at DATETIME NOT NULL,
                used TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_password_resets_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        SQL);

        return $pdo;
    }

    private static function connectSqlite(): PDO
    {
        if (!is_dir(STORAGE_DIR)) {
            mkdir(STORAGE_DIR, 0775, true);
        }

        $dbFile = STORAGE_DIR . '/database.sqlite';
        $isNew = !file_exists($dbFile);

        $pdo = new PDO('sqlite:' . $dbFile);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');

        if ($isNew) {
            self::migrateSqlite($pdo);
        }

        return $pdo;
    }

    private static function migrateSqlite(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT,
                provider TEXT NOT NULL DEFAULT 'local',
                provider_id TEXT,
                avatar_url TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        SQL);

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email)');
    }
}
