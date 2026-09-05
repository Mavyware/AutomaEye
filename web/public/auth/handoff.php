<?php
/**
 * Serah-terima ke aplikasi desktop.
 *
 * Kenapa perlu halaman ini, bukan redirect 302 langsung ke automaeye://
 * Banyak browser memblokir (atau diam-diam mengabaikan) redirect dari server
 * menuju custom protocol scheme. Peluncuran yang andal butuh navigasi dari
 * dalam halaman — idealnya hasil klik user. Jadi halaman ini mencoba otomatis
 * sekali, lalu tetap menyediakan tombol manual kalau browser menahannya.
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
  // Percobaan otomatis sekali. Token hanya berlaku 5 menit, jadi tidak
  // diulang terus-menerus — kalau gagal, user memakai tombol di atas.
  setTimeout(function () {
    window.location.href = document.getElementById('openApp').href;
  }, 400);
</script>
<?php require __DIR__ . '/../../src/includes/footer.php'; ?>
