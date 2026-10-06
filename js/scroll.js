// Smooth scrolling (Lenis) + scroll-driven effects: progress bar, hero parallax, reveals.
// Everything degrades to normal native scrolling if Lenis fails to load or the user
// prefers reduced motion.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const bar = document.getElementById('scrollProgress');
const parallax = [...document.querySelectorAll('[data-speed]')];
const hero = document.getElementById('top');
const reveals = [...document.querySelectorAll('.reveal, .hero-title')];

// ---------- reveals ----------
if (reduced || !('IntersectionObserver' in window)) {
  reveals.forEach((n) => n.classList.add('in'));
} else {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  reveals.forEach((n) => io.observe(n));
}

// ---------- scroll-linked effects ----------
function onScroll(y) {
  const max = root.scrollHeight - window.innerHeight;
  if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  if (reduced || !hero) return;
  const h = hero.offsetHeight;
  if (y > h * 1.2) return;
  for (const n of parallax) n.style.transform = `translate3d(0, ${y * parseFloat(n.dataset.speed)}px, 0)`;
  hero.style.setProperty('--fade', String(Math.max(0, 1 - y / (h * 0.75))));
}

// ---------- Lenis ----------
if (typeof window.Lenis === 'function' && !reduced) {
  const lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 1, smoothWheel: true });
  window.lenis = lenis;
  lenis.on('scroll', ({ scroll }) => onScroll(scroll));
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
} else {
  window.addEventListener('scroll', () => onScroll(window.scrollY), { passive: true });
}
onScroll(window.scrollY);

// ---------- one page per input ----------
const topbar = document.querySelector('.topbar');
const topH = () => (topbar ? topbar.offsetHeight : 64);
const steps = [...document.querySelectorAll('.step')];
const dotsEl = document.getElementById('stepDots');
const stepTop = (el) => el.getBoundingClientRect().top + window.scrollY - topH();
const easeOut = (t) => 1 - Math.pow(1 - t, 4);
const goTo = (el, duration = 0.6) => {
  if (!el) return;
  if (window.lenis) window.lenis.scrollTo(el, { offset: -topH(), duration, easing: easeOut });
  else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
};

steps.forEach((st, i) => {
  const c = st.querySelector('.step-count');
  if (c) c.textContent = `${String(i + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')} — ${st.dataset.label}`;
  const input = st.querySelector('input:not([type=radio]), select');
  if (input && input.id) input.dataset.step = String(i);
  const d = document.createElement('button');
  d.type = 'button'; d.className = 'step-dot'; d.setAttribute('aria-label', `${st.dataset.label} (step ${i + 1})`);
  d.innerHTML = `<span>${st.dataset.label}</span>`;
  d.addEventListener('click', () => goTo(st, 0.7));
  dotsEl?.appendChild(d);
});
const dots = dotsEl ? [...dotsEl.children] : [];

let current = 0;
let lastY = window.scrollY;
let dir = 1;
function updateActive(y) {
  if (y !== lastY) { dir = y > lastY ? 1 : -1; lastY = y; }
  if (!steps.length) return;
  const mid = y + topH() + window.innerHeight * 0.5;
  let idx = -1;
  steps.forEach((st, i) => { if (st.offsetTop <= mid) idx = i; });
  const inForm = idx >= 0 && mid < steps[steps.length - 1].offsetTop + steps[steps.length - 1].offsetHeight;
  dotsEl?.classList.toggle('show', inForm);
  if (idx !== current || !dots.some((d) => d.classList.contains('on'))) {
    current = Math.max(idx, 0);
    dots.forEach((d, i) => d.classList.toggle('on', i === current));
  }
}

// Snap to a page when scrolling settles inside the form region (leaves hero / results free).
let snapTimer = null;
function scheduleSnap() {
  if (reduced || !steps.length) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    if (window.lenis?.isScrolling === 'smooth' && window.lenis.isLocked) return;
    const y = window.scrollY;
    const tops = steps.map(stepTop);
    const last = tops.length - 1;
    if (y < tops[0] - window.innerHeight * 0.45 || y > tops[last] + 4) return;
    let i = 0;
    while (i < last && tops[i + 1] <= y + 1) i++;
    if (i === last) return;
    const frac = (y - tops[i]) / (tops[i + 1] - tops[i]);
    const target = dir > 0 ? (frac > 0.1 ? i + 1 : i) : (frac < 0.9 ? i : i + 1);
    if (Math.abs(y - tops[target]) > 2) goTo(steps[target], 0.45);
  }, 60);
}

// Wheel intent: one flick = one page, immediately (no waiting for the scroll to settle).
let wheelLock = 0;
let lastWheel = 0;
let lastDelta = 0;
if (!reduced && steps.length) {
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.target.closest?.('[data-lenis-prevent]') || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const now = performance.now();
    const gap = now - lastWheel;
    const delta = Math.abs(e.deltaY);
    const newGesture = gap > 90 || delta > lastDelta * 1.6;
    lastWheel = now; lastDelta = delta;
    const y = window.scrollY;
    const tops = steps.map(stepTop);
    const last = tops.length - 1;
    if (y < tops[0] - 4 || y > tops[last] + 4) return;
    const down = e.deltaY > 0;
    let i = 0;
    while (i < last && tops[i + 1] <= y + 8) i++;
    const settled = Math.abs(y - tops[i]) < 8;
    if (!settled && now < wheelLock) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if ((down && i >= last && settled) || (!down && i <= 0 && settled)) return;   // leave the form: normal scrolling
    e.preventDefault(); e.stopImmediatePropagation();
    if (delta < 4 || now < wheelLock || !newGesture) return;
    const target = down ? (settled ? i + 1 : i + 1) : (settled ? i - 1 : i);
    wheelLock = now + 650;
    goTo(steps[Math.max(0, Math.min(last, target))], 0.55);
  }, { passive: false, capture: true });
}

window.addEventListener('scroll', () => { updateActive(window.scrollY); scheduleSnap(); }, { passive: true });
updateActive(window.scrollY);

// Enter moves to the next page (Autocomplete's Enter-to-select has already called preventDefault).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.defaultPrevented) return;
  const t = e.target;
  const idx = t?.dataset?.step;
  if (idx === undefined || t.tagName === 'BUTTON') return;
  e.preventDefault();
  goTo(steps[Number(idx) + 1]);
});
// Picking an airport from the list moves on automatically.
document.addEventListener('chosen', (e) => {
  const idx = e.target?.dataset?.step;
  if (idx !== undefined) setTimeout(() => goTo(steps[Number(idx) + 1]), 350);
});
// Segmented choices (day/night, rules, wind source) are one click — move on after a beat.
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.type !== 'radio' || t.name === 'windSource' && t.value === 'manual') return;
  const st = t.closest('.step');
  if (st) setTimeout(() => goTo(steps[steps.indexOf(st) + 1]), 450);
});

// ---------- in-page anchors ----------
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-scroll-to]');
  if (!a) return;
  const target = document.querySelector(a.dataset.scrollTo);
  if (!target) return;
  ev.preventDefault();
  if (window.lenis) window.lenis.scrollTo(target, { offset: a.dataset.scrollTo === '#top' ? 0 : -64, duration: 1.6 });
  else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
});
