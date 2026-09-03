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
<meta name="description" content="AutomaEye — build and deploy computer vision pipelines on the edge. Login and download the desktop app.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><circle cx=%2216%22 cy=%2216%22 r=%2214%22 fill=%22%230b0e14%22 stroke=%22%2300f0c0%22 stroke-width=%222%22/><circle cx=%2216%22 cy=%2216%22 r=%225%22 fill=%22%2300f0c0%22/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/style.css">
</head>
<body class="<?= e($bodyClass ?? '') ?>">
<header class="site-header">
  <a href="/" class="brand">
    <span class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="4.5" fill="currentColor"/><path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </span>
    <span class="brand-name">Automa<span class="accent">Eye</span></span>
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
