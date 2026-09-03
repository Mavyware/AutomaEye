<?php
require __DIR__ . '/../src/bootstrap.php';

$redirect = sanitize_app_redirect($_GET['redirect'] ?? $_POST['redirect'] ?? null);
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verify_csrf()) {
        $error = 'Your session expired. Please try again.';
    } else {
        $name = trim((string) ($_POST['name'] ?? ''));
        $email = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if ($name === '' || $email === '' || $password === '') {
            $error = 'Fill in your name, email, and password.';
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $error = 'Enter a valid email address.';
        } elseif (strlen($password) < 8) {
            $error = 'Password must be at least 8 characters.';
        } elseif (Auth::findByEmail($email)) {
            $error = 'An account with that email already exists.';
        } else {
            $user = Auth::register($name, $email, $password);
            Auth::login($user);
            if ($redirect) {
                redirect(app_handoff_url($redirect, Auth::issueAppToken($user)));
            }
            redirect('/welcome.php');
        }
        set_old(['name' => $name, 'email' => $email]);
    }
}

$pageTitle = 'Sign up — AutomaEye';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>
<main class="auth-shell">
  <div class="auth-card">
    <h1>Create your account</h1>
    <p class="sub">Build pipelines, connect your GitHub, and deploy to the edge.</p>

    <?php if ($error): ?><div class="alert alert-error"><?= e($error) ?></div><?php endif; ?>

    <div class="social-row">
      <a class="btn btn-social btn-block<?= GOOGLE_CLIENT_ID ? '' : ' is-disabled' ?>" href="/auth/google.php?<?= $redirect ? 'redirect=' . urlencode($redirect) : '' ?>">Continue with Google</a>
      <a class="btn btn-social btn-block<?= GITHUB_CLIENT_ID ? '' : ' is-disabled' ?>" href="/auth/github.php?<?= $redirect ? 'redirect=' . urlencode($redirect) : '' ?>">Continue with GitHub</a>
    </div>
    <div class="divider">or</div>

    <form method="post" novalidate>
      <?= csrf_field() ?>
      <?php if ($redirect): ?><input type="hidden" name="redirect" value="<?= e($redirect) ?>"><?php endif; ?>
      <div class="field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" value="<?= old('name') ?>" required autofocus>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" value="<?= old('email') ?>" required>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" minlength="8" required>
      </div>
      <button type="submit" class="btn btn-primary btn-block btn-lg">Create account</button>
    </form>

    <p class="foot-note">Already have an account? <a href="/login.php<?= $redirect ? '?redirect=' . urlencode($redirect) : '' ?>">Log in</a></p>
  </div>
</main>
<?php clear_old(); require __DIR__ . '/../src/includes/footer.php'; ?>
