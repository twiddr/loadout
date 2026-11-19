// Loadout download page: copy buttons, live release facts, the switches, and the scroll motion.
(function () {
  'use strict';

  var root = document.documentElement;
  var pin = document.querySelector('.pin');
  var say = document.querySelector('.say');
  var app = document.getElementById('app');
  var get = document.getElementById('get');
  var more1 = document.querySelector('.more.m1');
  var more2 = document.querySelector('.more.m2');

  /* ---- The boxes fit the window; the text keeps its size (site.css reads --say-h) ---- */
  function fit() { pin.style.setProperty('--say-h', say.offsetHeight + 'px'); }
  fit();
  addEventListener('resize', fit);

  /* ---- Copy buttons: copy the exact text of the target <code> ---- */
  document.querySelectorAll('.copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = document.getElementById(button.dataset.target);
      // no clipboard on a page that is not served over https
      (navigator.clipboard ? navigator.clipboard.writeText(code.textContent) : Promise.reject()).then(function () {
        button.textContent = 'Copied';
      }, function () {
        var range = document.createRange();
        range.selectNodeContents(code);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = matchMedia('(pointer: coarse)').matches ? 'Selected' : 'Press ⌘C';
      });
      setTimeout(function () { button.textContent = 'Copy'; }, 1600);
    });
  });

  /* ---- Live release facts: shown only when the GitHub API answers with sane values ---- */
  var API = 'https://api.github.com/repos/twiddr/loadout/releases/latest';

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
      fill('version', tag.slice(1));
      fill('date', date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
      fill('size', (dmg.size / 1e6).toFixed(1) + ' MB');
      var hash = /^sha256:([0-9a-f]{64})$/.exec(String(dmg.digest || ''));
      if (hash) fill('sha256', hash[1]);
      show('live', true);
      show('hash', !!hash);
      show('fallback', false);
      fit();
    })
    .catch(function () { /* keep the page silent: no version-dependent facts */ });

  /* ---- The switches: every toggle works; site.css draws the state from aria-pressed ---- */
  document.querySelectorAll('.hit').forEach(function (button) {
    button.addEventListener('click', function () {
      button.parentElement.classList.toggle('one', Math.random() < 0.5); // the lamp flickers with one dip or with two
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      // the lever passes its middle position (site.css shows the frame while .mid is set)
      button.classList.add('mid');
      setTimeout(function () { button.classList.remove('mid'); }, 70);
    });
  });

  /* ---- Boxes 2 and 3 load after the first screen ---- */
  addEventListener('load', function () { root.classList.add('art'); });

  /* ---- The chevrons scroll to the next part, and go when the page has moved on ---- */
  var st1 = null, st2 = null; // the two pins; set only while the motion runs
  var calm = matchMedia('(prefers-reduced-motion: reduce)');
  function go(el) { el.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth' }); }
  more1.addEventListener('click', function () {
    if (st2) scrollTo({ top: st2.start, behavior: 'smooth' });
    else go(app);
  });
  more2.addEventListener('click', function () {
    if (st2) scrollTo({ top: st2.end + innerHeight * 0.92, behavior: 'smooth' });
    else go(get);
  });
  addEventListener('scroll', function () {
    if (st1) return;
    [more1, more2].forEach(function (more) { more.classList.toggle('gone', more.getBoundingClientRect().top < innerHeight / 2); });
  }, { passive: true });

  /* ---- Motion: a wide window, a mouse or trackpad, motion allowed, and GSAP loaded ---- */
  if (!window.gsap || !window.ScrollTrigger) { root.classList.remove('motion'); return; }
  gsap.registerPlugin(ScrollTrigger);
  document.fonts.ready.then(function () { fit(); ScrollTrigger.refresh(); });

  gsap.matchMedia().add('(min-width: 900px) and (pointer: fine) and (prefers-reduced-motion: no-preference)', function () {
    root.classList.add('motion');
    more1.classList.remove('gone');
    more2.classList.remove('gone');

    // The move from one box to three runs on its own clock. Scroll only starts it.
    // The values are parts of each box's own size, so they hold at every window size:
    // box 1 goes from left 374.375 to 13 and from scale 0.875 to 0.62 on the floor line; boxes 2 and 3 come 300 px from the right.
    var tl = gsap.timeline({ paused: true })
      .to('.b1', { xPercent: -52.278, yPercent: 24.03, scale: 0.62 / 0.875, duration: 0.8, ease: 'power3.inOut' }, 0)
      .fromTo('.b2', { xPercent: 61.25 }, { xPercent: 0, duration: 0.8, ease: 'power3.out' }, 0.35)
      .to('.b2', { opacity: 1, duration: 0.4, ease: 'none' }, 0.35)
      .fromTo('.b3', { xPercent: 61.25 }, { xPercent: 0, duration: 0.8, ease: 'power3.out' }, 0.5)
      .to('.b3', { opacity: 1, duration: 0.4, ease: 'none' }, 0.5);

    st1 = ScrollTrigger.create({ trigger: pin, start: 'top top', end: '+=60%', pin: true });
    // the page stops at the app: it stays in the centre for this much scroll
    st2 = ScrollTrigger.create({ trigger: app, start: 'top top', end: '+=70%', pin: true,
      onUpdate: function (self) { more2.classList.toggle('gone', self.progress > 0.9); } });

    var row = false, moving = false, jump = false; // moving: the boxes are on their way in; jump: the End key skipped the move
    tl.eventCallback('onComplete', function () { moving = false; document.body.classList.add('row'); });
    // end the move at once, also when it runs in reverse
    function finish() { tl.pause().progress(1); moving = false; document.body.classList.add('row'); }
    function sync() {
      var y = scrollY, on = y > st1.start + 30, far = y > st1.end + innerHeight * 0.6;
      if (on) jump = false;
      if (on && !row) { row = true; if (far) finish(); else { moving = true; tl.play(); } }
      else if (!on && row && !jump) { row = false; moving = false; document.body.classList.remove('row'); tl.reverse(); }
      if (moving && far) finish();                            // a jump past the boxes (scrollbar, End key) ends the move at once
      else if (moving && y > st1.end) scrollTo(0, st1.end);   // keep the boxes on screen until they are in place
      more1.classList.toggle('gone', y > st1.end + 40);       // the hint goes when the page leaves the boxes
    }
    // while the boxes move in, more scroll input waits (about one second)
    function hold(e) { if (moving) e.preventDefault(); }
    function keys(e) {
      // End and Cmd+Down scroll in steps, so sync cannot see the jump: end the move here
      if ((e.key === 'End' || (e.metaKey && e.key === 'ArrowDown')) && (!row || moving)) { row = jump = true; finish(); return; }
      if (moving && (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.target.closest('button, a')))) e.preventDefault();
    }
    addEventListener('scroll', sync, { passive: true });
    addEventListener('wheel', hold, { passive: false });
    addEventListener('touchmove', hold, { passive: false });
    addEventListener('keydown', keys);
    sync();

    return function () {
      removeEventListener('scroll', sync);
      removeEventListener('wheel', hold);
      removeEventListener('touchmove', hold);
      removeEventListener('keydown', keys);
      st1 = st2 = null;
      root.classList.remove('motion');
      document.body.classList.remove('row');
    };
  });
})();
