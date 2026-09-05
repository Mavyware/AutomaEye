<?php
require __DIR__ . '/../src/bootstrap.php';

$redirect = sanitize_app_redirect($_GET['redirect'] ?? $_POST['redirect'] ?? null);
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verify_csrf()) {
        $error = 'Your session expired. Please try again.';
    } elseif (!empty($_POST['continue_as'])) {
        // "Continue as ..." confirmation from the desktop app flow: the
        // session already exists, just issue a one-time token.
        $current = Auth::user();
        if ($current && $redirect) {
            redirect(app_handoff_url($redirect, Auth::issueAppToken($current)));
        }
        $error = 'Sesi tidak ditemukan. Silakan login lagi.';
    } else {
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if ($email === '' || $password === '') {
            $error = 'Enter your email and password.';
        } else {
            $user = Auth::attempt($email, $password);
            if (!$user) {
                $error = 'Those credentials don\'t match an account.';
            } else {
                Auth::login($user);
                if ($redirect) {
                    redirect(app_handoff_url($redirect, Auth::issueAppToken($user)));
                }
                redirect('/welcome.php');
            }
        }
    }
    set_old(['email' => $_POST['email'] ?? '']);
}

// Already logged in on the browser. For a normal web login go straight to
// welcome.php; for the desktop app flow, show a "continue as ..."
// confirmation so it's clear which account is being used and it can be switched.
$appUser = null;
if (Auth::check() && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    if (!$redirect) {
        redirect('/welcome.php');
    }
    $appUser = Auth::user();
}

if (!$error) {
    $error = flash('error');
}

$pageTitle = $redirect ? 'Buka AutomaEyes Desktop — AutomaEyes' : 'Log in — AutomaEyes';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>
<main class="auth-shell">
  <div class="auth-card">

<?php if ($appUser): /* Already logged in + came from the desktop app */ ?>
    <h1>Buka AutomaEyes Desktop</h1>
    <p class="sub">Aplikasi desktop meminta akses ke akun Anda.</p>

    <div class="alert alert-success" style="text-align:left">
      Masuk sebagai <strong><?= e($appUser['name']) ?></strong><br>
      <span class="link-muted"><?= e($appUser['email']) ?></span>
    </div>

    <form method="post" novalidate>
      <?= csrf_field() ?>
      <input type="hidden" name="redirect" value="<?= e($redirect) ?>">
      <input type="hidden" name="continue_as" value="1">
      <button type="submit" class="btn btn-primary btn-block btn-lg">Lanjutkan sebagai <?= e(explode(' ', $appUser['name'])[0]) ?></button>
    </form>

    <p class="foot-note" style="margin-top:16px">
      Bukan akun ini? <a href="/logout.php?next=<?= urlencode('/login.php?redirect=' . urlencode($redirect)) ?>">Pakai akun lain</a>
    </p>

<?php else: ?>
    <?php if ($redirect): ?>
      <h1>Buka AutomaEyes Desktop</h1>
      <p class="sub">Masuk untuk menghubungkan akun Anda ke aplikasi desktop.</p>
    <?php else: ?>
      <h1>Welcome back</h1>
      <p class="sub">Log in to download the app and manage your account.</p>
    <?php endif; ?>

    <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>
    <?php if ($msg = flash('success')): ?><div class="alert alert-success"><?= e($msg) ?></div><?php endif; ?>

    <div class="social-row">
      <a class="btn btn-social btn-block<?= GOOGLE_CLIENT_ID ? '' : ' is-disabled' ?>" href="/auth/google.php?<?= $redirect ? 'redirect=' . urlencode($redirect) : '' ?>">Continue with Google</a>
      <a class="btn btn-social btn-block<?= GITHUB_CLIENT_ID ? '' : ' is-disabled' ?>" href="/auth/github.php?<?= $redirect ? 'redirect=' . urlencode($redirect) : '' ?>">Continue with GitHub</a>
    </div>
    <div class="divider">or</div>

    <form method="post" novalidate>
      <?= csrf_field() ?>
      <?php if ($redirect): ?><input type="hidden" name="redirect" value="<?= e($redirect) ?>"><?php endif; ?>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" value="<?= old('email') ?>" required autofocus>
      </div>
      <div class="field">
        <div class="field-row">
          <label for="password">Password</label>
          <a class="link-muted" href="/forgot-password.php">Forgot password?</a>
        </div>
        <input type="password" id="password" name="password" required>
      </div>
      <button type="submit" class="btn btn-primary btn-block btn-lg">Log in</button>
    </form>

    <p class="foot-note">Don't have an account? <a href="/signup.php<?= $redirect ? '?redirect=' . urlencode($redirect) : '' ?>">Sign up</a></p>
<?php endif; ?>
  </div>
</main>
<?php clear_old(); require __DIR__ . '/../src/includes/footer.php'; ?>
