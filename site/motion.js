// Animations and the interactive demo. Everything is readable without this file,
// and with "reduce motion" turned on the demo still works, with instant changes.
const { gsap, ScrollTrigger } = window;
const root = document.documentElement;
if (!gsap || !ScrollTrigger) { root.classList.remove('js'); throw new Error('GSAP did not load'); }
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// The visitor's choice here, or else their system's.
const still = root.dataset.motion ? root.dataset.motion === 'off' : matchMedia('(prefers-reduced-motion: reduce)').matches;
const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
gsap.registerPlugin(ScrollTrigger);
gsap.defaults({ ease: 'power3.out', duration: 0.7 });
/** A timeline that jumps to its end when motion is reduced. Its callbacks still run. */
const play = (tl) => { if (still) tl.progress(1); else tl.play(); return tl; };

// ---- The demo: the same rules as the extension, in miniature ----
const SITES = {
  jobs: { url: 'jobs.example', listed: true },
  docs: { url: 'docs.example', listed: true },
  mail: { url: 'mail.example', listed: false },
  bank: { url: 'bank.example', listed: false, blocked: true },
};
const NOTES = {
  all: 'Any site except the blocked ones.',
  specific: 'Only jobs.example and docs.example.',
  none: 'Agents can’t use any site.',
};
const demo = $('#demo');
const state = { shared: new Set(['jobs']), mode: 'specific', stopped: false, view: 'jobs', run: null };
const view = $('.d-view', demo);
const cursor = $('.d-cursor', demo);
const log = $('.d-log', demo);
const lock = $('.d-lock', demo);

function why(tab) {
  const s = SITES[tab];
  if (state.stopped) return 'You pressed Stop.';
  if (!state.shared.has(tab)) return 'That tab isn’t shared.';
  if (s.blocked) return `${s.url} is blocked.`;
  if (state.mode === 'none') return 'No sites are allowed.';
  if (state.mode === 'specific' && !s.listed) return `${s.url} isn’t on your list.`;
  return '';
}

function say(text, kind = '') {
  const li = document.createElement('li');
  li.textContent = text;
  li.className = kind;
  log.append(li);
  while (log.children.length > 30) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (!still) gsap.from(li, { opacity: 0, x: -14, duration: 0.35 });
}

function draw() {
  for (const b of $$('.d-tab', demo)) {
    const on = state.shared.has(b.dataset.tab);
    b.setAttribute('aria-pressed', on);
    $('small', b).textContent = on ? 'Shared' : 'Not shared';
  }
  for (const b of $$('[data-mode]', demo)) b.setAttribute('aria-pressed', b.dataset.mode === state.mode);
  for (const p of $$('.d-page', demo)) p.classList.toggle('on', p.dataset.page === state.view);
  const stop = $('.d-stop', demo);
  stop.textContent = state.stopped ? 'Resume' : 'Stop';
  stop.setAttribute('aria-pressed', state.stopped);
  $('.d-note', demo).textContent = NOTES[state.mode];
  const reason = why(state.view);
  $('.d-url', demo).textContent = state.shared.has(state.view) ? SITES[state.view].url : 'Hidden';
  lock.classList.toggle('on', !!reason);
  if (reason) $('b', lock).textContent = reason;
}

function end() {
  state.run?.kill();
  state.run = null;
  gsap.killTweensOf([view, cursor]);
  gsap.set(view, { '--glow': 0 });
  gsap.set(cursor, { opacity: 0, scale: 1 });
  for (const f of $$('.d-field', demo)) f.classList.remove('on');
}

function clean() {
  for (const f of $$('.d-field', demo)) f.textContent = '';
  gsap.set($$('.d-line', demo), { '--read': 0 });
}

/** The middle of an element, measured from the top left of the demo's window. */
function at(el, dx = 0.5) {
  const v = view.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - v.left + Math.min(r.width * dx, 260), y: r.top - v.top + r.height / 2 };
}

const reveal = () => { if (!still) gsap.fromTo($('.d-page.on', demo), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, clearProps: 'opacity,transform' }); };

