/* ════════════════════════════════════════════════════
   FEMIX PLUMBING — script.js  (SPA Edition)
   Single-Page Application router + all interactions
   ════════════════════════════════════════════════════ */
'use strict';

/* ─── BACKEND URL ─── */
const BACKEND_URL = 'https://femix-plumbing-backend.onrender.com/book';
const SUBSCRIBE_URL = 'https://femix-plumbing-backend.onrender.com/subscribe';
const PAYMENT_VERIFY_URL = 'https://femix-plumbing-backend.onrender.com/payment/verify';

/* ── PAYMENT SETTINGS (edit these) ── all amounts are Nigerian Naira (₦) */
const PAYMENT_CONFIG = {
  bankName:      'OPay',
  accountName:   'Nuhn Wasiu Femi',
  accountNumber: '6115857333',
  paystackPublicKey: '',                    // 'pk_live_…' — leave '' to disable card popup
  // USSD transfer strings (amount, account) — formats can vary by bank
  ussd: [
    { bank: 'GTBank',     code: (a, n) => `*737*2*${a}*${n}#` },
    { bank: 'Access',     code: (a, n) => `*901*${a}*${n}#` },
    { bank: 'Zenith',     code: (a, n) => `*966*${a}*${n}#` },
    { bank: 'First Bank', code: (a, n) => `*894*${a}*${n}#` },
    { bank: 'UBA',        code: (a, n) => `*919*3*${n}*${a}#` },
    { bank: 'Fidelity',   code: (a, n) => `*770*${n}*${a}#` },
    // OPay's USSD is menu-driven: dial *955#, choose Transfer, then enter the details
    { bank: 'OPay',       code: () => '*955#', hint: true }
  ]
};

/* ─── DOM HELPERS ─── */
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

/* ─── SHARED FIELD VALIDITY RULES ───
   Used by BOTH the green-checkmark indicator AND the booking
   wizard's step-advance gate, so they can never disagree — a
   field only ever shows green when it would actually let you
   press Continue, and Continue only ever fails on a field that
   isn't already showing green. */
const FIELD_RULES = {
  // At least two "words" (first + last name), letters only per word
  // (allows hyphens/apostrophes inside a word, e.g. "Mary-Jane O'Brien").
  fname: v => /^[A-Za-z]{2,}(?:['-][A-Za-z]{2,})?(?:\s+[A-Za-z]{2,}(?:['-][A-Za-z]{2,})?)+$/.test(v.trim()),
  // Standard email shape: something@something.tld (tld letters only, 2+ chars).
  femail: v => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v.trim()),
  // Nigerian mobile number: 0XXXXXXXXXX (11 digits) or +234/234XXXXXXXXXX,
  // where the subscriber number starts with 7, 8, or 9.
  fphone: v => {
    const d = v.replace(/[^\d+]/g, '');
    return /^0[7-9]\d{9}$/.test(d) || /^(?:\+?234)[7-9]\d{9}$/.test(d);
  },
  faddress: v => v.trim().length >= 5
};

document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('is-tab-hidden', document.hidden);
});

/* ── Keep --nav-total in permanent sync with the header's REAL height ──
   The header's height was previously assumed via a fixed calc() of its
   two rows' nominal heights. That drifts whenever the logo text needs
   more room than the row's fixed height allows (it's deliberately
   overflow:visible so it's never clipped) — on some screen widths the
   header renders taller than assumed, and body's fixed padding-top no
   longer matches, letting the ticker bar visually bleed into whatever
   comes right after it. Measuring the real rendered height directly
   removes the guesswork entirely, on every screen size, permanently. */
(function syncHeaderHeight() {
  const header = document.getElementById('header');
  if (!header) return;

  function apply() {
    const h = header.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--nav-total', h + 'px');
  }

  apply();
  if ('ResizeObserver' in window) {
    new ResizeObserver(apply).observe(header);
  } else {
    window.addEventListener('resize', apply);
  }
  // Fonts loading in late can change text height after first paint.
  document.fonts?.ready?.then(apply);
})();

// The fixed WhatsApp/Call bubbles sit in the same bottom-right corner as
// the footer's own "Contact" nav card — fade them out of the way whenever
// that card scrolls into view so they can never steal its taps.
(function footerFabClearance() {
  const footerNav = $('.footer-nav-row');
  if (!footerNav || !('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(
    entries => entries.forEach(e => document.body.classList.toggle('is-footer-in-view', e.isIntersecting)),
    { rootMargin: '0px 0px -20% 0px', threshold: 0.15 }
  );
  obs.observe(footerNav);
})();

/* ════════════════════════════════════════════════════
   GALLERY STRIP — JS-driven infinite scroll with real
   acceleration/deceleration (a CSS keyframe animation can only be
   paused/resumed instantly; driving the transform directly via
   requestAnimationFrame lets speed ease smoothly toward 0 on hover
   and back up to cruising speed on release, like a physical belt
   slowing down rather than snapping to a stop).
════════════════════════════════════════════════════ */
(function initGalleryScroll() {
  const track = document.getElementById('sliderTrack');
  if (!track) return;

  const CRUISE_SPEED = 42;   // px/sec
  const EASE_RATE     = 3.2; // higher = snappier accel/decel

  let targetSpeed  = CRUISE_SPEED;
  let currentSpeed = 0;
  let position     = 0;
  let halfWidth    = 0;
  let lastTime     = null;
  let rafId        = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function measure() {
    // Track content is the unique slide set duplicated once for a
    // seamless loop — half its scrollWidth is exactly one full cycle.
    halfWidth = track.scrollWidth / 2;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (document.hidden) { lastTime = now; return; } // don't accumulate a jump on tab return
    if (lastTime === null) { lastTime = now; return; }
    const dt = Math.min((now - lastTime) / 1000, 0.1); // clamp to avoid a big jump after a stall
    lastTime = now;

    currentSpeed += (targetSpeed - currentSpeed) * Math.min(EASE_RATE * dt, 1);
    position -= currentSpeed * dt;
    if (halfWidth > 0 && Math.abs(position) >= halfWidth) position += halfWidth;
    track.style.transform = `translateX(${position}px)`;
  }

  function start() {
    if (rafId) return;
    lastTime = null;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  measure();
  window.addEventListener('resize', measure);
  // Images loading in can change scrollWidth — remeasure once they're in.
  track.querySelectorAll('img').forEach(img => {
    if (img.complete) return;
    img.addEventListener('load', measure, { once: true });
  });

  const strip = track.closest('.gallery-strip');
  strip?.addEventListener('mouseenter', () => { targetSpeed = 0; });
  strip?.addEventListener('mouseleave', () => { targetSpeed = CRUISE_SPEED; });
  strip?.addEventListener('touchstart', () => { targetSpeed = 0; }, { passive: true });
  strip?.addEventListener('touchend',   () => { targetSpeed = CRUISE_SPEED; }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  if (prefersReducedMotion) {
    track.style.transform = 'translateX(0)';
    return; // no motion at all if the user has asked for reduced motion
  }
  start();
})();

/* ════════════════════════════════════════════════════
   GALLERY LIGHTBOX — full-screen viewer with zoom
   (buttons + drag-to-pan) and prev/next through the
   unique photo set (de-duplicated from the doubled
   marquee list).
════════════════════════════════════════════════════ */
(function initGalleryLightbox() {
  const track = document.getElementById('sliderTrack');
  const overlay = document.getElementById('galleryLightbox');
  if (!track || !overlay) return;

  const imgEl     = document.getElementById('lightboxImg');
  const wrapEl    = document.getElementById('lightboxImgWrap');
  const counterEl = document.getElementById('lightboxCounter');
  const closeBtn  = document.getElementById('lightboxClose');
  const prevBtn   = document.getElementById('lightboxPrev');
  const nextBtn   = document.getElementById('lightboxNext');
  const zoomInBtn    = document.getElementById('lightboxZoomIn');
  const zoomOutBtn   = document.getElementById('lightboxZoomOut');
  const zoomResetBtn = document.getElementById('lightboxZoomReset');

  // De-duplicate: the strip repeats the same photo set twice for the
  // seamless loop, but the lightbox should only ever step through each
  // unique photo once.
  const allSlideImgs = $$('.slide img', track);
  const seen = new Set();
  const uniqueImgs = [];
  allSlideImgs.forEach(img => {
    if (seen.has(img.src)) return;
    seen.add(img.src);
    uniqueImgs.push(img);
  });

  let currentIndex = 0;
  let zoom = 1;
  let panX = 0, panY = 0;
  let dragging = false;
  let dragStartX = 0, dragStartY = 0;
  const MIN_ZOOM = 1, MAX_ZOOM = 3, ZOOM_STEP = 0.5;

  function applyTransform() {
    imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    wrapEl.classList.toggle('is-zoomed', zoom > 1);
  }

  function resetZoom() {
    zoom = 1; panX = 0; panY = 0;
    applyTransform();
  }

  function render() {
    const img = uniqueImgs[currentIndex];
    imgEl.src = img.src;
    imgEl.alt = img.alt || '';
    counterEl.textContent = `${currentIndex + 1} / ${uniqueImgs.length}`;
    resetZoom();
  }

  function open(index) {
    currentIndex = index;
    render();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }
  function close() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function next() { currentIndex = (currentIndex + 1) % uniqueImgs.length; render(); }
  function prev() { currentIndex = (currentIndex - 1 + uniqueImgs.length) % uniqueImgs.length; render(); }

  // Open on click — works regardless of which (duplicated) slide was
  // clicked, since we match by src back to the unique list.
  track.addEventListener('click', e => {
    const slide = e.target.closest('.slide');
    if (!slide) return;
    const img = slide.querySelector('img');
    if (!img) return;
    const idx = uniqueImgs.findIndex(u => u.src === img.src);
    open(idx === -1 ? 0 : idx);
  });
  // Keyboard-accessible: slides are focusable via tabindex added below
  track.querySelectorAll('.slide').forEach(slide => {
    slide.setAttribute('tabindex', '0');
    slide.setAttribute('role', 'button');
    slide.setAttribute('aria-label', 'View larger photo');
    slide.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); slide.click(); }
    });
  });

  closeBtn.addEventListener('click', close);
  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === '+' || e.key === '=') zoomIn();
    else if (e.key === '-') zoomOut();
  });

  function zoomIn()  { zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP); applyTransform(); }
  function zoomOut() {
    zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
    if (zoom === 1) { panX = 0; panY = 0; }
    applyTransform();
  }
  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  zoomResetBtn.addEventListener('click', resetZoom);

  // Drag-to-pan once zoomed in (pointer events cover mouse + touch)
  wrapEl.addEventListener('pointerdown', e => {
    if (zoom <= 1) return;
    dragging = true;
    wrapEl.classList.add('is-dragging');
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    wrapEl.setPointerCapture(e.pointerId);
  });
  wrapEl.addEventListener('pointermove', e => {
    if (!dragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
    applyTransform();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => {
    wrapEl.addEventListener(evt, () => { dragging = false; wrapEl.classList.remove('is-dragging'); });
  });
  // Double-click/tap to toggle zoom
  wrapEl.addEventListener('dblclick', () => { zoom > 1 ? resetZoom() : (zoom = 2, applyTransform()); });
})();

