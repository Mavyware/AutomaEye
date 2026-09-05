<?php
require __DIR__ . '/../src/bootstrap.php';

$email = trim((string) ($_GET['email'] ?? $_POST['email'] ?? ''));
$token = (string) ($_GET['token'] ?? $_POST['token'] ?? '');
$error = null;
$done = false;

function find_valid_reset(string $email, string $token): ?array
{
    $stmt = Database::connection()->prepare(
        'SELECT * FROM password_resets WHERE email = :email AND used = 0 AND expires_at >= :now ORDER BY id DESC LIMIT 1'
    );
    $stmt->execute(['email' => strtolower($email), 'now' => date('Y-m-d H:i:s')]);
    $reset = $stmt->fetch();
    if (!$reset || !hash_equals($reset['token_hash'], hash('sha256', $token))) {
        return null;
    }
    return $reset;
}

$valid = $email && $token ? find_valid_reset($email, $token) : null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verify_csrf()) {
        $error = 'Your session expired. Please try again.';
    } elseif (!$valid) {
        $error = 'This reset link is invalid or has expired.';
    } else {
        $password = (string) ($_POST['password'] ?? '');
        if (strlen($password) < 8) {
            $error = 'Password must be at least 8 characters.';
        } else {
            $pdo = Database::connection();
            $pdo->prepare('UPDATE users SET password_hash = :hash WHERE email = :email')
                ->execute(['hash' => password_hash($password, PASSWORD_DEFAULT), 'email' => strtolower($email)]);
            $pdo->prepare('UPDATE password_resets SET used = 1 WHERE id = :id')
                ->execute(['id' => $valid['id']]);
            $done = true;
        }
    }
}

$pageTitle = 'Set a new password — AutomaEyes';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>
<main class="auth-shell">
  <div class="auth-card">
    <h1>Set a new password</h1>
    <p class="sub">Choose something you haven't used before.</p>

    <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>

    <?php if ($done): ?>
      <div class="alert alert-success">Your password has been updated.</div>
      <p class="foot-note"><a href="/login.php">Continue to log in</a></p>
    <?php elseif (!$valid): ?>
      <div class="alert alert-error">This reset link is invalid or has expired.</div>
      <p class="foot-note"><a href="/forgot-password.php">Request a new link</a></p>
    <?php else: ?>
      <form method="post" novalidate>
        <?= csrf_field() ?>
        <input type="hidden" name="email" value="<?= e($email) ?>">
        <input type="hidden" name="token" value="<?= e($token) ?>">
        <div class="field">
          <label for="password">New password</label>
          <input type="password" id="password" name="password" minlength="8" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">Update password</button>
      </form>
    <?php endif; ?>
  </div>
</main>
<?php require __DIR__ . '/../src/includes/footer.php'; ?>