function ask(tab, byUser = true) {
  end();
  clean();
  state.view = tab;
  draw();
  reveal();
  const button = $(`[data-ask="${tab}"]`, demo);
  say(`${byUser ? 'You asked' : 'Asked'}: ${button.textContent.toLowerCase()}`);
  const reason = why(tab);
  if (reason) return refuse(reason);
  const page = $(`[data-page="${tab}"]`, demo);
  const tl = gsap.timeline({ paused: true, onComplete: () => { state.run = null; } });
  state.run = tl;
  tl.to(view, { '--glow': 1, duration: 0.4 });
  tl.set(cursor, { x: view.clientWidth * 0.8, y: view.clientHeight * 0.75 }, 0);
  tl.to(cursor, { opacity: 1, duration: 0.3 }, 0.1);
  const go = (el, dx) => tl.to(cursor, { x: () => at(el, dx).x, y: () => at(el, dx).y, duration: 0.65, ease: 'power2.inOut' });
  const press = () => tl.to(cursor, { scale: 0.65, duration: 0.12, yoyo: true, repeat: 1 });
  if (tab === 'jobs') {
    for (const [name, value, label] of [['name', 'Sam Example', 'Full name'], ['city', 'Springfield', 'City'], ['years', '6 to 10', 'Years of experience']]) {
      const field = $(`[data-f="${name}"]`, page);
      const typed = { n: 0 };
      go(field);
      press();
      tl.add(() => field.classList.add('on'));
      tl.to(typed, { n: value.length, duration: value.length * 0.055, ease: 'none', onUpdate: () => { field.textContent = value.slice(0, Math.round(typed.n)); } });
      tl.add(() => { field.textContent = value; field.classList.remove('on'); say(`Filled in ${label}`); });
    }
    go($('.d-btn', page));
    tl.add(() => say('Done. Ready for you to review.', 'ok'));
  } else {
    for (const line of $$('.d-line', page)) {
      tl.to(line, { '--read': 1, duration: 0.5, ease: 'none' });
      tl.to(cursor, { x: () => at(line, 0.9).x, y: () => at(line).y, duration: 0.45, ease: 'power1.inOut' }, '<');
    }
    tl.add(() => say(tab === 'docs' ? 'Summary: support hours are now 9 to 5, and the spring review starts in March.' : 'Read 3 subjects: lunch, a library book and photos.', 'ok'));
  }
  tl.to(cursor, { opacity: 0, duration: 0.4 }, '+=0.6');
  tl.to(view, { '--glow': 0, duration: 0.5 }, '<');
  play(tl);
}

function refuse(reason) {
  say(`Refused. ${reason}`, 'no');
  lock.classList.add('red');
  gsap.delayedCall(1.6, () => lock.classList.remove('red'));
  if (!still) gsap.fromTo(lock.firstElementChild, { rotation: 0, scale: 1 }, { keyframes: { rotation: [0, -14, 12, -8, 5, 0], scale: [1, 1.25, 1] }, duration: 0.6, ease: 'power1.out' });
}

demo.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.id === 'motion') return;
  touched = true;
  const { tab, mode } = b.dataset;
  if (tab) {
    end();
    const on = !state.shared.has(tab);
    if (on) state.shared.add(tab); else state.shared.delete(tab);
    state.view = tab;
    draw();
    reveal();
    say(`You ${on ? 'shared' : 'stopped sharing'} ${SITES[tab].url}`);
    if (!still) gsap.fromTo($('.d-dot', b), { scale: 1.9 }, { scale: 1, ease: 'elastic.out(1, .45)', duration: 0.9 });
  } else if (mode) {
    const was = !why(state.view);
    state.mode = mode;
    if (was && why(state.view)) end();
    draw();
  } else if (b.dataset.ask) {
    ask(b.dataset.ask);
  } else if (b.classList.contains('d-stop')) {
    state.stopped = !state.stopped;
    end();
    draw();
    say(state.stopped ? 'You stopped all agents' : 'Agents can work again', state.stopped ? 'no' : '');
  }
});
let touched = false;
draw();