/* ════════════════════════════════════════════════════
   1. LOADER
   Shows just long enough to read as intentional, then
   gets out of the way — it no longer waits for the full
   window "load" event (every image/font/script), which is
   what made the site feel like it was hanging. A safety
   timeout also guarantees it never blocks the page even on
   a slow connection.
════════════════════════════════════════════════════ */
(function loaderControl() {
  const loader = $('#loader');
  const MIN_VISIBLE = 320; // long enough to not flicker, short enough to feel instant
  const MAX_WAIT    = 1600; // hard cap — the loader can never hang the site
  const start = Date.now();
  let done = false;

  function hide() {
    if (done) return;
    done = true;
    const wait = Math.max(MIN_VISIBLE - (Date.now() - start), 0);
    setTimeout(() => {
      loader?.classList.add('out');
      $$('#view-home .reveal-fade').forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), 60 + i * 80);
      });
    }, wait);
  }

  if (document.readyState === 'complete') {
    hide();
  } else {
    window.addEventListener('load', hide, { once: true });
  }
  setTimeout(hide, MAX_WAIT);
})();

/* ════════════════════════════════════════════════════
   2. THEME
════════════════════════════════════════════════════ */
(function themeSystem() {
  const html = document.documentElement;
  const KEY  = 'femix-v3-theme';
  const btns = $$('[data-theme]', $('.theme-switch'));

  function apply(t) {
    html.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
    btns.forEach(b => {
      const on = b.dataset.theme === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  const saved = localStorage.getItem(KEY);
  if (saved) {
    apply(saved);
  } else {
    apply(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem(KEY)) apply(e.matches ? 'dark' : 'light');
    });
  }

  btns.forEach(b => b.addEventListener('click', () => apply(b.dataset.theme)));
})();

/* ════════════════════════════════════════════════════
   3. TOAST NOTIFICATION SYSTEM
════════════════════════════════════════════════════ */
const Toast = (function() {
  const container = $('#toastContainer');
  const ICONS = { success: '✓', error: '⚠', info: 'ℹ', warning: '⚡' };
  const activeToasts = {}; // key -> element, so we can update/replace in place

  function show(title, msg, type = 'info', ms = 4200, key = null) {
    // If a keyed toast already exists (e.g. the "waking up server" notice),
    // update it in place instead of stacking duplicates.
    if (key && activeToasts[key]) {
      const el = activeToasts[key];
      el.className = `toast ${type}`;
      el.querySelector('.toast-icon').textContent = ICONS[type] || '📢';
      const titleEl = el.querySelector('.toast-title');
      const msgEl   = el.querySelector('.toast-msg');
      if (titleEl) titleEl.textContent = title || '';
      if (msgEl)   msgEl.textContent   = msg || '';
      clearTimeout(el._dismissTimer);
      if (ms > 0) el._dismissTimer = setTimeout(() => dismiss(el, key), ms);
      return el;
    }

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${ICONS[type] || '📢'}</span>
      <div class="toast-body">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        ${msg   ? `<div class="toast-msg">${msg}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close notification">✕</button>
    `;
    container?.appendChild(el);
    if (key) activeToasts[key] = el;

    function dismiss(node, k) {
      node.classList.add('toast-out');
      node.addEventListener('animationend', () => {
        node.remove();
        if (k && activeToasts[k] === node) delete activeToasts[k];
      }, { once: true });
    }

    el.querySelector('.toast-close').addEventListener('click', () => dismiss(el, key));
    if (ms > 0) el._dismissTimer = setTimeout(() => dismiss(el, key), ms);
    return el;
  }

  return {
    success: (t, m, d) => show(t, m, 'success', d),
    error:   (t, m, d) => show(t, m, 'error',   d),
    info:    (t, m, d, key) => show(t, m, 'info',     d ?? 4200, key),
    warn:    (t, m, d, key) => show(t, m, 'warning',  d ?? 4200, key),
    dismissKey: (key) => {
      const el = activeToasts[key];
      if (!el) return;
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => { el.remove(); delete activeToasts[key]; }, { once: true });
    }
  };
})();

/* ════════════════════════════════════════════════════
   4. PARTICLE CANVAS
════════════════════════════════════════════════════ */
(function particles() {
  const canvas = $('#bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, pts = [], raf;

  class P {
    constructor() { this.reset(); }
    reset() {
      this.x   = Math.random() * W;
      this.y   = Math.random() * H;
      this.r   = Math.random() * 1.3 + 0.2;
      this.vx  = (Math.random() - 0.5) * 0.22;
      this.vy  = (Math.random() - 0.5) * 0.22;
      this.a   = Math.random();
      this.da  = (Math.random() * 0.003 + 0.001) * (Math.random() < 0.5 ? 1 : -1);
      this.hue = [42, 228, 185][Math.floor(Math.random() * 3)];
    }
  }

  const resize = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; };
  const spawn = () => {
    const cap = W < 640 ? 34 : W < 1024 ? 56 : 78;
    pts = Array.from({ length: Math.min(Math.floor(W * H / 14000), cap) }, () => new P());
  };

  let paused = false;

  function draw() {
    if (paused) return;
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x = (p.x + p.vx + W) % W;
      p.y = (p.y + p.vy + H) % H;
      p.a = Math.max(0, Math.min(1, p.a + p.da));
      if (p.a <= 0 || p.a >= 1) p.da *= -1;

      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue},60%,65%,${p.a * 0.65})`; ctx.fill();

      for (let j = i + 1; j < pts.length; j++) {
        const dx = p.x - pts[j].x, dy = p.y - pts[j].y;
        const d = Math.hypot(dx, dy);
        if (d < 100) {
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = `hsla(${p.hue},55%,60%,${(1 - d / 100) * 0.07})`;
          ctx.lineWidth = 0.4; ctx.stroke();
        }
      }
    }
    raf = requestAnimationFrame(draw);
  }

  resize(); spawn(); draw();
  let deb;
  window.addEventListener('resize', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { cancelAnimationFrame(raf); resize(); spawn(); draw(); }, 200);
  });

  // Free up the main thread when the tab is backgrounded — a background
  // canvas animation gains the visitor nothing while they're on another tab.
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (!paused) { cancelAnimationFrame(raf); draw(); }
  });
})();

/* ════════════════════════════════════════════════════
   5. SCROLL PROGRESS
════════════════════════════════════════════════════ */
(function progressBar() {
  const fill = $('.scroll-progress-fill');
  if (!fill) return;
  function update() {
    const activeView = $('.spa-view--active');
    if (!activeView) return;
    const el  = activeView.classList.contains('spa-view--home') ? document.documentElement : activeView;
    const h   = el.scrollHeight - (activeView.classList.contains('spa-view--home') ? innerHeight : activeView.clientHeight);
    const pos = activeView.classList.contains('spa-view--home') ? window.scrollY : activeView.scrollTop;
    fill.style.width = h > 0 ? `${(pos / h) * 100}%` : '0%';
  }
  window.addEventListener('scroll', update, { passive: true });
  $$('.spa-view--page').forEach(v => v.addEventListener('scroll', update, { passive: true }));
})();

/* ════════════════════════════════════════════════════
   6. HEADER SCROLL STYLE
════════════════════════════════════════════════════ */
const headerEl = $('#header');
window.addEventListener('scroll', () => {
  headerEl?.classList.toggle('scrolled', scrollY > 40);
}, { passive: true });

/* ════════════════════════════════════════════════════
   7. MOBILE DRAWER
════════════════════════════════════════════════════ */
const drawer  = $('#mobDrawer');
const overlay = $('#mobOverlay');
const hamBtn  = $('#hamBtn');

function openDrawer() {
  drawer?.classList.add('open');
  overlay?.classList.add('show');
  hamBtn?.classList.add('open');
  hamBtn?.setAttribute('aria-expanded', 'true');
  drawer?.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  drawer?.classList.remove('open');
  overlay?.classList.remove('show');
  hamBtn?.classList.remove('open');
  hamBtn?.setAttribute('aria-expanded', 'false');
  drawer?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

hamBtn?.addEventListener('click', () =>
  drawer?.classList.contains('open') ? closeDrawer() : openDrawer()
);
overlay?.addEventListener('click', closeDrawer);
$('#closeDrawer')?.addEventListener('click', closeDrawer);

// Drawer's "Contact" item: always take the visitor home, then bring the
// on-page Contact card into view — works whether they opened the drawer
// from Home or from any other view.
$('#drawerContactBtn')?.addEventListener('click', () => {
  setTimeout(() => {
    document.getElementById('contactCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, currentView === 'home' ? 50 : 420);
});

/* ════════════════════════════════════════════════════
   8. ★ SPA ROUTER ★
════════════════════════════════════════════════════ */
const VIEWS     = ['home', 'services', 'gallery', 'about', 'reviews', 'contact'];
const scrollPos = {};
let   currentView = 'home';

function showView(id, pushHistory = true) {
  if (!VIEWS.includes(id)) id = 'home';
  if (id === currentView) return;

  const prev   = `view-${currentView}`;
  const next   = `view-${id}`;
  const prevEl = document.getElementById(prev);
  const nextEl = document.getElementById(next);
  if (!prevEl || !nextEl) return;

  scrollPos[currentView] = currentView === 'home'
    ? window.scrollY
    : prevEl.scrollTop;

  const goingHome = id === 'home';

  prevEl.classList.add(goingHome ? 'spa-view--exit-right' : 'spa-view--exit-left');
  prevEl.addEventListener('animationend', () => {
    prevEl.classList.remove('spa-view--active', 'spa-view--exit-left', 'spa-view--exit-right');
    prevEl.setAttribute('aria-hidden', 'true');
  }, { once: true });

  nextEl.classList.add(goingHome ? 'spa-view--enter-left' : 'spa-view--enter-right');
  nextEl.classList.add('spa-view--active');
  nextEl.setAttribute('aria-hidden', 'false');
  nextEl.addEventListener('animationend', () => {
    nextEl.classList.remove('spa-view--enter-right', 'spa-view--enter-left');
    if (id === 'home') {
      window.scrollTo({ top: scrollPos['home'] || 0, behavior: 'instant' });
      document.body.style.overflow = '';
    } else {
      nextEl.scrollTop = scrollPos[id] || 0;
      document.body.style.overflow = 'hidden';
    }
  }, { once: true });

  currentView = id;

  if (id !== 'home') document.body.style.overflow = 'hidden';

  if (pushHistory) {
    history.pushState({ view: id }, '', id === 'home' ? '#home' : `#${id}`);
  }

  updateNavActive(id);

  if (id !== 'home') setTimeout(() => triggerReveals(nextEl), 80);
  if (id === 'reviews') setTimeout(initCarousel, 120);
  if (id === 'services') {
    setTimeout(() => {
      const activeTab = $('.svc-tab.active');
      positionIndicator(activeTab);
    }, 120);
  }

  closeDrawer();
}

function navigateTo(viewId, tab) {
  showView(viewId);
  if (tab && viewId === 'services') {
    setTimeout(() => activateTab(tab), 150);
  }
}

