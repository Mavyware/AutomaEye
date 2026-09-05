<?php
declare(strict_types=1);

final class OAuth
{
    public static function state(string $provider, ?string $redirect, string $purpose = 'login'): string
    {
        $state = bin2hex(random_bytes(16));
        $_SESSION['oauth_state'][$provider] = [
            'state' => $state,
            'redirect' => $redirect,
            'purpose' => $purpose,
        ];
        return $state;
    }

    /**
     * Like consumeState(), but returns the whole state (including
     * 'purpose') — used by the callback to tell a normal login apart from
     * a repo access request from the desktop app.
     *
     * @return array{redirect:?string,purpose:string}|null
     */
    public static function consumeStateFull(string $provider, string $state): ?array
    {
        $stored = $_SESSION['oauth_state'][$provider] ?? null;
        unset($_SESSION['oauth_state'][$provider]);
        if (!$stored || !hash_equals($stored['state'], $state)) {
            return null;
        }
        return [
            'redirect' => $stored['redirect'] ?? null,
            'purpose' => $stored['purpose'] ?? 'login',
        ];
    }

    public static function consumeState(string $provider, string $state): ?string
    {
        $stored = $_SESSION['oauth_state'][$provider] ?? null;
        unset($_SESSION['oauth_state'][$provider]);
        if (!$stored || !hash_equals($stored['state'], $state)) {
            return null;
        }
        return $stored['redirect'];
    }

    /** @return array{access_token:string} */
    public static function exchangeCode(string $tokenUrl, array $params): array
    {
        $ch = curl_init($tokenUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($params),
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_TIMEOUT => 10,
        ]);
        $response = curl_exec($ch);
        curl_close($ch);
        $data = json_decode((string) $response, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new RuntimeException('OAuth token exchange failed');
        }
        return $data;
    }

    public static function get(string $url, string $accessToken, array $extraHeaders = []): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => array_merge([
                'Authorization: Bearer ' . $accessToken,
                'User-Agent: AutomaEyes',
            ], $extraHeaders),
            CURLOPT_TIMEOUT => 10,
        ]);
        $response = curl_exec($ch);
        curl_close($ch);
        $data = json_decode((string) $response, true);
        return is_array($data) ? $data : [];
    }
}