// ---- Follow a request from the agent to the tab ----
const flow = $('.flow');
const nodes = $$(':scope > div', flow);
const packet = document.createElement('div');
packet.className = 'packet';
packet.setAttribute('aria-hidden', 'true');
flow.append(packet);
const flowText = $('.flowbar p');
let trip = null;
function send(allowed) {
  trip?.kill();
  for (const n of nodes) n.classList.remove('lit', 'stop');
  const mid = (i) => ({
    x: nodes[i].offsetLeft + nodes[i].offsetWidth / 2,
    y: nodes[i].offsetTop + nodes[i].offsetHeight / 2,
  });
  flowText.textContent = 'The agent asks to read a tab…';
  trip = gsap.timeline({ paused: true });
  trip.set(packet, { ...mid(0), scale: 1, backgroundColor: '#fff' }).to(packet, { opacity: 1, duration: 0.25 });
  const last = allowed ? 3 : 2;
  trip.add(() => nodes[0].classList.add('lit'));
  for (let i = 1; i <= last; i++) {
    trip.to(packet, { ...mid(i), duration: 0.75, ease: 'power2.inOut' });
    trip.add(() => {
      if (i === 2 && !allowed) return;
      nodes[i].classList.add('lit');
      if (i === 2) flowText.textContent = 'Shared tab, allowed site. Go ahead.';
    });
  }
  if (allowed) {
    trip.to(packet, { scale: 1.8, opacity: 0, duration: 0.45 });
    trip.add(() => { flowText.textContent = 'Read. The result goes back to the agent.'; });
  } else {
    trip.add(() => { nodes[2].classList.add('stop'); flowText.textContent = 'Refused. The tab isn’t shared, so it never gets there.'; });
    trip.to(packet, { backgroundColor: '#ff6b6b', duration: 0.15 });
    if (!still) trip.fromTo(nodes[2], { x: 0 }, { keyframes: { x: [0, -8, 8, -5, 5, 0] }, duration: 0.45, ease: 'none', clearProps: 'transform' }, '<');
    trip.to(packet, { opacity: 0, scale: 0.3, duration: 0.4 });
  }
  play(trip);
}
for (const b of $$('[data-send]')) b.addEventListener('click', () => send(b.dataset.send === 'yes'));

// ---- Setup checklist ----
const list = $('.steps');
const items = [...list.children];
list.classList.add('live');
const bar = $('.stepbar i');
const count = $('.stepbar span');
function tally() {
  const n = items.filter((li) => li.classList.contains('done')).length;
  count.textContent = n === items.length ? 'All done' : `${n} of ${items.length} done`;
  gsap.to(bar, { scaleX: n / items.length, duration: still ? 0 : 0.6 });
}
items.forEach((li, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tick';
  b.textContent = i + 1;
  b.setAttribute('aria-label', `Step ${i + 1} done`);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const done = li.classList.toggle('done');
    b.setAttribute('aria-pressed', done);
    if (done) b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>'; else b.textContent = i + 1;
    if (!still) gsap.fromTo(b, { scale: 0.7 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, .5)', clearProps: 'transform' });
    tally();
  });
  li.prepend(b);
});
tally();

// ---- Everything below is only movement ----
if (still) {
  gsap.set('.hero > *', { opacity: 1 });
  root.classList.add('ready');
} else {
  const intro = gsap.timeline({ onComplete: () => { gsap.set('.hero > *', { clearProps: 'transform' }); } });
  intro.set('.hero > *', { opacity: 0 });
  intro.add(() => root.classList.add('ready'));
  intro.fromTo('.hero h1', { opacity: 0, y: 46 }, { opacity: 1, y: 0, duration: 1 }, 0.05);
  intro.fromTo('.hero .lead, .hero .actions, .hero > .note', { opacity: 0, y: 26 }, { opacity: 1, y: 0, stagger: 0.12 }, 0.3);
  intro.fromTo(demo, { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 1.1 }, 0.6);

  // Show what it does once, unless the visitor has already started.
  ScrollTrigger.create({ trigger: view, start: 'top 75%', once: true, onEnter: () => gsap.delayedCall(1.7, () => { if (!touched) ask('jobs', false); }) });
  ScrollTrigger.create({ trigger: flow, start: 'top 75%', once: true, onEnter: () => gsap.delayedCall(0.8, () => { if (!trip) send(true); }) });

  gsap.to('.progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

  const groups = ['section .head', '.flow > div, .flow > svg', '.flowbar', '#control .card', '.steps li', '.stack .card', '.coffee', '#faq details'];
  for (const g of groups) {
    const els = $$(g).filter((el) => el.getBoundingClientRect().top > innerHeight * 0.9);
    if (!els.length) continue;
    gsap.set(els, { opacity: 0, y: 34 });
    ScrollTrigger.batch(els, { start: 'top 92%', once: true, onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, stagger: 0.09, overwrite: true, clearProps: 'opacity,transform' }) });
  }

  // The screenshots lie back, and stand up as they arrive.
  gsap.from('.look .shot', { rotationX: 24, y: 70, scale: 0.93, transformOrigin: '50% 100%', ease: 'none', stagger: 0.1, scrollTrigger: { trigger: '.look', start: 'top 95%', end: 'top 35%', scrub: 0.6 } });

  if (mouse) {
    const orbs = document.createElement('div');
    orbs.className = 'orbs';
    orbs.setAttribute('aria-hidden', 'true');
    orbs.innerHTML = '<i></i><i></i>';
    document.body.prepend(orbs);
    const [a, b] = orbs.children;
    gsap.set(a, { x: innerWidth * 0.25, y: innerHeight * 0.3 });
    gsap.set(b, { x: innerWidth * 0.8, y: innerHeight * 0.65 });
    const to = (el, p, d) => gsap.quickTo(el, p, { duration: d, ease: 'power3.out' });
    const [ax, ay, bx, by] = [to(a, 'x', 1.2), to(a, 'y', 1.2), to(b, 'x', 2.4), to(b, 'y', 2.4)];
    addEventListener('pointermove', (e) => { ax(e.clientX); ay(e.clientY); bx(innerWidth - e.clientX * 0.7); by(innerHeight - e.clientY * 0.7); }, { passive: true });

    for (const el of $$('#control .card')) {
      gsap.set(el, { transformPerspective: 900 });
      const rx = to(el, 'rotationX', 0.5);
      const ry = to(el, 'rotationY', 0.5);
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        rx((0.5 - (e.clientY - r.top) / r.height) * 5);
        ry(((e.clientX - r.left) / r.width - 0.5) * 5);
      });
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    }
    for (const el of $$('.actions .btn, .stack .btn.main')) {
      const x = to(el, 'x', 0.4);
      const y = to(el, 'y', 0.4);
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        x((e.clientX - r.left - r.width / 2) * 0.22);
        y((e.clientY - r.top - r.height / 2) * 0.35);
      });
      el.addEventListener('pointerleave', () => { x(0); y(0); });
    }
  }
}