function routeFromHash() {
  const hash = location.hash.replace('#', '') || 'home';
  const id   = VIEWS.includes(hash) ? hash : 'home';
  if (id !== currentView) {
    const prevEl = document.getElementById(`view-${currentView}`);
    const nextEl = document.getElementById(`view-${id}`);
    if (prevEl && nextEl) {
      prevEl.classList.remove('spa-view--active');
      prevEl.setAttribute('aria-hidden', 'true');
      nextEl.classList.add('spa-view--active');
      nextEl.setAttribute('aria-hidden', 'false');
      currentView = id;
      if (id !== 'home') document.body.style.overflow = 'hidden';
    }
    updateNavActive(id);
    if (id === 'reviews') setTimeout(initCarousel, 120);
    if (id === 'services') setTimeout(() => positionIndicator($('.svc-tab.active')), 120);
  }
}

window.addEventListener('hashchange', () => routeFromHash());
window.addEventListener('popstate', e => {
  const id = e.state?.view || 'home';
  if (id !== currentView) showView(id, false);
});

function updateNavActive(id) {
  $$('[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === id);
  });
  $$('.sdot').forEach(d => d.classList.toggle('active', d.dataset.target === id));
  // The fixed WhatsApp/Call bubbles can visually sit on top of the booking
  // wizard's Continue/Back buttons on short screens, silently swallowing
  // taps meant for the form. There's already a WhatsApp link and phone
  // number inside the booking flow itself, so hide the floating duplicates
  // while that view is open.
  document.body.classList.toggle('is-booking-view', id === 'contact');
}

document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-view]');
  if (!trigger) return;
  if (trigger.tagName === 'A') {
    const href = trigger.getAttribute('href') || '';
    if (!href.startsWith('#') && !href.startsWith('javascript')) return;
  }
  e.preventDefault();
  const viewId = trigger.dataset.view;
  const tab    = trigger.dataset.tab;
  if (viewId) navigateTo(viewId, tab);
});

/* ════════════════════════════════════════════════════
   9. REVEAL ANIMATIONS
════════════════════════════════════════════════════ */
function triggerReveals(container) {
  const revObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        revObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

  $$('.reveal, .reveal-left, .reveal-right, .reveal-fade', container).forEach(el => {
    el.classList.remove('visible');
    revObs.observe(el);
  });
}

const homeRevObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      homeRevObs.unobserve(e.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });
$$('#view-home .reveal, #view-home .reveal-left, #view-home .reveal-right').forEach(el => homeRevObs.observe(el));

/* ════════════════════════════════════════════════════
   10. SERVICES TAB SYSTEM
════════════════════════════════════════════════════ */
function positionIndicator(tab) {
  const ind = $('#tabIndicator');
  if (!tab || !ind) return;
  const r  = tab.getBoundingClientRect();
  const pr = tab.closest('.svc-tabs')?.getBoundingClientRect();
  if (!pr) return;
  ind.style.left  = (r.left - pr.left) + 'px';
  ind.style.width = r.width + 'px';
}

