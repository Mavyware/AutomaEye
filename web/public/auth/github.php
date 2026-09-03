<?php
require __DIR__ . '/../../src/bootstrap.php';

if (!GITHUB_CLIENT_ID) {
    // Jangan dilempar ke /login.php: kalau sesi web masih hidup, user akan
    // terus dilempar lagi ke /welcome.php dan mendarat di halaman Download —
    // sama sekali tidak menjelaskan bahwa ini salah konfigurasi server.
    $pageTitle = 'GitHub belum dikonfigurasi — AutomaEye';
    require __DIR__ . '/../../src/includes/header.php';
    ?>
    <main class="auth-shell">
      <div class="auth-card">
        <h1>GitHub belum dikonfigurasi</h1>
        <p class="sub">Sambungan ke GitHub belum bisa dipakai karena server belum punya kredensial OAuth.</p>
        <div class="alert alert-error" style="text-align:left">
          <code>GITHUB_CLIENT_ID</code> dan <code>GITHUB_CLIENT_SECRET</code> masih kosong
          di <code>config.local.php</code>.
        </div>
        <p class="foot-note" style="text-align:left">
          Untuk administrator: daftarkan OAuth App di
          GitHub &rarr; Settings &rarr; Developer settings &rarr; OAuth Apps, dengan callback
          <code><?= e(APP_URL) ?>/auth/callback.php?provider=github</code>,
          lalu isikan Client ID &amp; Secret-nya di <code>config.local.php</code>.
        </p>
        <p class="foot-note"><a href="/welcome.php">Kembali ke halaman akun</a></p>
      </div>
    </main>
    <?php
    require __DIR__ . '/../../src/includes/footer.php';
    exit;
}

$redirect = sanitize_app_redirect($_GET['redirect'] ?? null);

// purpose=repo: permintaan dari aplikasi desktop untuk menyimpan project ke
// repo milik user, jadi butuh scope 'repo'. Login web biasa tetap minta izin
// seminimal mungkin — jangan pernah minta akses repo hanya untuk login.
$purpose = (($_GET['purpose'] ?? '') === 'repo' && $redirect) ? 'repo' : 'login';
$scope = $purpose === 'repo' ? 'repo read:user user:email' : 'read:user user:email';

$state = OAuth::state('github', $redirect, $purpose);

$params = http_build_query([
    'client_id' => GITHUB_CLIENT_ID,
    'redirect_uri' => APP_URL . '/auth/callback.php?provider=github',
    'scope' => $scope,
    'state' => $state,
]);

redirect('https://github.com/login/oauth/authorize?' . $params);
