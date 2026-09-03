<?php
require __DIR__ . '/../../src/bootstrap.php';

if (!GOOGLE_CLIENT_ID) {
    flash('error', 'Google sign-in is not configured yet.');
    redirect('/login.php');
}

$redirect = sanitize_app_redirect($_GET['redirect'] ?? null);
$state = OAuth::state('google', $redirect);

$params = http_build_query([
    'client_id' => GOOGLE_CLIENT_ID,
    'redirect_uri' => APP_URL . '/auth/callback.php?provider=google',
    'response_type' => 'code',
    'scope' => 'openid email profile',
    'state' => $state,
    'prompt' => 'select_account',
]);

redirect('https://accounts.google.com/o/oauth2/v2/auth?' . $params);