function activateTab(name) {
  $$('.svc-tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    if (on) positionIndicator(t);
  });
  $$('.svc-panel').forEach(p => {
    const on = p.id === `tab-${name}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
}

$$('.svc-tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

/* ════════════════════════════════════════════════════
   10a. BOOKING WIZARD — 4-step SPA flow inside the card
   Details → Service → Payment → Confirm. Steps swap via
   class/hidden toggles only — the booking card itself
   never moves or resizes the surrounding page, it just
   swaps its own inner content, so it stays put on screen
   as you move through it (per-step validation runs on
   only the currently visible step; native `required`
   fields on hidden steps are automatically excluded from
   constraint validation by the browser, so they can never
   block progress on an earlier step).
════════════════════════════════════════════════════ */
const BookingWizard = (function () {
  const TOTAL = 4;
  let current = 1;

  const stepEl = n => document.querySelector(`.form-step[data-step="${n}"]`);

  function validateStep(n) {
    const el = stepEl(n);
    if (!el) return true;
    const fields = $$('input, select, textarea', el).filter(f => f.required);
    const invalids = fields.filter(f => {
      const rule = FIELD_RULES[f.id];
      // A field with a stricter shared rule must pass THAT rule (not just
      // "non-empty") before it counts as valid for continuing.
      return rule ? !rule(f.value) : !f.checkValidity();
    });
    if (invalids.length) {
      invalids.forEach(f => {
        // The service select is visually hidden (the custom dropdown trigger
        // is what people actually see) — show the red-border feedback on
        // the trigger instead, or nobody would ever see it.
        const target = f.id === 'fservice' ? ($('#fserviceTrigger') || f) : f;
        target.style.borderColor = 'rgba(240,64,64,0.7)';
        target.style.boxShadow   = '0 0 0 3px rgba(240,64,64,0.1)';
        const clear = () => { target.style.borderColor = ''; target.style.boxShadow = ''; };
        target.addEventListener('input', clear, { once: true });
        target.addEventListener('click', clear, { once: true });
      });
      Toast.error('Check your details', 'One or more fields need to be entered correctly before continuing.');
      return false;
    }
    return true;
  }

  function render() {
    $$('.form-step').forEach(el => {
      const n = Number(el.dataset.step);
      const active = n === current;
      el.classList.toggle('form-step--active', active);
      el.hidden = !active;
    });
    $$('.bstep').forEach(tab => {
      const n = Number(tab.dataset.step);
      tab.classList.toggle('active', n === current);
      tab.classList.toggle('completed', n < current);
      tab.setAttribute('aria-selected', String(n === current));
      const numEl = tab.querySelector('.bstep-num');
      if (numEl) numEl.textContent = n < current ? '✓' : String(n);
    });
    $$('.bstep-line').forEach((line, i) => {
      line.classList.toggle('filled', (i + 1) < current);
    });
    // Focus the first field of the newly visible step for keyboard users,
    // but only after it's actually rendered (avoids focusing display:none),
    // and never the visually-hidden native <select> that backs the custom
    // service dropdown — its own trigger button is the visible control.
    requestAnimationFrame(() => {
      if (!window.matchMedia('(pointer: fine)').matches) return; // touch: don't pop the keyboard open on every step
      const el = stepEl(current);
      const target = el?.querySelector('.cs-trigger') || el?.querySelector('input:not(.cs-native), select:not(.cs-native), textarea');
      target?.focus({ preventScroll: true });
    });
  }

  function goTo(n, { validate = true } = {}) {
    n = Math.min(Math.max(n, 1), TOTAL);
    if (validate && n > current) {
      for (let s = current; s < n; s++) {
        if (!validateStep(s)) { current = s; render(); return; }
      }
    }
    current = n;
    render();
  }

  function reset() { current = 1; render(); }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-step-next]')) { goTo(current + 1); return; }
    if (e.target.closest('[data-step-back]')) { goTo(current - 1, { validate: false }); return; }
    const tab = e.target.closest('.bstep');
    if (tab) goTo(Number(tab.dataset.step));
  });

  render();
  return { goTo, reset };
})();

/* Payment method buttons: set the hidden #fpayment field and show a
   selected state, so the chosen method travels with the rest of the
   dispatch request on submit — this is step 3 of the wizard above. */
(function paymentSelector() {
  const buttons = $$('.pay-method');
  const hidden  = $('#fpayment');
  const box     = $('#payDetails');
  const amtWrap = $('#payAmountWrap');
  const amt     = $('#fpayamount');
  const status  = $('#fpaystatus');
  if (!buttons.length || !hidden) return;

  const C = PAYMENT_CONFIG;
  const naira = n => '₦' + Number(n).toLocaleString('en-NG');
  const STATUS = { 'Cash': 'pay_before_work', 'Bank Transfer': 'awaiting_transfer', 'USSD': 'awaiting_transfer', 'Debit / Credit Card': 'pending_card' };

  const WALLET = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2"/><circle cx="16.5" cy="14" r="1.2"/></svg>';
  const spaced = n => String(n).replace(/\s+/g, '').replace(/(\d{3})(?=\d)/g, '$1 ');
  const head = (title, sub, icon) =>
    `<div class="pay-card-head"><span class="pay-card-icon" aria-hidden="true">${icon || WALLET}</span><div><strong>${title}</strong><small>${sub}</small></div></div>`;
  const row = (k, v) => `<div class="pay-row"><dt>${k}</dt><dd>${v}</dd></div>`;
  const nextTitle = $('#payNextTitle'), nextText = $('#payNextText');
  const setNext = (t, x) => { if (nextTitle) nextTitle.textContent = t; if (nextText) nextText.textContent = x; };

  const receiptWrap = $('#payReceiptWrap');

  const quick = (k, v, extra) =>
    `<div class="pay-quick"><span class="pay-quick-k">${k}</span><span class="pay-quick-v">${v}</span>${extra || ''}</div>`;

  function render() {
    const m = hidden.value || 'Cash';
    const a = Math.round(Number(amt?.value) || 0);
    if (status) status.value = STATUS[m] || 'pay_before_work';
    if (amtWrap) amtWrap.hidden = (m === 'Cash');
    if (receiptWrap) receiptWrap.hidden = !(m === 'Bank Transfer' || m === 'USSD');
    if (!box) return;

    if (m === 'Cash') {
      box.innerHTML = head('Pay before work starts', 'Cash · in person', '₦') +
        quick('Total', 'Quoted after inspection');
      setNext('How cash payment works.', 'Workmanship and the full cost of materials must be paid before work can begin. We confirm your total after inspection, and you pay our technician in cash before work starts.');
    } else if (m === 'Bank Transfer') {
      box.innerHTML = head(C.accountName, `${C.bankName} · Bank transfer`) +
        quick('Account no.', spaced(C.accountNumber), `<button type="button" class="pay-copy" data-copy="${C.accountNumber}">Copy</button>`);
      setNext('How bank transfer works.', 'Workmanship and the full cost of materials must be paid before work can start. Transfer the total to the account above, then attach your receipt here or send it on WhatsApp.');
    } else if (m === 'USSD') {
      const opts = C.ussd.map((u, i) => `<option value="${i}">${u.bank}</option>`).join('');
      box.innerHTML = head('Pay by USSD', 'Any phone · no data needed') +
        `<select id="payBank" class="pay-select" aria-label="Your bank">${opts}</select><div id="payUssd"></div>`;
      const sel = $('#payBank'), out = $('#payUssd');
      const draw = () => {
        const u = C.ussd[sel.value];
        if (u.hint) {
          out.innerHTML = quick('Dial', `<code>${u.code()}</code>`, `<a class="pay-dial" href="tel:${encodeURIComponent(u.code())}">Dial</a>`) +
            `<p class="pay-msg">Choose Transfer, then ${C.bankName} account ${spaced(C.accountNumber)}${a ? ' · ' + naira(a) : ''}.</p>`;
          return;
        }
        if (!a) { out.innerHTML = '<p class="pay-msg">Enter the quoted total below to get your dial code.</p>'; return; }
        const code = u.code(a, C.accountNumber);
        out.innerHTML = quick('Dial', `<code>${code}</code>`, `<a class="pay-dial" href="tel:${encodeURIComponent(code)}">Dial</a>`) +
          `<p class="pay-msg">To ${C.accountName} · ${C.bankName}</p>`;
      };
      sel.addEventListener('change', draw); draw();
      setNext('How USSD payment works.', 'Workmanship and the full cost of materials must be paid before work can start. Dial the code, check the account name before you send, then attach your receipt here or on WhatsApp.');
    } else {
      const ok = C.paystackPublicKey && a >= 100;
      box.innerHTML = head('Debit / credit card', ok ? 'Secure checkout · Paystack' : 'Secure payment link') +
        quick('Total', a ? naira(a) : 'Enter the quoted total below');
      setNext('How card payment works.', ok
        ? 'Workmanship and the full cost of materials must be paid before work can start. After you send your booking, a secure Paystack window opens to pay in Naira. Add your email in step 1 for the receipt.'
        : 'Workmanship and the full cost of materials must be paid before work can start. We will send you a secure card payment link once your slot is confirmed.');
    }
  }

  /* Proof-of-payment upload (Bank Transfer / USSD) */
  const rIn = $('#freceipt'), rName = $('#payReceiptName'), rPrev = $('#payReceiptPreview'),
        rThumb = $('#payReceiptThumb'), rClear = $('#payReceiptClear');
  function clearReceipt() {
    if (!rIn) return;
    rIn.value = '';
    if (rThumb?.src) URL.revokeObjectURL(rThumb.src);
    if (rThumb) { rThumb.removeAttribute('src'); rThumb.hidden = true; }
    if (rPrev) rPrev.hidden = true;
    if (rName) rName.textContent = 'Attach your transfer receipt (photo or PDF)';
  }
  rIn?.addEventListener('change', () => {
    const f = rIn.files[0];
    if (!f) return clearReceipt();
    const isImg = f.type.startsWith('image/'), isPdf = f.type === 'application/pdf';
    if (!isImg && !isPdf) { clearReceipt(); Toast.error('Unsupported file', 'Please attach a photo or a PDF.'); return; }
    if (f.size > 10 * 1024 * 1024) { clearReceipt(); Toast.error('File too large', 'Receipt must be under 10MB.'); return; }
    if (receiptWrap) receiptWrap.open = true;
    if (rName) rName.textContent = f.name;
    if (rPrev) rPrev.hidden = false;
    if (rThumb) { if (isImg) { rThumb.src = URL.createObjectURL(f); rThumb.hidden = false; } else rThumb.hidden = true; }
  });
  rClear?.addEventListener('click', clearReceipt);

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('selected');
      btn.setAttribute('aria-checked', 'true');
      hidden.value = btn.dataset.method || '';
      render();
    });
  });
  amt?.addEventListener('input', () => { render(); });
  box?.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1500); });
  });
  render();
  window.FemixPay = { render, clearReceipt };
})();

/* ════════════════════════════════════════════════════
   10a-1. CONTACT CARD TOGGLE
   Collapsed by default (just the "Contact" label) —
   expands to reveal the six contact methods on click.
   Height is measured with scrollHeight so the open/close
   transition is smooth and accurate at any content size.
════════════════════════════════════════════════════ */
(function contactCardToggle() {
  const toggle = $('#contactToggle');
  const panel  = $('#contactPanel');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';

    if (isOpen) {
      // Collapse: measure current height first so the browser has a
      // concrete starting point to animate down from (not "auto").
      panel.style.maxHeight = panel.scrollHeight + 'px';
      requestAnimationFrame(() => {
        panel.classList.remove('qc-contact-panel--open');
        panel.style.maxHeight = '0px';
      });
      toggle.setAttribute('aria-expanded', 'false');
      panel.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName !== 'max-height') return;
        panel.hidden = true;
        panel.removeEventListener('transitionend', onEnd);
      });
    } else {
      panel.hidden = false;
      panel.style.maxHeight = '0px';
      requestAnimationFrame(() => {
        panel.classList.add('qc-contact-panel--open');
        panel.style.maxHeight = panel.scrollHeight + 'px';
      });
      toggle.setAttribute('aria-expanded', 'true');
      panel.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName !== 'max-height') return;
        panel.style.maxHeight = 'none'; // let it breathe if content reflows (resize, etc.)
        panel.removeEventListener('transitionend', onEnd);
      });
    }
  });

  // If the viewport resizes while open, "none" keeps it correct; if it's
  // mid-animation this is harmless since scrollHeight is re-measured on
  // every open.
  window.addEventListener('resize', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') panel.style.maxHeight = 'none';
  });
})();

/* ════════════════════════════════════════════════════
   10a-2. CUSTOM SERVICE DROPDOWN
   Drives the grouped, gold-accented dropdown that replaces
   the native <select> (whose open list is drawn by the OS
   on mobile and can't be restyled — no way to fix its blue
   selection dot or its size from CSS). The real #fservice
   select stays in sync underneath as the actual form data
   source and the thing the wizard's validation checks.
════════════════════════════════════════════════════ */
const ServiceSelect = (function () {
  const root     = $('#fserviceSelect');
  const trigger  = $('#fserviceTrigger');
  const valueEl  = $('#fserviceValue');
  const panel    = $('#fserviceList');
  const native   = $('#fservice');
  const dateTimeRow = $('#dateTimeRow');
  const step2Actions = $('#step2Actions');
  if (!root || !trigger || !panel || !native) return { setValue() {}, reset() {} };

  const options = $$('.cs-option', panel);

  function isOpen() { return !panel.hidden; }

  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    dateTimeRow?.classList.remove('dt-hidden');
    step2Actions?.classList.remove('dt-hidden');
  }

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // Hide Date/Time and the Back/Continue row while actively choosing a
    // service so the picker is the only thing competing for attention —
    // they all reappear as soon as a service is picked (or the panel is
    // dismissed) via close().
    dateTimeRow?.classList.add('dt-hidden');
    step2Actions?.classList.add('dt-hidden');
    const current = options.find(o => o.getAttribute('aria-selected') === 'true') || options[0];
    requestAnimationFrame(() => current?.focus({ preventScroll: true }));
  }

  function selectValue(text, { silent = false } = {}) {
    if (!text) return;
    let matched = false;
    for (const opt of native.options) {
      if (opt.textContent.trim().toLowerCase() === text.trim().toLowerCase()) {
        opt.selected = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const opt = document.createElement('option');
      opt.textContent = text;
      opt.value = text;
      opt.selected = true;
      native.insertBefore(opt, native.firstChild);
    }
    if (!silent) native.dispatchEvent(new Event('change', { bubbles: true }));

    valueEl.textContent = text;
    valueEl.classList.remove('cs-placeholder');
    options.forEach(o => {
      o.setAttribute('aria-selected', String(o.dataset.value.trim().toLowerCase() === text.trim().toLowerCase()));
    });
  }

  function reset() {
    valueEl.textContent = 'Select a service…';
    valueEl.classList.add('cs-placeholder');
    options.forEach(o => o.setAttribute('aria-selected', 'false'));
    native.selectedIndex = 0;
    dateTimeRow?.classList.remove('dt-hidden');
    step2Actions?.classList.remove('dt-hidden');
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      selectValue(opt.dataset.value);
      close();
      trigger.focus({ preventScroll: true });
    });
  });

  panel.addEventListener('keydown', e => {
    const idx = options.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
    else if (e.key === 'Escape') { close(); trigger.focus({ preventScroll: true }); }
  });

  document.addEventListener('click', e => {
    if (isOpen() && !root.contains(e.target)) close();
  });

  return { setValue: t => selectValue(t), reset };
})();

/* ════════════════════════════════════════════════════
   10b. BOOK-A-SERVICE ROUTING
   Any element carrying data-service (the big category
   "Book a Service →" buttons AND every individual
   service-item card in the 4-across grids) routes the
   visitor straight to the booking wizard (reset to step 1)
   and pre-selects that exact service for when they reach
   the Service step. Handled with one delegated listener so
   newly-added cards work for free.
════════════════════════════════════════════════════ */
function goToBookingWithService(serviceName) {
  ServiceSelect.setValue(serviceName);
  navigateTo('contact');
  BookingWizard.reset();
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.svc-item-btn, .panel-cta');
  if (!btn) return;
  e.preventDefault();
  const label = btn.dataset.service || (btn.querySelector('.svc-item-text')?.textContent) || '';
  if (label.trim()) goToBookingWithService(label.trim());
});

/* ── Gallery "Request a Quote for This" — same routing pattern as
   goToBookingWithService, but pre-fills the message field with a
   reference to the specific project photo instead of pre-selecting
   a service category (the photo doesn't map cleanly to one). ── */
function requestQuoteForProject(projectLabel) {
  navigateTo('contact');
  BookingWizard.reset();
  const msg = $('#fmsg');
  if (msg && !msg.value.trim()) {
    msg.value = `I saw your "${projectLabel}" project in the gallery and would like a quote for something similar.`;
  }
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.gallery-quote-btn');
  if (!btn) return;
  e.preventDefault();
  requestQuoteForProject(btn.dataset.project || 'this project');
});

/* ════════════════════════════════════════════════════
   10c. INSTANT QUOTE ESTIMATOR
   Pure client-side lookup — no backend call. Picks a
   [service][size] cell from PRICE_TABLE and shows it as
   a range, clearly labeled as an estimate. "Book This
   Service" routes into the real booking form the same
   way the service cards do, with size noted in the
   message field.

   🔧 EDIT ME — every number below is a placeholder.
   Replace with your real pricing before relying on this
   in production. Values are in Naira (₦), [min, max].
════════════════════════════════════════════════════ */
const PRICE_TABLE = {
  'Residential Plumbing Solution':             { small: [15000,  35000],  medium: [40000,  90000],   large: [100000, 250000]  },
  'Bathroom & Kitchen Upgrades':               { small: [50000,  120000], medium: [150000, 350000],  large: [400000, 900000]  },
  'Pipe Installation & Repiping':              { small: [20000,  50000],  medium: [60000,  150000],  large: [180000, 450000]  },
  'Toilet & Fixture Installation':             { small: [12000,  30000],  medium: [35000,  80000],   large: [90000,  200000]  },
  'Commercial and Estate Plumbing Systems':    { small: [100000, 250000], medium: [300000, 700000],  large: [800000, 2000000] },
  'Water System, Borehole & Pump Solutions':   { small: [150000, 350000], medium: [400000, 900000],  large: [1000000,2500000] },
  'Leak Detection & Diagnostic Services':      { small: [10000,  25000],  medium: [30000,  60000],   large: [70000,  150000]  },
  'Water Efficiency & Conservation Systems':   { small: [30000,  70000],  medium: [80000,  200000],  large: [250000, 600000]  },
  'Drain Cleaning & Unclogging':               { small: [8000,   20000],  medium: [25000,  55000],   large: [60000,  130000]  },
  'Water Heater Installation & Repair':        { small: [20000,  45000],  medium: [50000,  120000],  large: [130000, 300000]  },
  'Gas Line Installation & Repair':            { small: [25000,  60000],  medium: [70000,  160000],  large: [180000, 400000]  },
  'Emergency Call-Out (24/7)':                 { small: [15000,  40000],  medium: [45000,  100000],  large: [120000, 300000]  }
};
const SIZE_LABELS = { small: 'a small job', medium: 'a medium job', large: 'a large job' };

function formatNaira(n) {
  return '₦' + n.toLocaleString('en-NG');
}

/* ── Generic compact dropdown factory ──
   Same visual/behavioral pattern as the booking form's service
   picker (custom-select / cs-trigger / cs-panel / cs-option), but
   reusable for any trigger+panel pair. Used so the estimator's two
   fields open this compact anchored panel instead of the browser's
   native <select>, which on mobile takes over the entire screen. */
function createCompactDropdown({ triggerId, panelId, valueId, placeholder }) {
  const trigger = $('#' + triggerId);
  const panel   = $('#' + panelId);
  const valueEl = $('#' + valueId);
  if (!trigger || !panel || !valueEl) return { getValue: () => '', setValue() {}, reset() {}, shake() {} };

  const root    = trigger.closest('.custom-select');
  const options = $$('.cs-option', panel);
  let value = '';

  function isOpen() { return !panel.hidden; }
  function close() { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const current = options.find(o => o.getAttribute('aria-selected') === 'true') || options[0];
    requestAnimationFrame(() => current?.focus({ preventScroll: true }));
  }
  function select(text) {
    value = text;
    valueEl.textContent = options.find(o => o.dataset.value === text)?.textContent.trim() || text;
    valueEl.classList.remove('cs-placeholder');
    options.forEach(o => o.setAttribute('aria-selected', String(o.dataset.value === text)));
  }
  function reset() {
    value = '';
    valueEl.textContent = placeholder;
    valueEl.classList.add('cs-placeholder');
    options.forEach(o => o.setAttribute('aria-selected', 'false'));
  }
  function shake() {
    trigger.classList.add('est-shake');
    trigger.focus();
    setTimeout(() => trigger.classList.remove('est-shake'), 400);
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  options.forEach(opt => {
    opt.addEventListener('click', () => { select(opt.dataset.value); close(); trigger.focus({ preventScroll: true }); });
  });
  panel.addEventListener('keydown', e => {
    const idx = options.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
    else if (e.key === 'Escape') { close(); trigger.focus({ preventScroll: true }); }
  });
  document.addEventListener('click', e => {
    if (isOpen() && root && !root.contains(e.target)) close();
  });

  return { getValue: () => value, setValue: select, reset, shake };
}


(function initEstimator() {
  const calcBtn   = $('#estCalcBtn');
  const bookBtn   = $('#estBookBtn');
  const result    = $('#estResult');
  const resultVal = $('#estResultValue');
  if (!calcBtn) return;

  const serviceDD = createCompactDropdown({ triggerId: 'estServiceTrigger', panelId: 'estServiceList', valueId: 'estServiceValue', placeholder: 'Choose a service' });
  const sizeDD    = createCompactDropdown({ triggerId: 'estSizeTrigger',    panelId: 'estSizeList',    valueId: 'estSizeValue',    placeholder: 'Choose a size' });

  let lastService = '';
  let lastSize    = '';

  calcBtn.addEventListener('click', () => {
    const service = serviceDD.getValue();
    const size    = sizeDD.getValue();

    if (!service) { serviceDD.shake(); return; }
    if (!size)    { sizeDD.shake();    return; }

    const range = PRICE_TABLE[service]?.[size];
    if (!range) return; // shouldn't happen — every service/size combo is covered above

    lastService = service;
    lastSize    = size;
    resultVal.textContent = `${formatNaira(range[0])} – ${formatNaira(range[1])}`;
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  bookBtn?.addEventListener('click', () => {
    goToBookingWithService(lastService);
    const msg = $('#fmsg');
    if (msg && !msg.value.trim()) {
      msg.value = `I got an estimate for ${SIZE_LABELS[lastSize] || 'this job'} and would like to book it.`;
    }
  });
})();

/* ════════════════════════════════════════════════════
   10d. ATTACHMENTS PANEL — collapsed by default
   Voice Note / Video / Photos are grouped behind one
   toggle so the form reads shorter. On open, the three
   attach-blocks reveal one after another (staggered via
   the --stagger custom property set on each block).
   Height is measured with scrollHeight for a smooth,
   accurate expand/collapse at any content size — same
   pattern used elsewhere on this site (e.g. the old
   contact-card toggle).
════════════════════════════════════════════════════ */
function collapseAttachPanel() {
  const toggle = $('#attachToggle');
  const panel  = $('#attachPanel');
  if (!toggle || !panel) return;
  panel.classList.remove('attach-panel--open');
  panel.style.maxHeight = '0px';
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
}

(function attachPanelToggle() {
  const toggle = $('#attachToggle');
  const panel  = $('#attachPanel');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';

    if (isOpen) {
      panel.style.maxHeight = panel.scrollHeight + 'px';
      requestAnimationFrame(() => {
        panel.classList.remove('attach-panel--open');
        panel.style.maxHeight = '0px';
      });
      toggle.setAttribute('aria-expanded', 'false');
      panel.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName !== 'max-height') return;
        panel.hidden = true;
        panel.removeEventListener('transitionend', onEnd);
      });
    } else {
      panel.hidden = false;
      panel.style.maxHeight = '0px';
      requestAnimationFrame(() => {
        panel.classList.add('attach-panel--open');
        panel.style.maxHeight = panel.scrollHeight + 'px';
      });
      toggle.setAttribute('aria-expanded', 'true');
      panel.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName !== 'max-height') return;
        panel.style.maxHeight = 'none'; // let it breathe if content reflows (e.g. previews appear)
        panel.removeEventListener('transitionend', onEnd);
      });
    }
  });

  window.addEventListener('resize', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') panel.style.maxHeight = 'none';
  });
})();

/* ── Nested per-block accordions (Voice Note / Video / Photos) ──
   Each block's header is its own toggle, independent of the others,
   so opening one doesn't force the rest open too — keeps the whole
   attachments card compact even with all three present. Same
   scrollHeight-measured smooth expand/collapse as the outer toggle. */
document.addEventListener('click', e => {
  const toggle = e.target.closest('.attach-block-toggle');
  if (!toggle) return;
  const body = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!body) return;
  const isOpen = toggle.getAttribute('aria-expanded') === 'true';

  if (isOpen) {
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => {
      body.classList.remove('attach-body--open');
      body.style.maxHeight = '0px';
    });
    toggle.setAttribute('aria-expanded', 'false');
    body.addEventListener('transitionend', function onEnd(ev) {
      if (ev.propertyName !== 'max-height') return;
      body.hidden = true;
      body.removeEventListener('transitionend', onEnd);
    });
  } else {
    body.hidden = false;
    body.style.maxHeight = '0px';
    requestAnimationFrame(() => {
      body.classList.add('attach-body--open');
      body.style.maxHeight = body.scrollHeight + 'px';
    });
    toggle.setAttribute('aria-expanded', 'true');
    body.addEventListener('transitionend', function onEnd(ev) {
      if (ev.propertyName !== 'max-height') return;
      body.style.maxHeight = 'none'; // let it breathe if a preview appears afterward
      body.removeEventListener('transitionend', onEnd);
    });
  }
});

/* ── Footer newsletter form ──
   POSTs to /subscribe on the same Render backend the booking form
   already uses. Requires that endpoint to exist server-side — see
   the backend snippet provided alongside this change if it doesn't
   yet. Fails gracefully (with an honest message) if the endpoint
   isn't there yet, rather than pretending to succeed. */
document.getElementById('footerNewsletterForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const emailInput = document.getElementById('ftrNewsletterEmail');
  const btn = form.querySelector('.ftr-newsletter-btn');
  const note = document.getElementById('ftrNewsletterNote');
  if (!emailInput || !note) return;

  const email = emailInput.value.trim();
  if (!email) return;

  btn?.setAttribute('disabled', 'true');
  note.hidden = false;
  note.textContent = 'Subscribing…';

  try {
    const res = await fetch(SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success !== false) {
      note.textContent = "You're subscribed! Watch your inbox for plumbing tips and offers.";
      emailInput.value = '';
    } else if (res.status === 409) {
      note.textContent = "You're already on the list — thanks for sticking around!";
    } else {
      throw new Error(data.message || 'Subscribe failed');
    }
  } catch (err) {
    note.textContent = "Something went wrong — please try again, or reach us directly via WhatsApp.";
    console.error('Newsletter subscribe error:', err.message);
  } finally {
    btn?.removeAttribute('disabled');
  }
});

/* ════════════════════════════════════════════════════
   10e. SITE SEARCH — sticky bar below the gallery strip.
   Pure client-side: a small curated index of pages, services,
   tools, and footer company-info topics, filtered live as the
   person types. Selecting a result navigates or scrolls-and-
   opens the matching destination — no backend involved.
════════════════════════════════════════════════════ */
function goToEstimator() {
  if (currentView !== 'home') navigateTo('home');
  setTimeout(() => {
    document.getElementById('estimator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, currentView !== 'home' ? 350 : 0);
}
function goToBookingForm() {
  if (currentView !== 'home') navigateTo('home');
  setTimeout(() => {
    document.getElementById('contactCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, currentView !== 'home' ? 350 : 0);
}
function goToFounderSpotlight() {
  if (currentView !== 'home') navigateTo('home');
  setTimeout(() => {
    document.querySelector('.ftr-founder-spotlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, currentView !== 'home' ? 350 : 0);
}

const SEARCH_INDEX = [
  { label: 'Home',                    cat: 'Page',    icon: '🏠', keywords: 'home main homepage start',                          action: () => navigateTo('home') },
  { label: 'Services',                cat: 'Page',    icon: '🔧', keywords: 'services plumbing residential commercial industrial maintenance', action: () => navigateTo('services') },
  { label: 'Gallery',                 cat: 'Page',    icon: '🖼️', keywords: 'gallery photos work portfolio pictures',              action: () => navigateTo('gallery') },
  { label: 'About Us',                cat: 'Page',    icon: '🏅', keywords: 'about us story company who we are',                  action: () => navigateTo('about') },
  { label: 'Reviews',                 cat: 'Page',    icon: '⭐', keywords: 'reviews testimonials clients feedback rating',        action: () => navigateTo('reviews') },
  { label: 'Book a Service / Contact',cat: 'Page',    icon: '💬', keywords: 'contact book booking appointment call whatsapp reach us', action: goToBookingForm },
  { label: 'Get an Instant Estimate', cat: 'Tool',     icon: '💰', keywords: 'estimate price quote calculator cost how much',      action: goToEstimator },
  { label: "Founder's Profile",       cat: 'Company',  icon: '👤', keywords: 'founder ceo owner nuhn wasiu femi profile',          action: goToFounderSpotlight },

  { label: 'Leak Detection',              cat: 'Service', icon: '💧', keywords: 'leak detection diagnostic water loss', action: () => navigateTo('services') },
  { label: 'Pressure Testing',            cat: 'Service', icon: '🧪', keywords: 'pressure testing pipe check',           action: () => navigateTo('services') },
  { label: 'Water Engineering',           cat: 'Service', icon: '⚙️', keywords: 'water engineering systems design',       action: () => navigateTo('services') },
  { label: 'Borehole Pump Installation',  cat: 'Service', icon: '🚰', keywords: 'borehole pump installation water tank', action: () => navigateTo('services') },
  { label: 'Plumbing Maintenance',        cat: 'Service', icon: '🔩', keywords: 'plumbing maintenance service contract', action: () => navigateTo('services') },
  { label: 'Building Pipe Installation',  cat: 'Service', icon: '🔧', keywords: 'building pipe installation new construction', action: () => navigateTo('services') },
];

(function initSiteSearch() {
  const bar     = document.getElementById('siteSearchBar');
  const input   = document.getElementById('siteSearchInput');
  const results = document.getElementById('siteSearchResults');
  const clearBtn = document.getElementById('siteSearchClear');
  if (!bar || !input || !results || !clearBtn) return;

  let activeIndex = -1;
  let currentMatches = [];

  function renderResults(matches) {
    currentMatches = matches;
    activeIndex = -1;
    if (!matches.length) {
      results.innerHTML = '<div class="site-search-empty">No matches — try a different term.</div>';
      results.hidden = false;
      return;
    }
    results.innerHTML = matches.slice(0, 8).map((m, i) => `
      <button type="button" class="site-search-item" data-idx="${i}" role="option">
        <span class="site-search-item-icon" aria-hidden="true">${m.icon}</span>
        <span class="site-search-item-text">
          <span class="site-search-item-label">${m.label}</span>
          <span class="site-search-item-cat">${m.cat}</span>
        </span>
      </button>
    `).join('');
    results.hidden = false;
  }

 function selectMatch(match) {
    if (!match) return;
    match.action();
    results.hidden = true;
    input.value = '';
    clearBtn.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    bar.classList.remove('is-expanded');
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      currentMatches = [];
      return;
    }
    const matches = SEARCH_INDEX.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q)
    );
    renderResults(matches);
    input.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
    clearBtn.hidden = false;
  }

  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('focus', () => {
    bar.classList.add('is-expanded');
    if (input.value.trim()) runSearch(input.value);
  });

  clearBtn.addEventListener('pointerdown', (e) => e.preventDefault());

  clearBtn.addEventListener('click', () => {
    input.value = '';
    results.hidden = true;
    clearBtn.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    bar.classList.remove('is-expanded');
    input.blur();
    clearBtn.blur();
  });

  results.addEventListener('click', e => {
    const btn = e.target.closest('.site-search-item');
    if (!btn) return;
    selectMatch(currentMatches[Number(btn.dataset.idx)]);
  });

  input.addEventListener('keydown', e => {
    if (results.hidden || !currentMatches.length) return;
    const items = [...results.querySelectorAll('.site-search-item')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
      items[activeIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
      items[activeIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectMatch(currentMatches[activeIndex] ?? currentMatches[0]);
    } else if (e.key === 'Escape') {
      results.hidden = true;
      bar.classList.remove('is-expanded');
      input.blur();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (!bar.contains(e.target)) {
      bar.classList.remove('is-expanded');
      results.hidden = true;
    }
  });
})();

/* ════════════════════════════════════════════════════
   11. REVIEW CAROUSEL
════════════════════════════════════════════════════ */
let carouselInitted = false;

function initCarousel() {
  const track    = $('#reviewsTrack');
  const prevBtn  = $('#revPrev');
  const nextBtn  = $('#revNext');
  const pipsWrap = $('#revPips');
  if (!track) return;

  const cards = $$('.review-card', track);
  let current = 0, perView, auto;

  const ppv = () => window.innerWidth < 700 ? 1 : window.innerWidth < 1024 ? 2 : 3;

  function buildPips() {
    if (!pipsWrap) return;
    pipsWrap.innerHTML = '';
    const count = Math.ceil(cards.length / perView);
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'pip' + (i === 0 ? ' on' : '');
      d.addEventListener('click', () => goto(i));
      pipsWrap.appendChild(d);
    }
  }

  function goto(idx) {
    const count = Math.ceil(cards.length / perView);
    current = ((idx % count) + count) % count;
    const w = (cards[0]?.offsetWidth || 0) + 20;
    track.style.transform = `translateX(-${current * perView * w}px)`;
    $$('.pip', pipsWrap).forEach((d, i) => d.classList.toggle('on', i === current));
  }

  function next() { goto(current + 1); }
  function prev() { goto(current - 1); }
  function resetAuto() { clearInterval(auto); auto = setInterval(next, 5200); }

  const newPrev = prevBtn?.cloneNode(true);
  const newNext = nextBtn?.cloneNode(true);
  prevBtn?.parentNode?.replaceChild(newPrev, prevBtn);
  nextBtn?.parentNode?.replaceChild(newNext, nextBtn);
  newPrev?.addEventListener('click', () => { prev(); resetAuto(); });
  newNext?.addEventListener('click', () => { next(); resetAuto(); });

  let tx = 0;
  track.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 45) { dx < 0 ? next() : prev(); resetAuto(); }
  });

  perView = ppv();
  buildPips();
  goto(0);
  resetAuto();

  let rd;
  window.addEventListener('resize', () => {
    clearTimeout(rd);
    rd = setTimeout(() => { perView = ppv(); buildPips(); goto(0); }, 250);
  });
}

/* ════════════════════════════════════════════════════
   12. 3D TILT CARDS
════════════════════════════════════════════════════ */
document.addEventListener('mousemove', e => {
  const card = e.target.closest('.tilt-card, .pillar');
  if (!card) return;
  const { left, top, width, height } = card.getBoundingClientRect();
  const x = (e.clientX - left) / width  - 0.5;
  const y = (e.clientY - top)  / height - 0.5;
  card.style.transform = `perspective(700px) rotateX(${-y * 7}deg) rotateY(${x * 7}deg) translateZ(6px)`;
  card.style.setProperty('--mx', `${((e.clientX - left) / width) * 100}%`);
  card.style.setProperty('--my', `${((e.clientY - top) / height) * 100}%`);
});
document.addEventListener('mouseleave', e => {
  const card = e.target.closest('.tilt-card, .pillar');
  if (card) card.style.transform = 'perspective(700px) rotateX(0) rotateY(0) translateZ(0)';
}, true);

/* ════════════════════════════════════════════════════
   13. MODAL SYSTEM
════════════════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  if (currentView === 'home') document.body.style.overflow = 'hidden';
  setTimeout(() => el.querySelector('button')?.focus(), 100);
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  if (currentView === 'home' && !$$('.modal-overlay.open').length) {
    document.body.style.overflow = '';
  }
}

/* Hero / nav "Book" buttons → go to contact view */
/* Hero / nav CTAs now route to Services via their own data-view="services"
   attribute (handled by the generic [data-view] delegated click handler
   above) — booking itself only ever starts from inside the Services view. */

/* Success modal close — use closeModal() everywhere for consistency */
$('#closeSuccessModal')?.addEventListener('click', () => closeModal('successModal'));
$('#successDoneBtn')?.addEventListener('click', () => closeModal('successModal'));

$$('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $$('.modal-overlay.open').forEach(m => closeModal(m.id));
});

/* ════════════════════════════════════════════════════
   14. SUCCESS CHIME
════════════════════════════════════════════════════ */
let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

function playChime() {
  try {
    const ctx = getAudioCtx();

    const doPlay = () => {
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();

        const osc2  = ctx.createOscillator();
        const gain2 = ctx.createGain();

        osc.connect(gain);   gain.connect(ctx.destination);
        osc2.connect(gain2); gain2.connect(ctx.destination);

        osc.type  = 'sine';
        osc2.type = 'sine';
        osc.frequency.value  = freq;
        osc2.frequency.value = freq * 1.003;

        const t0 = ctx.currentTime + i * 0.20;

        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.22, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);

        gain2.gain.setValueAtTime(0, t0);
        gain2.gain.linearRampToValueAtTime(0.08, t0 + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);

        osc.start(t0);  osc.stop(t0 + 1.2);
        osc2.start(t0); osc2.stop(t0 + 1.2);
      });
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(doPlay).catch(() => {});
    } else {
      doPlay();
    }
  } catch {
    /* Audio not supported — silent fail */
  }
}

/* ════════════════════════════════════════════════════
   15. FIELD VALIDATION CHECKMARKS
   Live green tick indicator for Name / Email / Phone /
   Site Address on the booking form. Uses the same
   FIELD_RULES the wizard uses to gate Continue, so a
   green tick always means "this will actually let you
   proceed" — never just "not empty".
════════════════════════════════════════════════════ */
(function fieldCheckmarks() {
  Object.keys(FIELD_RULES).forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    const wrap  = input.closest('.field-input-wrap');
    const check = wrap?.querySelector('.field-check');
    if (!wrap || !check) return;

    const evaluate = () => {
      const ok = FIELD_RULES[id](input.value);
      input.classList.toggle('field-valid', ok);
      check.classList.toggle('show', ok);
    };

    input.addEventListener('input', evaluate);
    input.addEventListener('blur', evaluate);
    evaluate(); // in case of autofill on load
  });

  // Autofill (Chrome) sometimes populates fields without firing 'input'.
  // A short poll right after load catches that case for free.
  window.addEventListener('load', () => {
    setTimeout(() => {
      Object.keys(FIELD_RULES).forEach(id => {
        document.getElementById(id)?.dispatchEvent(new Event('input'));
      });
    }, 600);
  });
})();

/* ════════════════════════════════════════════════════
   15b. MEDIA ATTACHMENTS — voice note, video, photos
   Optional multimedia for the booking's Confirm step.
   Everything captured here is converted to base64 and
   travels inside the same JSON payload the booking form
   already sends — no backend format change required for
   the existing text fields, which keep working exactly
   as before. Size/duration caps keep the request sane.
════════════════════════════════════════════════════ */
const MediaAttachments = (function () {
  const LIMITS = {
    imageMaxBytes: 10 * 1024 * 1024,  // 10MB per photo — matches backend ATTACHMENT_LIMITS.image
    imageMaxCount: 4,
    videoMaxBytes: 30 * 1024 * 1024,  // 30MB — matches backend ATTACHMENT_LIMITS.video
    audioMaxSeconds: 60,              // cap for in-browser recording
    audioMaxBytes: 20 * 1024 * 1024   // cap for uploaded audio files — matches backend ATTACHMENT_LIMITS.voice
  };

  let voiceBlob = null;
  let videoFile = null;
  let images = []; // [{ file, dataUrl }]

  const voiceBtn        = $('#voiceRecBtn');
  const voiceTime       = $('#voiceRecTime');
  const voicePrev       = $('#voicePreview');
  const voiceAudio      = $('#voiceAudioEl');
  const voiceRemoveBtn  = $('#voiceRemoveBtn');
  const voiceRecorderEl = $('#voiceRecorder');
  const voiceUploadRow  = $('#voiceUploadRow');
  const voiceUploadInput = $('#voiceUploadInput');

  const videoCaptureInput = $('#videoCaptureInput');
  const videoUploadInput  = $('#videoUploadInput');
  const videoPreview      = $('#videoPreview');
  const videoPreviewEl    = $('#videoPreviewEl');
  const videoMeta         = $('#videoMeta');
  const videoRemoveBtn    = $('#videoRemoveBtn');
  const videoActions      = $('#videoActions');

  const imageCaptureInput = $('#imageCaptureInput');
  const imageUploadInput  = $('#imageUploadInput');
  const imageGrid         = $('#imagePreviewGrid');

  /* ---------- helpers ---------- */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  /* ---------- voice recording ---------- */
  let mediaRecorder = null, recChunks = [], recStream = null, recTimer = null, recStart = 0;

  async function startRecording() {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      Toast.error('Not supported', "Voice recording isn't supported in this browser.");
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        Toast.error('Microphone blocked', "This browser/app has no mic access — use \"Upload Audio\" below instead, or check your browser's site permissions.");
      } else if (err?.name === 'NotFoundError') {
        Toast.error('No microphone found', 'Try "Upload Audio" below instead.');
      } else {
        Toast.error('Microphone unavailable', 'Try "Upload Audio" below instead.');
      }
      return;
    }
    recChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(recStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = onRecordingStop;
    mediaRecorder.start();
    recStart = Date.now();
    voiceBtn?.classList.add('recording');
    recTimer = setInterval(() => {
      const elapsed = (Date.now() - recStart) / 1000;
      if (voiceTime) voiceTime.textContent = fmtTime(elapsed) + ' / 1:00';
      if (elapsed >= LIMITS.audioMaxSeconds) stopRecording();
    }, 200);
  }

  function stopRecording() {
    clearInterval(recTimer);
    voiceBtn?.classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recStream?.getTracks().forEach(t => t.stop());
  }

  function onRecordingStop() {
    const blob = new Blob(recChunks, { type: recChunks[0]?.type || 'audio/webm' });
    if (blob.size < 500) {
      Toast.error('Too short', 'That recording was too short — try again.');
      resetVoiceUI();
      return;
    }
    voiceBlob = blob;
    if (voiceAudio) voiceAudio.src = URL.createObjectURL(blob);
    showVoicePreview();
  }

  function showVoicePreview() {
    if (voicePrev) voicePrev.hidden = false;
    if (voiceRecorderEl) voiceRecorderEl.hidden = true;
    if (voiceUploadRow) voiceUploadRow.hidden = true;
  }

  function resetVoiceUI() {
    voiceBlob = null;
    if (voicePrev) voicePrev.hidden = true;
    if (voiceRecorderEl) voiceRecorderEl.hidden = false;
    if (voiceUploadRow) voiceUploadRow.hidden = false;
    if (voiceTime) voiceTime.textContent = 'Tap to record';
    if (voiceUploadInput) voiceUploadInput.value = '';
  }

  voiceBtn?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    else startRecording();
  });
  voiceRemoveBtn?.addEventListener('click', resetVoiceUI);

  // Fallback for when in-browser recording isn't available (blocked mic,
  // unsupported WebView, etc.) — attach an audio file recorded elsewhere.
  voiceUploadInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      Toast.error('Unsupported file', 'Please choose an audio file.');
      return;
    }
    if (file.size > LIMITS.audioMaxBytes) {
      Toast.error('Audio too large', `Please keep voice notes under ${fmtBytes(LIMITS.audioMaxBytes)}.`);
      return;
    }
    voiceBlob = file;
    if (voiceAudio) voiceAudio.src = URL.createObjectURL(file);
    showVoicePreview();
  });

  /* ---------- video ---------- */
  function handleVideoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      Toast.error('Unsupported file', 'Please choose a video file.');
      return;
    }
    if (file.size > LIMITS.videoMaxBytes) {
      Toast.error('Video too large', `Please keep videos under ${fmtBytes(LIMITS.videoMaxBytes)}.`);
      return;
    }
    videoFile = file;
    if (videoPreviewEl) videoPreviewEl.src = URL.createObjectURL(file);
    if (videoMeta) videoMeta.textContent = `${file.name} · ${fmtBytes(file.size)}`;
    if (videoPreview) videoPreview.hidden = false;
    if (videoActions) videoActions.hidden = true;
  }
  videoCaptureInput?.addEventListener('change', e => handleVideoFile(e.target.files[0]));
  videoUploadInput?.addEventListener('change', e => handleVideoFile(e.target.files[0]));
  videoRemoveBtn?.addEventListener('click', () => {
    videoFile = null;
    if (videoPreviewEl) videoPreviewEl.src = '';
    if (videoPreview) videoPreview.hidden = true;
    if (videoActions) videoActions.hidden = false;
    if (videoCaptureInput) videoCaptureInput.value = '';
    if (videoUploadInput) videoUploadInput.value = '';
  });

  /* ---------- images ---------- */
  function renderImageGrid() {
    if (!imageGrid) return;
    imageGrid.innerHTML = '';
    images.forEach((img, i) => {
      const div = document.createElement('div');
      div.className = 'img-thumb';
      div.innerHTML = `<img src="${img.dataUrl}" alt="Attached photo ${i + 1}">` +
        `<button type="button" class="attach-remove" aria-label="Remove photo ${i + 1}">✕</button>`;
      div.querySelector('.attach-remove').addEventListener('click', () => {
        images.splice(i, 1);
        renderImageGrid();
      });
      imageGrid.appendChild(div);
    });
  }

  // Resizes/re-encodes a photo on <canvas> before it ever gets converted to
  // base64 — a phone camera shot straight out of the gallery is often 8-12MB
  // at 4000px+ wide, which is slow to upload for no real benefit here. This
  // brings it down to something reasonable while keeping the 10MB cap as a
  // generous ceiling rather than the typical size.
  function compressImage(file, { maxDimension = 1600, quality = 0.78 } = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) { height = Math.round(height * (maxDimension / width)); width = maxDimension; }
          else                { width  = Math.round(width  * (maxDimension / height)); height = maxDimension; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          blob ? resolve(blob) : reject(new Error('Canvas produced no blob'));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image failed to load')); };
      img.src = url;
    });
  }

  async function handleImageFiles(fileList) {
    for (const file of [...fileList]) {
      if (images.length >= LIMITS.imageMaxCount) {
        Toast.error('Limit reached', `You can attach up to ${LIMITS.imageMaxCount} photos.`);
        break;
      }
      if (!file.type.startsWith('image/')) {
        Toast.error('Unsupported file', `${file.name} isn't an image.`);
        continue;
      }

      // Compress first, then check the resulting size — so the 10MB cap is
      // a safety ceiling, not the size most photos actually hit.
      let toStore = file;
      try {
        const compressed = await compressImage(file);
        if (compressed.size < file.size) toStore = compressed;
      } catch {
        // Compression failed (e.g. an odd format canvas can't decode) —
        // fall back to the original file and let the size check below judge it.
      }

      if (toStore.size > LIMITS.imageMaxBytes) {
        Toast.error('Photo too large', `${file.name} is over ${fmtBytes(LIMITS.imageMaxBytes)}, even after compression.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(toStore);
        images.push({ file: toStore, dataUrl, name: file.name });
      } catch {
        Toast.error('Read error', `Couldn't read ${file.name}.`);
      }
    }
    renderImageGrid();
  }
  imageCaptureInput?.addEventListener('change', e => { handleImageFiles(e.target.files); e.target.value = ''; });
  imageUploadInput?.addEventListener('change', e => { handleImageFiles(e.target.files); e.target.value = ''; });

  /* ---------- collect + reset (used by the form-submit handler) ---------- */
  async function collect() {
    const attachments = [];
    if (voiceBlob) {
      attachments.push({
        kind: 'voice', name: 'voice-note.webm', type: voiceBlob.type, size: voiceBlob.size,
        data: await fileToDataUrl(voiceBlob)
      });
    }
    if (videoFile) {
      attachments.push({
        kind: 'video', name: videoFile.name, type: videoFile.type, size: videoFile.size,
        data: await fileToDataUrl(videoFile)
      });
    }
    for (const img of images) {
      attachments.push({ kind: 'image', name: img.name || img.file.name, type: img.file.type, size: img.file.size, data: img.dataUrl });
    }
    return attachments;
  }

  /* Real File/Blob objects for multipart upload (no base64 bloat) */
  function files() {
    const out = [];
    if (voiceBlob) {
      const t = voiceBlob.type || '';
      const ext = t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : t.includes('mpeg') ? 'mp3' : 'webm';
      out.push({ field: 'voice', file: voiceBlob, name: voiceBlob.name || ('voice-note.' + ext) });
    }
    if (videoFile) out.push({ field: 'video', file: videoFile, name: videoFile.name });
    images.forEach(img => out.push({ field: 'photos', file: img.file, name: img.name || img.file.name }));
    return out;
  }

  function reset() {
    resetVoiceUI();
    videoFile = null;
    if (videoPreviewEl) videoPreviewEl.src = '';
    if (videoPreview) videoPreview.hidden = true;
    if (videoActions) videoActions.hidden = false;
    if (videoCaptureInput) videoCaptureInput.value = '';
    if (videoUploadInput) videoUploadInput.value = '';
    images = [];
    renderImageGrid();
  }

  function hasAttachments() {
    return !!voiceBlob || !!videoFile || images.length > 0;
  }

  return { collect, files, reset, hasAttachments };
})();

