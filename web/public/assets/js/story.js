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
