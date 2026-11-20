/* Motion layer: GSAP (ScrollTrigger, SplitText) and Lenis smooth scroll. Degrades to the plain story if the libraries are missing. */
(function () {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.gsap || reduced) return;
  const { gsap } = window;
  gsap.registerPlugin(window.ScrollTrigger, window.SplitText);
  const ST = window.ScrollTrigger;

  // smooth scroll
  if (window.Lenis) {
    const lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
    window.LENIS = lenis;
    lenis.on('scroll', ST.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // cursor spotlight
  const spot = document.createElement('div'); spot.className = 'spot'; document.body.appendChild(spot);
  const sx = gsap.quickTo(spot, 'x', { duration: 0.6, ease: 'power3' }), sy = gsap.quickTo(spot, 'y', { duration: 0.6, ease: 'power3' });
  addEventListener('pointermove', e => { sx(e.clientX); sy(e.clientY); }, { passive: true });

  // giant outlined scene numbers that drift with scroll
  document.querySelectorAll('.scene').forEach((sc, i) => {
    if (i === 0) return;
    const n = document.createElement('span'); n.className = 'bignum'; n.textContent = String(i).padStart(2, '0'); n.setAttribute('aria-hidden', 'true'); sc.prepend(n);
    gsap.fromTo(n, { xPercent: 30 }, { xPercent: -40, ease: 'none', scrollTrigger: { trigger: sc, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // split-character headline reveals
  document.querySelectorAll('.scene h2').forEach(h => {
    h.classList.remove('rv');
    const split = new window.SplitText(h, { type: 'words,chars', wordsClass: 'sw', charsClass: 'sc' });
    gsap.set(split.chars, { yPercent: 115, rotateX: -80, opacity: 0 });
    const play = () => gsap.to(split.chars, { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.018, overwrite: true });
    const hide = () => gsap.set(split.chars, { yPercent: 115, rotateX: -80, opacity: 0 });
    ST.create({ trigger: h, start: 'top 85%', onEnter: play, onEnterBack: play, onLeaveBack: hide });
  });

  // scrambled step labels
  const glyphs = '01#%&*+=<>/\\ABCDEFGHJKLMNPRSTUVXYZ';
  function scramble(el) {
    const final = el.dataset.final || (el.dataset.final = el.textContent);
    let f = 0; const total = 22;
    clearInterval(el._s);
    el._s = setInterval(() => {
      f++;
      el.textContent = final.split('').map((ch, i) => (ch === ' ' || ch === '·') ? ch : (i < (f / total) * final.length ? ch : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
      if (f >= total) { el.textContent = final; clearInterval(el._s); }
    }, 34);
  }
  document.querySelectorAll('.scene .step, .hero .kicker').forEach(el => ST.create({ trigger: el, start: 'top 90%', onEnter: () => scramble(el), onEnterBack: () => scramble(el) }));

  // panels tilt in with depth
  document.querySelectorAll('.scene .visual .panel, .cardrow .panel').forEach(p => {
    gsap.fromTo(p, { rotateX: 14, rotateY: -10, y: 60, transformPerspective: 1200 }, { rotateX: 0, rotateY: 0, y: 0, ease: 'power2.out', scrollTrigger: { trigger: p, start: 'top bottom', end: 'top 45%', scrub: 0.6 } });
  });

  // hero: globe pulls back, copy lifts away
  ST.create({ trigger: '#s0', start: 'top top', end: 'bottom top', scrub: true, onUpdate: s => { if (window.FXGLOBE) window.FXGLOBE.setScroll(s.progress); } });
  gsap.to('#s0 .copy', { yPercent: -18, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: '#s0', start: 'top top', end: 'bottom top', scrub: true } });

  // ribbon speed follows scroll velocity
  const track = document.querySelector('.ribbon .track');
  if (track) {
    const tween = gsap.to(track, { xPercent: -50, ease: 'none', duration: 28, repeat: -1 });
    ST.create({ onUpdate: s => { const v = Math.min(5, 1 + Math.abs(s.getVelocity()) / 600); gsap.to(tween, { timeScale: v * (s.direction < 0 ? -1 : 1), duration: 0.3, overwrite: true }); gsap.to(tween, { timeScale: 1, duration: 1.2, delay: 0.3 }); } });
  }

  addEventListener('load', () => ST.refresh());
})();
