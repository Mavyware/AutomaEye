<?php
require __DIR__ . '/../../src/bootstrap.php';

$provider = (string) ($_GET['provider'] ?? '');
$code = (string) ($_GET['code'] ?? '');
$state = (string) ($_GET['state'] ?? '');

if (!in_array($provider, ['google', 'github'], true) || !$code || !$state) {
    flash('error', 'Sign-in was cancelled or invalid.');
    redirect('/login.php');
}

$stateData = OAuth::consumeStateFull($provider, $state);
$redirect = $stateData['redirect'] ?? null;
$purpose = $stateData['purpose'] ?? 'login';

try {
    if ($provider === 'google') {
        $token = OAuth::exchangeCode('https://oauth2.googleapis.com/token', [
            'client_id' => GOOGLE_CLIENT_ID,
            'client_secret' => GOOGLE_CLIENT_SECRET,
            'code' => $code,
            'redirect_uri' => APP_URL . '/auth/callback.php?provider=google',
            'grant_type' => 'authorization_code',
        ]);
        $profile = OAuth::get('https://www.googleapis.com/oauth2/v3/userinfo', $token['access_token']);
        $email = (string) ($profile['email'] ?? '');
        $name = (string) ($profile['name'] ?? $email);
        $providerId = (string) ($profile['sub'] ?? '');
        $avatar = $profile['picture'] ?? null;
    } else {
        $token = OAuth::exchangeCode('https://github.com/login/oauth/access_token', [
            'client_id' => GITHUB_CLIENT_ID,
            'client_secret' => GITHUB_CLIENT_SECRET,
            'code' => $code,
            'redirect_uri' => APP_URL . '/auth/callback.php?provider=github',
        ]);
        $profile = OAuth::get('https://api.github.com/user', $token['access_token']);
        $email = (string) ($profile['email'] ?? '');
        if (!$email) {
            $emails = OAuth::get('https://api.github.com/user/emails', $token['access_token']);
            foreach ($emails as $entry) {
                if (!empty($entry['primary'])) {
                    $email = (string) $entry['email'];
                    break;
                }
            }
        }
        $name = (string) ($profile['name'] ?: $profile['login'] ?? $email);
        $providerId = (string) ($profile['id'] ?? '');
        $avatar = $profile['avatar_url'] ?? null;
    }

    if (!$email || !$providerId) {
        throw new RuntimeException('Provider did not return an email address.');
    }

    // Permintaan akses repo dari aplikasi desktop: yang dibutuhkan aplikasi
    // adalah access token GitHub-nya, bukan sesi web. Diserahkan terenkripsi
    // lewat halaman handoff; server tidak menyimpan token ini.
    if ($purpose === 'repo' && $redirect && $provider === 'github') {
        $ghLogin = (string) ($profile['login'] ?? '');
        $handoff = Auth::issueGithubHandoff($token['access_token'], $ghLogin);
        redirect(app_handoff_url($redirect, $handoff));
    }

    $user = Auth::findOrCreateFromProvider($provider, $providerId, $name, $email, $avatar);
    Auth::login($user);

    if ($redirect) {
        redirect(app_handoff_url($redirect, Auth::issueAppToken($user)));
    }
    redirect('/welcome.php');
} catch (Throwable $e) {
    error_log('[AutomaEye] OAuth (' . $provider . ') failed: ' . $e->getMessage());
    flash('error', 'Sign-in with ' . ucfirst($provider) . ' failed. Please try again.');
    redirect('/login.php');
}
