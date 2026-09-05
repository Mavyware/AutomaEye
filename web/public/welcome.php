<?php
require __DIR__ . '/../src/bootstrap.php';

if (!Auth::check()) {
    redirect('/login.php');
}
$user = Auth::user();

$pageTitle = 'You\'re logged in — AutomaEyes';
require __DIR__ . '/../src/includes/header.php';
?>
<canvas id="story-bg"></canvas>
<main class="auth-shell">
  <div class="auth-card" style="text-align:center; max-width: 480px;">
    <h1>You're logged in, <?= e(explode(' ', $user['name'])[0] ?: $user['name']) ?>.</h1>
    <p class="sub">If AutomaEyes sent you here, switch back to the app — it'll pick up your session automatically. Otherwise, grab the desktop app below.</p>
    <div class="social-row">
      <a class="btn btn-primary btn-block btn-lg" href="<?= e(DOWNLOAD_PAGE) ?>">Download for Windows</a>
      <a class="btn btn-ghost btn-block" href="/logout.php">Log out</a>
    </div>
  </div>
</main>
<?php require __DIR__ . '/../src/includes/footer.php'; ?>