// ---- Turn the movement on or off ----
const motion = $('#motion');
motion.textContent = still ? 'Turn animations on' : 'Turn animations off';
motion.addEventListener('click', () => {
  try { localStorage.motion = still ? 'on' : 'off'; } catch { return; }
  location.reload();
});

// ---- The coffee cup fills with the tip, and the card lights up after a download ----
const fill = $('.cup-fill');
// 1 is the middle suggestion, whatever the currency.
const level = (n) => (n ? Math.min(1, Math.max(0.25, 0.62 + 0.3 * Math.log2(n))) : 0.12);
const pour = (n, d) => gsap.to(fill, { attr: { y: 53 - 28 * level(n), height: 28 * level(n) }, duration: still ? 0 : d });
pour(0, 0);
$('.coffee-form').addEventListener('tip', (e) => {
  pour(e.detail, 0.8);
  if (e.detail && !still) gsap.fromTo('.steam', { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.1, duration: 0.6, overwrite: true });
});
for (const d of $$('a[download]')) {
  d.addEventListener('click', () => {
    const c = $('#coffee');
    c.classList.add('glow');
    if (!still) gsap.fromTo($('.cup', c), { rotation: 0 }, { keyframes: { rotation: [0, -12, 10, -6, 0] }, duration: 0.9, transformOrigin: '50% 80%' });
    gsap.delayedCall(6, () => c.classList.remove('glow'));
  });
}

// ---- Where you are, in the menu ----
for (const a of $$('.nav nav a[href^="#"]:not(.btn)')) {
  const target = $(a.getAttribute('href'));
  ScrollTrigger.create({ trigger: target, start: 'top 40%', end: 'bottom 40%', onToggle: (t) => { a.classList.toggle('here', t.isActive); if (t.isActive) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); } });
}

// ---- Questions open and close smoothly ----
for (const d of $$('details')) {
  const s = $('summary', d);
  s.addEventListener('click', (e) => {
    if (still) return;
    e.preventDefault();
    const closing = d.open && !d.dataset.closing;
    gsap.killTweensOf(d);
    const from = d.offsetHeight;
    if (closing) d.dataset.closing = '1'; else { delete d.dataset.closing; d.open = true; }
    gsap.set(d, { height: 'auto' });
    const to = closing ? s.offsetHeight + 2 : d.offsetHeight;
    gsap.fromTo(d, { height: from }, { height: to, duration: 0.35, ease: 'power2.inOut', clearProps: 'height', onComplete: () => { if (closing) { d.open = false; delete d.dataset.closing; } ScrollTrigger.refresh(); } });
  });
  d.addEventListener('toggle', () => ScrollTrigger.refresh());
}
addEventListener('load', () => ScrollTrigger.refresh());
