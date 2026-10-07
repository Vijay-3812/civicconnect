/* Full-app boot + render test in a stub DOM.
   Renders every route and validates the produced HTML (tag balance, NaN/undefined leaks). */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const grab = (f) => fs.readFileSync(path.join(ROOT, 'parts', f), 'utf8');

/* ---------- stub DOM ------------------------------------------------------ */
const listeners = [];
const mkRect = () => ({ left: 0, top: 0, width: 320, height: 120, right: 320, bottom: 120 });
function element(tag = 'div', id = '') {
  const el = {
    tagName: (tag || 'div').toUpperCase(), id, innerHTML: '', textContent: '', value: '', checked: false, hidden: false,
    children: [], childNodes: [], files: [], dataset: {}, style: new Proxy({}, { get: () => '', set: () => true }),
    offsetWidth: 120, offsetHeight: 40, offsetLeft: 0, disabled: false,
    classList: { _s: new Set(), add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c) => c, insertBefore: (c) => c, remove() {}, focus() {}, blur() {}, click() {},
    closest: () => null, contains: () => false, scrollIntoView() {}, setPointerCapture() {}, releasePointerCapture() {},
    parentElement: { getBoundingClientRect: mkRect, style: {}, classList: { add() {}, remove() {}, toggle() {} } },
    getBoundingClientRect: mkRect, animate: () => ({ onfinish: null, cancel() {}, finished: Promise.resolve() }),
    querySelector: () => null, querySelectorAll: () => [], getContext: () => ctx2d, cloneNode: () => element(tag),
    insertAdjacentHTML() {}, replaceChild() {}, matches: () => false, removeChild() {}
  };
  el.closest = () => el;
  el.querySelector = () => element('div');
  return el;
}
const ctx2d = { clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {}, fillText() {}, measureText: () => ({ width: 10 }) };

const viewRoot = element('main', 'viewRoot');
const bodyEl = element('body');
const doc = {
  readyState: 'complete', hidden: false,
  documentElement: Object.assign(element('html'), { setAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {} }),
  body: bodyEl, head: element('head'),
  createElement: (t) => element(t), createDocumentFragment: () => element('fragment'),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  addEventListener() {}, removeEventListener() {},
  querySelector: (sel) => (sel === '#viewRoot' ? viewRoot : element('div', (sel || '').replace('#', ''))),
  querySelectorAll: () => [],
  getElementById: (id) => (id === 'viewRoot' ? viewRoot : element('div', id))
};
global.document = doc;
global.window = {
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 900, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }), scrollTo() {}, requestAnimationFrame: (f) => setTimeout(f, 0),
  getComputedStyle: () => ({ getPropertyValue: () => '#EDF1FF' })
};
let _hash = '#/';
global.location = {
  get hash() { return _hash; },
  set hash(v) { _hash = v; if (global.__router) global.__router.render(false); },
  origin: 'https://demo.local', pathname: '/index.html', protocol: 'file:', reload() {}
};
global.history = { replaceState() {}, pushState() {} };
global.navigator = { clipboard: { writeText: () => Promise.resolve() }, geolocation: undefined, onLine: true };
global.performance = { now: () => Date.now() };
global.localStorage = undefined;
global.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.matchMedia = () => ({ matches: false, addEventListener() {} });
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
global.Blob = class { constructor() {} };
global.URL.createObjectURL = () => 'blob:stub';
global.URL.revokeObjectURL = () => {};

/* ---------- evaluate the whole application -------------------------------- */
const files = ['03_utils_i18n.html', '04_store_seed.html', '05_services_actions.html', '06_motion.html', '07_components_map.html', '08_views_core.html', '09_views_dashboards.html', '10_app_demo_boot.html'];
let code = files.map(grab).join('').replace('<script>', '').replace(/<\/script>\s*<\/body>\s*<\/html>\s*$/, '');

const errors = [];
const origError = console.error, origWarn = console.warn;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); };
console.warn = (...a) => { errors.push('console.warn: ' + a.join(' ')); };

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { cond ? (pass++, console.log('  ✓ ' + label + (extra ? ' — ' + extra : ''))) : (fail++, console.log('  ✗ ' + label + (extra ? ' — ' + extra : ''))); };

let api;
try {
  api = new Function(code + '\nreturn { Store, Router, App, Actions, Services, Utils, Motion, Charts, Demo, Components, Toast, Modal, Confetti, I18N, ReportApi: typeof ReportApi !== "undefined" ? ReportApi : null };')();
} catch (e) {
  console.error = origError;
  console.log('FATAL: app failed to evaluate\n' + e.stack);
  process.exit(1);
}

console.log('BOOT + VIEW RENDER');
ok('module graph evaluates and boots without throwing', true);

