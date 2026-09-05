<?php
require __DIR__ . '/../../src/bootstrap.php';

if (!GITHUB_CLIENT_ID) {
    // Don't redirect to /login.php: if the web session is still alive, the
    // user would keep getting bounced to /welcome.php and land on the
    // Download page — which wouldn't explain at all that this is a server
    // misconfiguration.
    $pageTitle = 'GitHub belum dikonfigurasi — AutomaEyes';
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

// purpose=repo: a request from the desktop app to save projects to the
// user's own repo, so it needs 'repo' scope. A normal web login still asks
// for the smallest permission possible — never request repo access just for logging in.
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
