// Loadout landing page: copy buttons, live release facts, and the scroll motion.
(function () {
  'use strict';

  /* ---- Copy buttons: copy the exact text of the target <code> ---- */
  document.querySelectorAll('.copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = document.getElementById(button.dataset.target);
      navigator.clipboard.writeText(code.textContent).then(function () {
        button.textContent = 'Copied';
      }, function () {
        var range = document.createRange();
        range.selectNodeContents(code);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Press ⌘C';
      });
      setTimeout(function () { button.textContent = 'Copy'; }, 2000);
    });
  });

  /* ---- Live release facts: shown only when the GitHub API answers with sane values ---- */
  var API = 'https://api.github.com/repos/twiddr/loadout/releases/latest';
  var RELEASES = 'https://github.com/twiddr/loadout/releases/';

  function fill(name, text) {
    document.querySelectorAll('[data-rel="' + name + '"]').forEach(function (el) { el.textContent = text; });
  }
  function show(name, on) {
    document.querySelectorAll('[data-rel-show="' + name + '"]').forEach(function (el) { el.hidden = !on; });
  }

  var abort = 'AbortController' in window ? new AbortController() : null;
  if (abort) setTimeout(function () { abort.abort(); }, 6000);
  fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: abort ? abort.signal : undefined })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rel) {
      var tag = String(rel.tag_name || '');
      if (!/^v\d+\.\d+\.\d+$/.test(tag)) return;
      var dmg = (rel.assets || []).filter(function (a) { return a && a.name === 'Loadout.dmg'; })[0];
      var date = new Date(rel.published_at);
      if (!dmg || !(dmg.size > 0) || isNaN(date)) return;
      var url = String(rel.html_url || '');
      fill('version', tag.slice(1));
      fill('date', date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
      fill('size', (dmg.size / 1e6).toFixed(1) + '\u00a0MB');
      document.querySelectorAll('a[data-rel-link]').forEach(function (a) { if (url.indexOf(RELEASES) === 0) a.href = url; });
      var hash = /^sha256:([0-9a-f]{64})$/.exec(String(dmg.digest || ''));
      if (hash) fill('sha256', hash[1]);
      show('live', true);
      show('hash', !!hash);
      show('fallback', false);
    })
    .catch(function () { /* keep the page silent: no version-dependent facts */ });

  /* ---- Briefing art loads when the Boot camp section comes near (SVG images cannot lazy-load) ---- */
  var boot = document.querySelector('.boot');
  var lazyArt = boot ? Array.prototype.slice.call(boot.querySelectorAll('[data-lazy]')) : [];
  var loadArt = function () {
    lazyArt.forEach(function (el) {
      if (el.tagName.toLowerCase() === 'img') el.src = el.dataset.lazy; else el.setAttribute('href', el.dataset.lazy);
      el.removeAttribute('data-lazy');
    });
  };
  if (boot && 'IntersectionObserver' in window) {
    var artWatch = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { loadArt(); artWatch.disconnect(); }
    }, { rootMargin: '400px 0px' });
    artWatch.observe(boot);
  } else {
    loadArt();
  }

  /* ---- The Briefing map: still under reduced motion ---- */
  var map = document.querySelector('.world');
  if (map && map.pauseAnimations && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    map.setCurrentTime(2.5); // hold a frame with a truck on the road and the helicopter in the air
    map.pauseAnimations();
  }

  /* ---- BOOT CAMP checks: the tools turn green one by one while the section is on screen ---- */
  var checks = document.querySelector('.checks');
  if (checks && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.intersectionRatio >= 0.99) checks.classList.add('found');
        else if (!e.isIntersecting) checks.classList.remove('found');
      });
    }, { threshold: [0, 0.99] }).observe(checks);
  }

  /* ---- Motion: only with GSAP loaded and motion allowed ---- */
  var root = document.documentElement;
  if (!root.classList.contains('motion')) return;
  if (!window.gsap || !window.ScrollTrigger) { root.classList.remove('motion'); return; }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  var mobile = function () { return innerWidth < 900; };
  var gutter = function () { return Math.min(56, Math.max(16, innerWidth * 0.04)); };

  // Hero entrance: the one moment that plays without scrolling.
  document.fonts.ready.then(function () {
    var chars = window.SplitText ? SplitText.create('.hero-copy h1', { type: 'chars' }).chars : '.hero-copy h1';
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from(chars, { opacity: 0, scale: 1.5, filter: 'blur(8px)', duration: 0.55, stagger: 0.05 })
      .from('.hero-copy > :not(h1)', { opacity: 0, y: 18, duration: 0.6, stagger: 0.08 }, '-=0.25')
      .from('.screen-in', { opacity: 0, x: 120, duration: 1.1, ease: 'expo.out' }, 0.2);
    ScrollTrigger.refresh();
  });

  // The tour.
  var screen = document.querySelector('.screen');
  var imgs = gsap.utils.toArray('.screen img');
  var caps = gsap.utils.toArray('.cap');
  var slots = gsap.utils.toArray('.slots i');
  var bracket = document.querySelector('.bracket');
  var heroCopy = document.querySelector('.hero-copy');
  // Areas of the 1440 × 900 captures; m is a tighter area for phones.
  var steps = [
    { img: 0, r: [133, 157, 316, 137] },                                // SK-01 card with its CC / CX switches
    { img: 1, r: [133, 16, 975, 569], m: [133, 16, 600, 569] },        // skill page: header, review score, deployed to, the full briefing
    { img: 2, r: [133, 110, 990, 152], m: [133, 110, 520, 152] }       // Recon: unmanaged items
  ];

  function fit() {
    var W = innerWidth, H = innerHeight, m = mobile() ? 16 : 56;
    var s = Math.min((W - 2 * m) / 1440, (H - 2 * m) / 900);
    return { x: (W - 1440 * s) / 2, y: (H - 900 * s) / 2, scale: s };
  }
  function start() {
    if (mobile()) return fit();
    var h1 = heroCopy.querySelector('h1').getBoundingClientRect();
    return { x: gutter() + Math.min(560, heroCopy.offsetWidth) + 48, y: h1.top + scrollY, scale: 0.82 * innerWidth / 1440 };
  }
  function area() {
    var W = innerWidth, H = innerHeight, g = gutter();
    if (mobile()) return { l: 12, r: W - 12, t: 16, b: H * 0.54 };
    return { l: g + Math.min(400, W * 0.3) + 56, r: W - g, t: 40, b: H - 40 };
  }
  function focus(r) {
    var a = area();
    var s = Math.min(Math.min((a.r - a.l) / r[2], (a.b - a.t) / r[3]) * 0.9, mobile() ? 1.6 : 2);
    // Centre the framed area, but never leave empty page above or below the capture: a capture that fits is centred whole.
    var h = 900 * s, y = (a.t + a.b) / 2 - (r[1] + r[3] / 2) * s;
    y = h <= a.b - a.t ? (a.t + a.b - h) / 2 : Math.min(a.t, Math.max(a.b - h, y));
    return { x: (a.l + a.r) / 2 - (r[0] + r[2] / 2) * s, y: y, scale: s };
  }
  function box(r) {
    var f = focus(r), pad = 10;
    return { x: f.x + r[0] * f.scale - pad, y: f.y + r[1] * f.scale - pad, width: r[2] * f.scale + 2 * pad, height: r[3] * f.scale + 2 * pad };
  }
  function get(fn, key) { return function () { return fn()[key]; }; }

  // The tour's later captures sit on screen at opacity 0, so loading="lazy" would not delay them: load them on the first scroll.
  addEventListener('scroll', function () {
    imgs.forEach(function (img) { if (img.dataset.src && !img.getAttribute('src')) img.src = img.dataset.src; });
  }, { once: true, passive: true });

  // A phone first loads the 1440 px capture; the tour zooms, so it switches to the 2880 px one.
  ScrollTrigger.create({ trigger: '.scene', start: 'top 40%', once: true, onEnter: function () { imgs[0].sizes = '2880px'; } });

  // On a wide screen the hero copy lies over the start of the scene and scrolls away above it; matchMedia undoes it below 900 px.
  gsap.matchMedia().add('(min-width: 900px)', function () { gsap.set(heroCopy, { position: 'absolute', top: 0, left: 0 }); });
  gsap.set(screen, { x: get(start, 'x'), y: get(start, 'y'), scale: get(start, 'scale') });

  var tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      id: 'tour', trigger: '.scene', start: 'top top',
      end: function () { return '+=' + innerHeight * 3.2; },
      pin: true, scrub: 0.8, invalidateOnRefresh: true,
      snap: { snapTo: 'labels', inertia: false, duration: { min: 0.25, max: 0.7 }, delay: 0.1, ease: 'power1.inOut' }
    }
  });
  tl.addLabel('hero')
    .to(heroCopy, { autoAlpha: function () { return mobile() ? 1 : 0; }, y: function () { return mobile() ? 0 : -60; }, duration: 0.6, ease: 'power1.in' }, 0);

  steps.forEach(function (step, i) {
    var R = function () { return mobile() && step.m ? step.m : step.r; };
    var to = { x: function () { return focus(R()).x; }, y: function () { return focus(R()).y; }, scale: function () { return focus(R()).scale; }, duration: 1 };
    // The first step zooms straight from the hero to the SK-01 card.
    if (i === 0) tl.fromTo(screen, { x: get(start, 'x'), y: get(start, 'y'), scale: get(start, 'scale') }, to, 0);
    else tl.to(screen, to);
    tl.to(bracket, { x: function () { return box(R()).x; }, y: function () { return box(R()).y; }, width: function () { return box(R()).width; }, height: function () { return box(R()).height; }, opacity: 1, duration: 1 }, '<');
    if (i === 0) tl.to('.veil, .slots', { opacity: 1, duration: 0.6 }, '<0.3');
    if (i > 0) tl.to(caps[i - 1], { autoAlpha: 0, y: -24, duration: 0.35 }, '<');
    if (i > 0 && step.img !== steps[i - 1].img) tl.to(imgs[step.img], { opacity: 1, duration: 0.45 }, '<0.3');
    tl.fromTo(caps[i], { autoAlpha: 0, y: 32 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, '<0.45');
    tl.to(slots[i], { backgroundColor: '#e9a04b', borderColor: '#e9a04b', duration: 0.3 }, '<');
    tl.addLabel('s' + i).to({}, { duration: 0.7 });
  });

  // Boot camp: the tablet stands up as it enters.
  gsap.from('.pad', { rotationX: 32, scale: 0.86, y: 80, opacity: 0.4, ease: 'none',
    scrollTrigger: { trigger: '.boot', start: 'top bottom', end: 'center center', scrub: 0.6 } });
})();
