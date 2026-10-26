/*
 * Portal motion — original, dependency-free motion layer.
 * startBoot(): call once before loading content; resolves when the opening
 * screen starts its exit. Rendered content should emit portal:content-ready.
 * animatePage({isHome}): call after each page render; call its returned cleanup
 * before replacing that page. No document paragraphs are hidden or rewritten.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let bootPromise;
let bootComplete = false;

export function startBoot({force = false} = {}) {
  if (bootPromise && (!force || !bootComplete)) return bootPromise;
  if (force) {
    bootPromise = undefined;
    bootComplete = false;
    window.__portalBootComplete = false;
  }

  bootPromise = new Promise(resolve => {
    const box = document.getElementById('portal-boot');
    const bar = document.getElementById('boot-bar');
    const percent = document.getElementById('boot-percent');
    const log = document.getElementById('boot-log');
    const skip = document.getElementById('boot-skip');
    const body = document.body;
    const inertTargets = Array.from(document.querySelectorAll('#header, #main, #footer'))
      .map(element => ({element, wasInert:element.inert}));
    const started = performance.now();
    const minimum = 2200;
    const maximum = 6500;
    let sceneReady = Boolean(window.__portalSceneReady);
    let contentReady = Boolean(window.__portalContentReady);
    let frame = 0;
    let closing = false;
    let completed = false;
    let shown = 0;
    let exitTimer;
    let lastStage = -1;

    // Keep keyboard focus in the opening screen while it covers the portal.
    // Header/main/footer elements remain stable when their contents rerender.
    inertTargets.forEach(({element}) => { element.inert = true; });

    if (force && box) {
      box.classList.remove('is-complete');
      box.removeAttribute('aria-hidden');
      box.inert = false;
    }

    const labels = [
      'Инициализация портала…',
      'Загрузка визуального модуля…',
      'Подготовка материалов службы…',
      'Портал готов'
    ];

    // The progress describes this opening presentation, not authentication.
    function draw(value) {
      shown = Math.max(shown, Math.min(100, value));
      const integer = Math.floor(shown);
      if (bar) bar.style.width = `${shown.toFixed(1)}%`;
      if (percent) percent.textContent = `${String(integer).padStart(2, '0')}%`;
      const stage = integer >= 100 ? 3 : integer >= 65 ? 2 : integer >= 22 ? 1 : 0;
      // Do not announce the changing numeric percentage to screen readers.
      if (log && stage !== lastStage) {
        lastStage = stage;
        log.textContent = labels[stage];
      }
    }

    function release() {
      if (completed) return;
      completed = true;
      closing = true;
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      clearTimeout(exitTimer);
      window.removeEventListener('portal:scene-ready', onScene);
      window.removeEventListener('portal:content-ready', onContent);
      document.removeEventListener('keydown', onKey);
      skip?.removeEventListener('click', onSkip);
      draw(100);
      box?.classList.add('is-complete');
      box?.setAttribute('aria-hidden', 'true');
      if (box) box.inert = true;
      inertTargets.forEach(({element, wasInert}) => { element.inert = wasInert; });
      body.classList.remove('is-booting', 'is-intro');
      bootComplete = true;
      window.__portalBootComplete = true;
      if (box?.contains(document.activeElement)) {
        document.getElementById('main')?.focus({preventScroll:true});
      }
      resolve();
      window.dispatchEvent(new CustomEvent('portal:boot-complete'));
    }

    function finish(skipDelay = false) {
      if (closing || completed) return;
      closing = true;
      draw(100);
      if (skipDelay || reduced()) release();
      else exitTimer = setTimeout(release, 260);
    }

    function onScene() { sceneReady = true; }
    function onContent() { contentReady = true; window.__portalContentReady = true; }
    function onSkip() { finish(true); }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(true);
      }
    }

    function tick(now) {
      if (closing || completed) return;
      const elapsed = now - started;
      const staged = 7 + 82 * (1 - Math.exp(-elapsed / 800));
      const ready = sceneReady && contentReady;
      const target = ready && elapsed > minimum - 500
        ? Math.min(99, 85 + (elapsed - minimum + 500) * 0.028)
        : Math.min(89, staged);
      draw(target);
      if ((ready && elapsed >= minimum) || elapsed >= maximum) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    const deadline = setTimeout(release, maximum);
    window.addEventListener('portal:scene-ready', onScene);
    window.addEventListener('portal:content-ready', onContent);
    document.addEventListener('keydown', onKey);
    skip?.addEventListener('click', onSkip);
    if (percent) percent.setAttribute('aria-hidden', 'true');
    if (!box || reduced()) {
      release();
      return;
    }
    body.classList.add('is-booting', 'is-intro');
    draw(0);
    frame = requestAnimationFrame(tick);
  });

  return bootPromise;
}

export function animatePage({isHome = false} = {}) {
  let disposed = false;
  let initialized = false;
  const animations = new Set();
  const frames = new Set();
  const observers = [];
  const removers = [];
  const page = document.getElementById('main');
  const reduce = reduced();
  const reveals = Array.from(page?.querySelectorAll('.ref-reveal') || []);
  const counters = Array.from(page?.querySelectorAll('.ref-stat-value[data-count]') || []);

  // A failing animation can never leave a navigation header or page hidden.
  function play(element, keyframes, options) {
    if (!element || disposed || reduce || !element.animate) return;
    try {
      const animation = element.animate(keyframes, {fill:'both', ...options});
      animations.add(animation);
      animation.finished.then(() => {
        animations.delete(animation);
        animation.cancel();
      }, () => animations.delete(animation));
      if (document.hidden) animation.pause();
    } catch {
      // Base CSS is the fully visible, usable state.
    }
  }

  function enqueue(callback) {
    const id = requestAnimationFrame(time => {
      frames.delete(id);
      if (!disposed) callback(time);
    });
    frames.add(id);
  }

  function counterValue(element, value) {
    const suffix = element.dataset.suffix || '';
    const decimals = Number.isInteger(value) ? 0 : 1;
    const formatted = Number(value).toLocaleString('ru-RU', {
      minimumFractionDigits:decimals,
      maximumFractionDigits:decimals
    });
    element.textContent = formatted + suffix;
  }

  function runCounter(element) {
    if (element.dataset.motionCounted) return;
    element.dataset.motionCounted = 'true';
    const goal = Number(element.dataset.count) || 0;
    if (reduce || document.hidden) { counterValue(element, goal); return; }
    const began = performance.now();
    const duration = 1350;
    function count(now) {
      if (!element.isConnected || disposed) return;
      if (document.hidden) { counterValue(element, goal); return; }
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      counterValue(element, progress === 1 ? goal : Math.round(goal * eased));
      if (progress < 1) enqueue(count);
    }
    counterValue(element, 0);
    enqueue(count);
  }

  function intro() {
    if (!isHome || reduce) return;
    const ease = 'cubic-bezier(.16,1,.3,1)';
    page?.querySelectorAll('.ref-letter').forEach((letter, index) => {
      play(letter, [
        {opacity:0, transform:'translate3d(0,65%,0) rotate(3deg)', filter:'blur(4px)'},
        {opacity:1, transform:'translate3d(0,0,0) rotate(0deg)', filter:'blur(0)'}
      ], {duration:1250, delay:index * 85, easing:ease});
    });
    const groups = [
      ['.ref-kicker', 100],
      ['.ref-subtitle', 350],
      ['.ref-lead', 490],
      ['.ref-actions > *', 620],
      ['.ref-note', 800],
      ['.ref-hero-bottom', 740]
    ];
    groups.forEach(([selector, delay]) => {
      page?.querySelectorAll(selector).forEach((element, index) => {
        play(element, [
          {opacity:0, transform:'translate3d(0,22px,0)'},
          {opacity:1, transform:'translate3d(0,0,0)'}
        ], {duration:850, delay:delay + index * 80, easing:ease});
      });
    });
    document.querySelectorAll('.header-inner > *').forEach((element, index) => {
      play(element, [
        {opacity:0, transform:'translate3d(0,-12px,0)'},
        {opacity:1, transform:'translate3d(0,0,0)'}
      ], {duration:750, delay:100 + index * 70, easing:ease});
    });
  }

  function revealAll() { reveals.forEach(element => element.classList.add('is-revealed')); }

  function initialize() {
    if (disposed || initialized) return;
    initialized = true;
    document.body.classList.remove('is-intro');
    if (reduce || !('IntersectionObserver' in window)) {
      revealAll();
      counters.forEach(runCounter);
    } else {
      document.body.classList.add('motion-enabled');
      const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const element = entry.target;
          const siblings = element.parentElement
            ? Array.from(element.parentElement.children).filter(child => child.classList.contains('ref-reveal'))
            : [];
          const index = Math.max(0, siblings.indexOf(element));
          element.style.transitionDelay = `${Math.min(240, index * 65)}ms`;
          element.classList.add('is-revealed');
          revealObserver.unobserve(element);
        });
      }, {rootMargin:'0px 0px -6% 0px', threshold:0.08});
      reveals.forEach(element => revealObserver.observe(element));
      observers.push(revealObserver);

      const counterObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          runCounter(entry.target);
          counterObserver.unobserve(entry.target);
        });
      }, {threshold:0.5});
      counters.forEach(element => counterObserver.observe(element));
      observers.push(counterObserver);
    }
    if (isHome) observeSections();
    intro();
  }

  function observeSections() {
    if (!('IntersectionObserver' in window)) return;
    const links = Array.from(document.querySelectorAll('.ref-nav a[href*="section="]'));
    const entries = links.map(link => {
      const query = (link.getAttribute('href') || '').split('?')[1] || '';
      const id = new URLSearchParams(query).get('section');
      const section = id ? document.getElementById(id) : null;
      return section ? {link, id, section} : null;
    }).filter(Boolean);
    if (!entries.length) return;
    const visible = new Set();
    const top = page?.querySelector('#top');
    const sections = new Map(entries.map(entry => [entry.section, entry]));

    function mark(id) {
      entries.forEach(entry => {
        const active = entry.id === id;
        entry.link.classList.toggle('active', active);
        if (active) entry.link.setAttribute('aria-current', 'location');
        else entry.link.removeAttribute('aria-current');
      });
    }

    const sectionObserver = new IntersectionObserver(changes => {
      if (disposed) return;
      changes.forEach(change => {
        if (change.isIntersecting) visible.add(change.target);
        else visible.delete(change.target);
      });
      const candidates = Array.from(visible).filter(section => sections.has(section));
      candidates.sort((a,b) => Math.abs(a.getBoundingClientRect().top - innerHeight * 0.3)
        - Math.abs(b.getBoundingClientRect().top - innerHeight * 0.3));
      if (candidates.length) mark(sections.get(candidates[0]).id);
      else if (top && visible.has(top)) mark(null);
    }, {rootMargin:'-30% 0px -50% 0px', threshold:0});

    entries.forEach(entry => sectionObserver.observe(entry.section));
    if (top) sectionObserver.observe(top);
    observers.push(sectionObserver);
  }

  function onVisibility() {
    animations.forEach(animation => {
      try { document.hidden ? animation.pause() : animation.play(); } catch { /* finished */ }
    });
  }
  document.addEventListener('visibilitychange', onVisibility);
  removers.push(() => document.removeEventListener('visibilitychange', onVisibility));

  // Scroll work is consolidated to one animation frame.
  let headerFrame = 0;
  const header = document.getElementById('header');
  function updateHeader() {
    header?.classList.toggle('is-stuck', window.scrollY > 24);
    headerFrame = 0;
  }
  function onScroll() {
    if (!headerFrame) {
      headerFrame = requestAnimationFrame(updateHeader);
    }
  }
  updateHeader();
  window.addEventListener('scroll', onScroll, {passive:true});
  removers.push(() => {
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(headerFrame);
  });

  // Native details/summary semantics keep keyboard behavior intact.
  const questions = Array.from(page?.querySelectorAll('.ref-faq details') || []);
  questions.forEach(question => {
    function onToggle() {
      if (!question.open || disposed) return;
      questions.forEach(other => { if (other !== question) other.open = false; });
      Array.from(question.children).filter(child => child.tagName !== 'SUMMARY').forEach(child => {
        play(child, [{opacity:0, transform:'translateY(-6px)'}, {opacity:1, transform:'translateY(0)'}], {
          duration:320, easing:'ease-out'
        });
      });
    }
    question.addEventListener('toggle', onToggle);
    removers.push(() => question.removeEventListener('toggle', onToggle));
  });

  function onBootComplete() {
    if (initialized) intro();
    else initialize();
  }
  window.addEventListener('portal:boot-complete', onBootComplete);
  removers.push(() => window.removeEventListener('portal:boot-complete', onBootComplete));

  if (bootComplete || window.__portalBootComplete || !document.body.classList.contains('is-booting')) {
    initialize();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    observers.forEach(observer => observer.disconnect());
    removers.forEach(remove => remove());
    frames.forEach(id => cancelAnimationFrame(id));
    animations.forEach(animation => animation.cancel());
    frames.clear();
    animations.clear();
    reveals.forEach(element => {
      element.classList.add('is-revealed');
      element.style.removeProperty('transition-delay');
    });
    counters.forEach(element => counterValue(element, Number(element.dataset.count) || 0));
  };
}