/* ════════════════════════════════════════════════════
   16. FORM SUBMIT
════════════════════════════════════════════════════ */
/* Network helpers: wake the (sleeping) backend, shrink big photos, and
   upload as multipart with progress, timeout and a clear error reason. */
const FemixNet = (() => {
  const ORIGIN = new URL(BACKEND_URL).origin;
  let last = 0;
  async function warm(force, wait = 45000) {
    if (!force && Date.now() - last < 240000) return;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), wait);
    try { await fetch(ORIGIN + '/health', { mode: 'no-cors', cache: 'no-store', signal: c.signal }); last = Date.now(); }
    catch { /* still asleep or offline — the submit will report it */ }
    finally { clearTimeout(t); }
  }
  async function shrinkImage(f) {
    const file = f.file;
    if (f.field !== 'photos' || !file.type.startsWith('image/') || file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
      if (blob) { f.name = f.name.replace(/\.\w+$/, '') + '.jpg'; return blob; }
    } catch { /* keep the original */ }
    return file;
  }
  function post(url, formData, onProgress, timeoutMs = 150000) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
      };
      xhr.onerror   = () => reject(new Error('network'));
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.send(formData);
    });
  }
  setTimeout(() => warm(false), 2500);
  return { warm, shrinkImage, post };
})();