const { Store, Router, Actions, Services, Utils } = api;

/* ---------- HTML validation ---------------------------------------------- */
const TAGS = ['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'span', 'button', 'label', 'p', 'h1', 'h2', 'h3', 'h4',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'form', 'fieldset', 'legend', 'select', 'option', 'textarea', 'svg', 'canvas', 'pre', 'blockquote', 'video', 'nav', 'strong', 'i'];
function validate(label, html) {
  const problems = [];
  if (!html || html.length < 300) problems.push('suspiciously small output (' + (html ? html.length : 0) + ' bytes)');
  if (/NaN/.test(html)) problems.push('literal "NaN" in markup: …' + (html.match(/.{0,50}NaN.{0,30}/) || [''])[0]);
  if (/undefined/.test(html)) problems.push('literal "undefined" in markup: …' + (html.match(/.{0,50}undefined.{0,20}/) || [''])[0]);
  if (/\[object Object\]/.test(html)) problems.push('[object Object] leaked into markup');
  if (/\$\{/.test(html)) problems.push('unresolved template placeholder ${ in markup');
  if (/>null</.test(html)) problems.push('bare null rendered');
  TAGS.forEach((tag) => {
    const o = (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const c = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (o !== c) problems.push(`<${tag}> ${o} open / ${c} close`);
  });
  problems.slice(0, 6).forEach((p) => console.log('    · ' + p));
  if (problems.some((p) => /open \/.* close/.test(p))) {
    const VOID = new Set(['br','img','input','hr','meta','link','use','path','circle','rect','line','polyline','polygon','stop','source','area','col','embed','track','wbr','ellipse','text','tspan','radialGradient','linearGradient','feTurbulence']);
    const stack = []; const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g; let m; let reported = 0;
    while ((m = re.exec(html))) {
      const closing = m[1] === '/', tag = m[2], selfClose = m[4] === '/' || VOID.has(tag);
      if (selfClose) continue;
      if (!closing) stack.push({ tag, at: m.index });
      else {
        if (!stack.length) { if (reported++ < 2) console.log('    · stray </' + tag + '> at ' + m.index); continue; }
        const top = stack.pop();
        if (top.tag !== tag) { if (reported++ < 3) console.log('    · </' + tag + '> closes <' + top.tag + '> · context: …' + html.slice(Math.max(0, top.at - 90), m.index + 40).replace(/\s+/g, ' ')); stack.push(top); }
      }
    }
    stack.slice(0, 3).forEach((s) => console.log('    · never closed <' + s.tag + '> · context: …' + html.slice(Math.max(0, s.at - 60), s.at + 240).replace(/\s+/g, ' ')));
  }
  ok(label + ' markup is clean', problems.length === 0, Math.round(html.length / 1024) + ' kB');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function renderRoute(route, note) {
  global.location.hash = route;
  viewRoot.innerHTML = '';
  try { Router.render(true); }
  catch (e) { fail++; console.log('  ✗ ' + route + ' threw: ' + e.message); return ''; }
  await sleep(600);                       // let the skeleton→content swap settle
  const html = viewRoot.innerHTML;
  if (process.env.DUMP && html.length < 900) console.log('    >>> ' + route + ' :: ' + html.replace(/\s+/g, ' ').slice(0, 400));
  validate(`${route}${note ? ' (' + note + ')' : ''}`, html);
  return html;
}

async function main() {
    /* default session: citizen */
    await renderRoute('#/', 'landing');
    await renderRoute('#/map', 'live map');
    await renderRoute('#/report', 'wizard');
    await renderRoute('#/mine', 'citizen dashboard');
    await renderRoute('#/stats', 'public stats');
    await renderRoute('#/auth', 'login');
    await renderRoute('#/c/CC-1007', 'detail: duplicate parent');
    await renderRoute('#/c/CC-1017', 'detail: in progress');
    await renderRoute('#/c/CC-1005', 'detail: closed w/ proof');
    await renderRoute('#/c/CC-1014', 'detail: reopened');
    await renderRoute('#/c/CC-1044', 'detail: flagged spam');
    await renderRoute('#/c/CC-9999', 'detail: missing id (error state)');
    Store.state.role = 'official';
    Store.state.userId = Store.state.users.find((u) => u.role === 'official').id;
    await renderRoute('#/official', 'official board');
    api.Store.state.ui.tabBoard = 'table';
    await renderRoute('#/official', 'official table');
    Store.state.role = 'admin';
    Store.state.userId = Store.state.users.find((u) => u.role === 'admin').id;
    await renderRoute('#/admin', 'admin dashboard');
    await renderRoute('#/official', 'admin on department view');
    await renderRoute('#/', 'landing as admin');
    Store.state.role = 'citizen';
    Store.state.userId = null;   // guest
    await renderRoute('#/mine', 'guest dashboard (auth prompt)');
    await renderRoute('#/official', 'guest on official view (denied state)');
    await renderRoute('#/admin', 'guest on admin view (denied state)');

    /* i18n + accessibility render passes */
    Store.state.userId = 'u-cit-1'; Store.state.role = 'citizen';
    Store.state.lang = 'ta';
    await renderRoute('#/', 'landing in Tamil');
    await renderRoute('#/mine', 'citizen dashboard in Tamil');
    Store.state.lang = 'en';
    Object.assign(Store.state.prefs, { lowbw: true, contrast: true, large: true, reduce: true });
    await renderRoute('#/', 'landing in low-bandwidth + a11y mode');
    await renderRoute('#/c/CC-1007', 'detail in low-bandwidth mode');
    Object.assign(Store.state.prefs, { lowbw: false, contrast: false, large: false, reduce: false });

    /* filters + empty states */
    Store.state.filters.map.cats = ['waste'];
    Store.state.filters.map.q = 'zzz-no-match-zzz';
    await renderRoute('#/map', 'map with no matching filters (empty state)');
    Store.state.filters.map.cats = []; Store.state.filters.map.q = '';



/* ---------- guided demo end-to-end ---------- */
console.log('\nGUIDED DEMO (full lifecycle, reduced-motion timings)');
global.__router = Router;
if (api.Demo && !api.Demo.state.running) {
  Store.state.prefs.reduce = true;
  Store.state.role = 'citizen'; Store.state.userId = 'u-cit-1'; Store.state.lang = 'en';
  const beforeCount = Store.state.complaints.length;
  api.Demo.start();
  const t0 = Date.now();
  while (api.Demo.state.running && Date.now() - t0 < 45000) await sleep(250);
  await sleep(400);
  const created = Store.state.complaints[0];
  ok('demo finished without hanging', !api.Demo.state.running, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  ok('demo filed exactly one new ticket', Store.state.complaints.length === beforeCount + 1, created ? created.id : 'none');
  ok('ticket reached the end of the state machine', created && ['Resolved', 'Closed'].includes(created.status), created ? created.status + ' · ' + created.statusHistory.map((h) => h.status).join(' → ') : '');
  ok('resolution has an after-photo + note', !!(created && created.resolution.afterPhoto) && created.resolution.note.length > 10);
  ok('citizen confirmation + 5-star rating stored', !!(created && created.resolution.confirmed === true) && created.resolution.rating === 5);
  ok('SLA clock was set from the category', !!(created && created.slaDueAt > created.createdAt));
  ok('demo ends on a route that shows the green marker', ['#/map', '#/c/' + (created ? created.id : '')].includes(global.location.hash), global.location.hash);
  Store.state.prefs.reduce = false;
} else {
  ok('demo controller is exposed', !!api.Demo);
}
}

main().then(() => {
console.log('\nMODULE SURFACE AUDIT (every Module.member usage must exist)');
{
  const appSrc = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('<script>')[1].split('</script>')[0];
  const mods = { Utils: api.Utils, Store: api.Store, Services: api.Services, Actions: api.Actions, Motion: api.Motion,
    Components: api.Components, Charts: api.Charts, Toast: api.Toast, Modal: api.Modal, Router: api.Router, App: api.App,
    Demo: api.Demo, Confetti: api.Confetti, I18N: api.I18N };
  const builtin = new Set(['length','name','call','apply','bind','toString','forEach','map','filter','sort','slice','find','reduce','push','pop','split','join','concat','includes','keys','values','entries','has','get','set','add','delete','then','catch','finally','constructor','prototype','at','flat','some','every','indexOf','replace','trim']);
  const missing = [];
  Object.entries(mods).forEach(([name, mod]) => {
    if (!mod) return;
    const keys = new Set(Object.keys(mod));
    const used = new Set([...appSrc.matchAll(new RegExp('\\b' + name + '\\.([A-Za-z_$][\\w$]*)', 'g'))].map((m) => m[1]));
    used.forEach((u) => { if (!keys.has(u) && !builtin.has(u)) missing.push(name + '.' + u); });
  });
  ok('all cross-module member usages are defined', missing.length === 0, [...new Set(missing)].sort().join(', '));
}

console.log('\nRUNTIME WARNINGS');
const noisy = errors.filter((e) => !/ScrollTrigger|Chart|not a function|Cannot read/.test(e));
ok('no console errors or warnings during boot + 25 renders', errors.length === 0, errors.length ? '\n      ' + errors.slice(0, 8).join('\n      ') : '');

console.log(`\n${pass} passed, ${fail} failed`);
console.error = origError; console.warn = origWarn;
process.exit(fail ? 1 : 0);

});
