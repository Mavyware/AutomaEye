<?php
/**
 * Handoff to the desktop app.
 *
 * Why this page is needed instead of a direct 302 redirect to automaeye://
 * Many browsers block (or silently ignore) a server redirect to a custom
 * protocol scheme. A reliable launch needs navigation from within the page
 * — ideally the result of a user click. So this page tries automatically
 * once, and still provides a manual button in case the browser blocks it.
 */
require __DIR__ . '/../../src/bootstrap.php';

$redirect = sanitize_app_redirect($_GET['redirect'] ?? null);
$token = (string) ($_GET['token'] ?? '');

if (!$redirect || $token === '') {
    flash('error', 'Tautan pembuka aplikasi tidak valid.');
    redirect('/login.php');
}

$sep = str_contains($redirect, '?') ? '&' : '?';
$appUrl = $redirect . $sep . 'token=' . urlencode($token);

$pageTitle = 'Membuka AutomaEyes — AutomaEyes';
require __DIR__ . '/../../src/includes/header.php';
?>
<main class="auth-shell">
  <div class="auth-card">
    <h1>Membuka AutomaEyes</h1>
    <p class="sub">Aplikasi desktop sedang dibuka. Jika muncul konfirmasi dari browser, pilih <strong>Open AutomaEyes</strong>.</p>

    <a class="btn btn-primary btn-block btn-lg" id="openApp" href="<?= e($appUrl) ?>">Buka AutomaEyes</a>

    <p class="foot-note" style="margin-top:18px">
      Sudah terbuka? Tab ini boleh ditutup.<br>
      Aplikasi tidak terbuka? Pastikan AutomaEyes sudah terpasang dan berjalan, lalu klik tombol di atas.
    </p>
    <p class="foot-note"><a href="/welcome.php">Kembali ke halaman akun</a></p>
  </div>
</main>
<script>
  // One automatic attempt. The token is only valid for 5 minutes, so this
  // isn't retried repeatedly — if it fails, the user uses the button above.
  setTimeout(function () {
    window.location.href = document.getElementById('openApp').href;
  }, 400);
</script>
<?php require __DIR__ . '/../../src/includes/footer.php'; ?>