function launchPaystack({ email, amount, bookingId }) {
  const key = PAYMENT_CONFIG.paystackPublicKey;
  if (!key || !window.PaystackPop || !email || amount < 100) return false;
  const ref = 'FMX-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  window.PaystackPop.setup({
    key, email, amount: amount * 100, currency: 'NGN', ref,
    metadata: { booking_id: bookingId || '' },
    callback: function (res) {
      fetch(PAYMENT_VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, reference: res.reference }) })
        .then(r => r.json().catch(() => ({})))
        .then(d => d.paid ? Toast.success('Payment received', 'Thank you — ₦' + amount.toLocaleString('en-NG') + ' paid.')
                          : Toast.info('Payment pending', 'We are confirming your payment.'))
        .catch(() => Toast.info('Payment pending', 'We are confirming your payment.'));
    },
    onClose: function () { Toast.info('Payment not completed', 'You can pay later — we will send a link.'); }
  }).openIframe();
  return true;
}

async function handleForm(form, btn) {
  // ── Client-side validation ──
  const invalids = [...form.querySelectorAll(':invalid')];
  if (invalids.length) {
    invalids.forEach(f => {
      f.style.borderColor = 'rgba(240,64,64,0.7)';
      f.style.boxShadow   = '0 0 0 3px rgba(240,64,64,0.1)';
      f.addEventListener('input', () => {
        f.style.borderColor = '';
        f.style.boxShadow   = '';
      }, { once: true });
    });
    invalids[0].focus();
    Toast.error('Incomplete', 'Please fill in all required fields.');
    return;
  }

  const progressWrap = $('#uploadProgress');
  const progressFill = $('#uploadProgressFill');

  // ── Loading state — a single "Sending…" stage, no separate "uploading"
  // phase to sit through first, since it's really just one network request ──
  const orig = btn.innerHTML;
  const hasMedia = MediaAttachments.hasAttachments();
  btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Sending…</span>';
  btn.disabled  = true;

  if (hasMedia && progressWrap) {
    progressWrap.hidden = false;
    progressFill.style.width = '0%';
  }

  try {
    const fd = new FormData(form);
    const method    = fd.get('payment_method') || 'Cash';
    const payAmount = Math.round(Number(fd.get('payment_amount')) || 0);
    const payEmail  = String(fd.get('email') || '').trim();

    const body = new FormData();
    [['name','name'],['phone','phone'],['address','address'],['issue','service'],['date','preferred_date'],
     ['time','preferred_time'],['email','email'],['message','message'],['payment_method','payment_method'],
     ['payment_amount','payment_amount'],['payment_status','payment_status']]
      .forEach(([k, src]) => body.append(k, fd.get(src) || ''));
    body.append('currency', 'NGN');
    for (const f of MediaAttachments.files()) {
      const blob = await FemixNet.shrinkImage(f);
      body.append(f.field, blob, f.name);
    }

    const receiptFile = $('#freceipt')?.files[0];
    if (receiptFile && (method === 'Bank Transfer' || method === 'USSD')) {
      const rf = { field: 'photos', file: receiptFile, name: receiptFile.name };
      const blob = await FemixNet.shrinkImage(rf);
      body.append('receipt', blob, rf.name);
    }

    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Connecting…</span>';
    await FemixNet.warm(false);
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Sending…</span>';

    let r;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        r = await FemixNet.post(BACKEND_URL, body, pct => { if (progressFill) progressFill.style.width = pct + '%'; });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>Retrying…</span>';
        await FemixNet.warm(true, 60000);
      }
    }

    if (r.ok) {
      // ★ Reset form before showing success UI
      form.reset();

      // Reset checkmark state since the fields are now empty
      $$('.field-check.show').forEach(c => c.classList.remove('show'));
      $$('.field-input-wrap input.field-valid').forEach(i => i.classList.remove('field-valid'));

      // ★ Back to step 1 for the next visitor / next booking
      BookingWizard.reset();
      ServiceSelect.reset();
      MediaAttachments.reset();
      collapseAttachPanel();
      if (progressWrap) progressWrap.hidden = true;

      // Visually reset payment method selection to match the hidden field's
      // reset value (form.reset() reverts the value but not our own classes)
      $$('.pay-method').forEach(b => {
        const isCash = b.dataset.method === 'Cash';
        b.classList.toggle('selected', isCash);
        b.setAttribute('aria-checked', String(isCash));
      });

      window.FemixPay?.clearReceipt();
      window.FemixPay?.render();

      // ★ Card payment (Paystack) when configured
      if (method === 'Debit / Credit Card') setTimeout(() => launchPaystack({ email: payEmail, amount: payAmount, bookingId: r.body?.bookingId || r.body?.id }), 900);

      // ★ Play chime (AudioContext already warmed by earlier user interaction)
      playChime();

      // ★ Open success modal via openModal() so .open class is added correctly
      setTimeout(() => openModal('successModal'), 80);

      // ★ Toast
      Toast.success('Booking Confirmed!', "We'll confirm your slot within 30 minutes.");

      // ★ Browser push notification (if granted)
      notify('✅ Booking Received', 'FEMIX team will confirm your slot within 30 minutes.');

    } else {
      // Server returned non-2xx
      const serverMsg = r.status === 413 ? 'Your files are too large — remove the video or use smaller photos.'
                      : (r.body?.message || 'Please try again or call us directly.');
      Toast.error('Send failed', serverMsg);
      if (progressWrap) progressWrap.hidden = true;
    }

  } catch (networkErr) {
    console.error('Booking error:', networkErr);
    Toast.error(networkErr.message === 'timeout' ? 'Taking too long' : 'Could not reach our server',
      networkErr.message === 'timeout'
        ? 'The upload timed out. Try on a stronger connection or without the video.'
        : 'Check your connection and try again. If it keeps failing, call or WhatsApp us.');
    if (progressWrap) progressWrap.hidden = true;
  } finally {
    btn.innerHTML = orig;
    btn.disabled  = false;
  }
}

