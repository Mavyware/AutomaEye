<?php
require __DIR__ . '/../src/bootstrap.php';

$error = null;
$sent = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verify_csrf()) {
        $error = 'Your session expired. Please try again.';
    } else {
        $email = trim((string) ($_POST['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $error = 'Enter a valid email address.';
        } else {
            $user = Auth::findByEmail($email);
            if ($user) {
                $token = bin2hex(random_bytes(32));
                $stmt = Database::connection()->prepare(
                    'INSERT INTO password_resets (email, token_hash, expires_at) VALUES (:email, :hash, :expires)'
                );
                $stmt->execute([
                    'email' => $user['email'],
                    'hash' => hash('sha256', $token),
                    'expires' => date('Y-m-d H:i:s', time() + 3600),
                ]);

                $resetLink = APP_URL . '/reset-password.php?email=' . urlencode($user['email']) . '&token=' . $token;

                Mailer::sendPasswordReset($user['email'], $user['name'], $resetLink);
            }
            // Always show the same message, whether or not the account exists.
            $sent = true;
        }
    }
}

$pageTitle = 'Reset your password — AutomaEyes';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>
<main class="auth-shell">
  <div class="auth-card">
    <h1>Reset your password</h1>
    <p class="sub">We'll email you a link to get back into your account.</p>

    <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>
    <?php if ($sent): ?>
      <div class="alert alert-success">If that email has an account, a reset link is on its way.</div>
    <?php else: ?>
      <form method="post" novalidate>
        <?= csrf_field() ?>
        <div class="field">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required autofocus>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">Send reset link</button>
      </form>
    <?php endif; ?>

    <p class="foot-note"><a href="/login.php">Back to log in</a></p>
  </div>
</main>
<?php require __DIR__ . '/../src/includes/footer.php'; ?>
