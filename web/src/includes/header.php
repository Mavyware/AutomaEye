<?php
/** @var string $pageTitle */
/** @var string|null $bodyClass */
$user = Auth::user();
?><!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($pageTitle ?? APP_NAME) ?></title>
<meta name="description" content="AutomaEyes — AI Quality Control. Detect defects, measure dimensions, and signal OK/NG straight to your line. Log in and download the desktop app.">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css">
</head>
<body class="<?= e($bodyClass ?? '') ?>">
<header class="site-header">
  <a href="/" class="brand">
    <span class="brand-mark" aria-hidden="true">
      <img src="/assets/img/logo-64.png" width="28" height="28" alt="">
    </span>
    <span class="brand-name">Automa<span class="accent">Eyes</span></span>
  </a>
  <nav class="site-nav">
    <?php if ($user): ?>
      <span class="nav-user">Hi, <?= e(explode(' ', $user['name'])[0]) ?></span>
      <a class="btn btn-ghost" href="/logout.php">Log out</a>
    <?php else: ?>
      <a class="btn btn-ghost" href="/login.php">Log in</a>
      <a class="btn btn-primary" href="/signup.php">Sign up</a>
    <?php endif; ?>
  </nav>
</header>
