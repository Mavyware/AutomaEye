(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- Animated network background ---------- */
  var canvas = document.getElementById('story-bg');
  if (canvas && !reduced) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W, H, nodes = [];
    var NODE_COUNT = 60;
    var LINK_DIST = 140;

    function resize() {
      W = canvas.width = window.innerWidth * dpr;
      H = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    }

    function initNodes() {
      nodes = [];
      for (var i = 0; i < NODE_COUNT; i++) {
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.25 * dpr,
          vy: (Math.random() - 0.5) * 0.25 * dpr,
        });
      }
    }

    function step() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      }
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var dx = nodes[a].x - nodes[b].x;
          var dy = nodes[a].y - nodes[b].y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var maxDist = LINK_DIST * dpr;
          if (dist < maxDist) {
            ctx.strokeStyle = 'rgba(0, 240, 192,' + (0.1 * (1 - dist / maxDist)) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
      }
      for (var j = 0; j < nodes.length; j++) {
        ctx.fillStyle = 'rgba(124, 92, 255, 0.45)';
        ctx.beginPath();
        ctx.arc(nodes[j].x, nodes[j].y, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(step);
    }

    window.addEventListener('resize', function () { resize(); initNodes(); });
    resize();
    initNodes();
    requestAnimationFrame(step);
  }

  /* ---------- Simple reveals (hero, outro) ---------- */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) entry.target.classList.add('is-active');
    });
  }, { threshold: 0.35 });
  qsa('[data-reveal]').forEach(function (el) { revealObserver.observe(el); });

  /* ---------- Sticky scrollytelling ---------- */
  var subscribers = [];
  var api = {
    progress: 0,     // 0..1 through the whole wrapper
    step: 0,         // active step index
    stepProgress: 0, // 0..1 within the active step
    steps: 0,
    active: false,   // panel is on screen
    subscribe: function (fn) { subscribers.push(fn); },
  };
  window.AutomaEyeScrolly = api;

  var wrapper = document.getElementById('scrolly');
  if (!wrapper) return;

  var items = qsa('.step-item', wrapper);
  var rail = document.getElementById('step-rail');
  var bar = document.getElementById('scrolly-bar');
  var hudStep = document.getElementById('hud-step');
  var STEPS = items.length;
  api.steps = STEPS;

  // Build the segmented step rail from the steps themselves.
  var segments = [];
  if (rail) {
    items.forEach(function (item, i) {
      var seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'rail-seg';
      seg.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + (item.getAttribute('data-label') || ''));
      var fill = document.createElement('span');
      seg.appendChild(fill);
      seg.addEventListener('click', function () {
        var total = wrapper.offsetHeight - window.innerHeight;
        var top = wrapper.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top + ((i + 0.35) / STEPS) * total, behavior: 'smooth' });
      });
      rail.appendChild(seg);
      segments.push(fill);
    });
  }

  var current = -1;

  function setActive(idx) {
    items.forEach(function (item, i) {
      item.classList.toggle('is-active', i === idx);
    });
    if (hudStep) hudStep.textContent = '[' + ('0' + (idx + 1)).slice(-2) + ']';
  }

  function update() {
    var rect = wrapper.getBoundingClientRect();
    var total = wrapper.offsetHeight - window.innerHeight;
    var p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
    var raw = p * STEPS;
    var idx = clamp(Math.floor(raw), 0, STEPS - 1);
    var sp = clamp(raw - idx, 0, 1);

    if (idx !== current) {
      setActive(idx);
      current = idx;
    }

    segments.forEach(function (fill, i) {
      fill.style.width = (i < idx ? 100 : (i === idx ? sp * 100 : 0)) + '%';
    });
    if (bar) bar.style.width = (p * 100) + '%';

    api.progress = p;
    api.step = idx;
    api.stepProgress = sp;

    for (var i = 0; i < subscribers.length; i++) subscribers[i](api);
  }

  // Only run the loop while the panel is actually on screen.
  var inView = false;
  new IntersectionObserver(function (entries) {
    inView = entries[0].isIntersecting;
    api.active = inView;
    if (inView) requestAnimationFrame(loop);
  }, { threshold: 0 }).observe(wrapper);

  function loop() {
    update();
    if (inView) requestAnimationFrame(loop);
  }

  window.addEventListener('resize', update);
  update();

})();

/* ============================================================
   Scroll-gated boot sequence.
   Nothing scrolls until the visitor has advanced through every
   line; one wheel / swipe / arrow-key gesture reveals exactly
   one line, and the final gesture shatters the text apart.
   ============================================================ */