/* ── Attach submit handler to the one booking form ── */
$('#contactForm')?.addEventListener('submit', e => {
  e.preventDefault();
  handleForm(e.target, $('#submitBtn'));
});

/* ════════════════════════════════════════════════════
   17. PWA + BROWSER NOTIFICATIONS
════════════════════════════════════════════════════ */
async function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'images/femix-logo.webp', tag: 'femix' }); }
    catch { /* Safari */ }
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setTimeout(() => {
  if ('Notification' in window && Notification.permission === 'default') {
    Toast.info('Stay Updated', 'Enable notifications for FEMIX service alerts.', 6000);
  }
}, 16000);

/* ════════════════════════════════════════════════════
   17b. ON-SCREEN KEYBOARD AWARENESS
   On phones the keyboard can sit on top of the field being typed in,
   and the page then can't scroll far enough to lift it clear. This
   (1) measures the keyboard, (2) adds matching space at the bottom of
   the page so it CAN scroll, (3) hides the bottom tab bar while typing,
   and (4) scrolls the focused field to the middle of what's visible.
════════════════════════════════════════════════════ */
(function keyboardAware() {
  const vv = window.visualViewport;
  const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
  const NON_TEXT = ['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'];
  const isField = el => !!el && TYPING.test(el.tagName) && !NON_TEXT.includes(el.type);

  function setKeyboard(px) {
    document.documentElement.style.setProperty('--kb', px + 'px');
    document.body.classList.toggle('kb-open', px > 120);
  }
  function measure() {
    if (!vv) return;
    setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
  }
  function reveal(el) {
    setTimeout(() => {
      if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 320); // wait for the keyboard animation to finish
  }

  vv?.addEventListener('resize', () => {
    measure();
    if (isField(document.activeElement)) reveal(document.activeElement);
  });
  vv?.addEventListener('scroll', measure);
  document.addEventListener('focusin', e => { if (isField(e.target)) reveal(e.target); });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isField(document.activeElement)) setKeyboard(0); }, 150);
  });
})();

