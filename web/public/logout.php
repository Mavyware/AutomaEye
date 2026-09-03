<?php
require __DIR__ . '/../src/bootstrap.php';

// "Pakai akun lain" pada alur aplikasi desktop mengirim ?next=/login.php?...
// supaya setelah logout user langsung kembali ke layar login aplikasi,
// bukan ke beranda. Hanya path internal yang diterima — jangan sampai
// jadi open redirect ke domain luar.
$next = (string) ($_GET['next'] ?? '');
$safeNext = (str_starts_with($next, '/') && !str_starts_with($next, '//')) ? $next : '/';

Auth::logout();
redirect($safeNext);