(function () {
  'use strict';

  var boot = document.getElementById('boot-sequence');
  if (!boot) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lines = Array.prototype.slice.call(boot.querySelectorAll('.boot-line'));
  var hint = document.getElementById('boot-hint');

  var stage = 0;            // lines revealed so far
  var gateLocked = false;   // debounce: one gesture => one action
  var sequenceDone = false;
  var hasExited = false;    // true once real page scroll has taken over
  // phase: 'reveal' -> 'reveal-done' -> 'shattering' -> 'lifting' -> 'done'
  var phase = 'reveal';
  var liftProgress = 0;
  var LIFT_STEP = 0.24; // ~4-5 scroll gestures to fully clear the screen

  function fillStatus(line) {
    setTimeout(function () {
      var status = line.querySelector('.status');
      if (status) status.textContent = line.getAttribute('data-status') || '';
    }, 220);
  }

  function revealNext() {
    if (stage >= lines.length) return;
    var line = lines[stage];
    line.classList.add('is-shown');
    fillStatus(line);
    stage++;
    if (stage === lines.length) {
      sequenceDone = true;
      phase = 'reveal-done';
      setTimeout(function () { if (hint) hint.classList.add('is-shown'); }, 500);
    }
  }

  function advance() {
    if (hasExited || gateLocked) return;
    if (phase === 'reveal') {
      gateLocked = true;
      setTimeout(function () { gateLocked = false; }, 420);
      revealNext();
    } else if (phase === 'reveal-done') {
      gateLocked = true; // released once the shatter animation itself finishes
      exitShatter();
    } else if (phase === 'lifting') {
      gateLocked = true;
      setTimeout(function () { gateLocked = false; }, 260);
      liftOneStep();
    }
    // phase === 'shattering': ignore input until the shatter animation completes.
  }

  /* ---- Input handling: swallow the gesture, advance the stage ---- */
  function onWheel(e) {
    if (hasExited) return;
    e.preventDefault();
    advance();
  }

  var touchStartY = null;
  function onTouchStart(e) { touchStartY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (hasExited) return;
    e.preventDefault();
    if (touchStartY === null) return;
    if (Math.abs(touchStartY - e.touches[0].clientY) > 30) {
      touchStartY = e.touches[0].clientY;
      advance();
    }
  }

  function onKeyDown(e) {
    if (hasExited) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown' || e.code === 'PageDown') {
      e.preventDefault();
      advance();
    }
  }

  function bind() {
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKeyDown);
  }

  function unbind() {
    window.removeEventListener('wheel', onWheel, { passive: false });
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove, { passive: false });
    window.removeEventListener('keydown', onKeyDown);
  }

  /* ---- Split a line into one span per character, in place ---- */
  function splitIntoChars(root) {
    var spans = [];
    Array.prototype.slice.call(root.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        var frag = document.createDocumentFragment();
        node.nodeValue.split('').forEach(function (ch) {
          var s = document.createElement('span');
          s.textContent = ch;
          frag.appendChild(s);
          spans.push(s);
        });
        root.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        spans = spans.concat(splitIntoChars(node));
      }
    });
    return spans;
  }

  /* ---- Shatter: every character flies off on its own vector ---- */
  function exitShatter() {
    phase = 'shattering';
    boot.classList.add('is-exiting');
    if (hint) hint.classList.remove('is-shown');

    var shards = [];
    lines.forEach(function (line) {
      if (!line.classList.contains('is-shown')) return;
      splitIntoChars(line).forEach(function (charSpan) {
        if (!charSpan.textContent.trim()) return;
        // Measure where this character actually rendered, then hand it to a
        // fixed-position clone so it can fly independently of the layout.
        var rect = charSpan.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        var style = window.getComputedStyle(charSpan);
        var shard = document.createElement('span');
        shard.className = 'boot-shard';
        shard.textContent = charSpan.textContent;
        shard.style.left = rect.left + 'px';
        shard.style.top = rect.top + 'px';
        shard.style.fontSize = style.fontSize;
        shard.style.fontFamily = style.fontFamily;
        shard.style.fontWeight = style.fontWeight;
        shard.style.color = style.color;
        document.body.appendChild(shard);
        shards.push(shard);
      });
    });

    boot.classList.add('is-blank');

    requestAnimationFrame(function () {
      shards.forEach(function (shard) {
        var angle = Math.random() * Math.PI * 2;
        var dist = 200 + Math.random() * 500;
        var x = Math.cos(angle) * dist;
        var y = Math.sin(angle) * dist - 100 - Math.random() * 200;
        var rot = (Math.random() - 0.5) * 720;
        shard.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg)';
        shard.style.opacity = '0';
      });
    });

    setTimeout(function () {
      shards.forEach(function (shard) { shard.remove(); });
      boot.classList.add('is-liftable');
      phase = 'lifting';
      gateLocked = false;
      if (hint) {
        hint.textContent = String.fromCharCode(0x25b2) + ' KEEP SCROLLING';
        hint.classList.add('is-shown');
      }
    }, 950);
  }

  // The overlay itself lifts up and fades - a little more with every scroll
  // gesture - like the visitor is pulling the black screen away themselves,
  // rather than watching a fixed-length animation play out on its own.
  function liftOneStep() {
    liftProgress = Math.min(1, liftProgress + LIFT_STEP);
    boot.style.transform = 'translateY(-' + (liftProgress * 100) + '%)';
    boot.style.opacity = String(1 - liftProgress);
    if (liftProgress >= 1) {
      setTimeout(finish, 300); // let the final step's transition play out
    }
  }

  function finish() {
    hasExited = true;
    phase = 'done';
    if (hint) hint.classList.remove('is-shown');
    boot.classList.add('is-hidden');
    document.body.classList.remove('boot-locked');
    document.body.style.overflow = '';
    unbind();
  }

  /* ---- Start ---- */
  if (reduced) {
    // No gate for reduced-motion users: show the sequence and let them scroll.
    lines.forEach(function (line) {
      line.classList.add('is-shown');
      var status = line.querySelector('.status');
      if (status) status.textContent = line.getAttribute('data-status') || '';
    });
    hasExited = true;
    boot.classList.add('is-hidden');
    return;
  }

  document.body.classList.add('boot-locked');
  document.body.style.overflow = 'hidden';
  window.scrollTo(0, 0);
  bind();
  // First line is free, so the screen is never empty while waiting.
  revealNext();
})();