/* ════════════════════════════════════════════════════
   18. FOOTER YEAR
════════════════════════════════════════════════════ */
const yr = $('#yr');
if (yr) yr.textContent = new Date().getFullYear();

/* ════════════════════════════════════════════════════
   19. BUTTON RIPPLE
════════════════════════════════════════════════════ */
(function ripple() {
  const style = document.createElement('style');
  style.textContent = '@keyframes ripple{from{transform:scale(0);opacity:1}to{transform:scale(4);opacity:0}}';
  document.head.appendChild(style);

  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-primary, .panel-cta, .btn-emg, .nav-cta, .spa-qcard, .svc-item-btn, .pay-method, .btn-step, .bstep');
    if (!btn) return;
    const r   = btn.getBoundingClientRect();
    const dot = document.createElement('span');
    dot.style.cssText = `
      position:absolute;border-radius:50%;
      width:70px;height:70px;margin:-35px;
      background:rgba(255,255,255,0.15);pointer-events:none;
      animation:ripple 0.55s ease-out forwards;
      left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;
    `;
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  });
})();

/* ════════════════════════════════════════════════════
   19b. HERO BANNER PARALLAX
════════════════════════════════════════════════════ */
(function heroParallax() {
  const img = $('.hero-banner-img');
  if (!img) return;
  img.classList.add('parallax');

  function update() {
    const hero = $('#hero');
    if (!hero) return;
    const rect = hero.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    const offset = rect.top * 0.12;
    img.style.transform = `translateY(${offset}px) scale(1.06)`;
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
})();

/* ════════════════════════════════════════════════════
   20. INIT ON LOAD
════════════════════════════════════════════════════ */
window.addEventListener('load', () => {
  routeFromHash();
  setTimeout(() => positionIndicator($('.svc-tab.active')), 200);
  if (location.hash === '#reviews') setTimeout(initCarousel, 200);
});

/* ════════════════════════════════════════════════════
   21. SERVICES MOTION
   Word-by-word intro animation (replays every time the page opens),
   scroll-triggered staggered reveal for the service rows, and a soft
   gold spotlight that follows the finger/cursor. Skipped entirely when
   the device asks for reduced motion.
════════════════════════════════════════════════════ */
(function servicesMotion() {
  const view = $('#view-services');
  if (!view || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function split(root, mode) {
    let i = 0;
    (function walk(node) {
      [...node.childNodes].forEach(c => {
        if (c.nodeType === 1) { if (c.tagName !== 'BR') walk(c); return; }
        if (c.nodeType !== 3) return;
        const frag = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach(p => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.append(p); return; }
          const s = document.createElement('span');
          s.style.setProperty('--d', i++);
          s.textContent = p;
          if (mode === 'mask') {
            const w = document.createElement('span');
            w.className = 'w'; s.className = 'wi';
            w.append(s); frag.append(w);
          } else {
            s.className = 'lw'; frag.append(s);
          }
        });
        c.replaceWith(frag);
      });
    })(root);
  }

  const h = $('.sec-h2', view), lead = $('.sec-lead', view);
  if (h) split(h, 'mask');
  if (lead) split(lead, 'fade');
  view.classList.add('txt-anim');

  const playIntro = () => { void view.offsetWidth; view.classList.add('intro-play'); };
  let wasOn = view.classList.contains('spa-view--active');
  new MutationObserver(() => {
    const on = view.classList.contains('spa-view--active');
    if (on && !wasOn) {                       // just opened: reset, then play after the slide-in
      view.classList.remove('intro-play');
      setTimeout(playIntro, 250);
    }
    wasOn = on;
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
  if (wasOn) setTimeout(playIntro, 300);

  /* Rows reveal as they scroll into view, staggered within each batch */
  if ('IntersectionObserver' in window) {
    view.classList.add('svc-anim');
    const io = new IntersectionObserver(entries => {
      let n = 0;
      entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        .forEach(e => {
          const el = e.target;
          el.style.transitionDelay = (n++ * 70) + 'ms';
          el.classList.add('in');
          io.unobserve(el);
          setTimeout(() => { el.style.transitionDelay = ''; }, 1000 + n * 70);
        });
    }, { threshold: 0.15 });
    $$('.svc-item-btn', view).forEach(b => io.observe(b));
  }

  /* Spotlight follows the pointer / finger */
  const track = e => {
    const b = e.target.closest?.('.svc-item-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    b.style.setProperty('--my', (e.clientY - r.top) + 'px');
    return b;
  };
  view.addEventListener('pointermove', track);
  view.addEventListener('pointerdown', e => track(e)?.classList.add('is-lit'));
  ['pointerup', 'pointercancel'].forEach(t =>
    view.addEventListener(t, () => setTimeout(() => $$('.svc-item-btn.is-lit', view).forEach(b => b.classList.remove('is-lit')), 350)));
})();
